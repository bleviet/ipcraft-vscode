/**
 * Reads the workspace definitions (`.ip.yml` files, HDL modules and Platform
 * Designer subsystems) of the instances in a system graph and merges them
 * into it. One pipeline for the system viewer and `ipcraft render`: each
 * supplies its file discovery and reads through {@link EnrichmentIo}.
 */

import type { SystemDiagnostic, SystemGraph } from '../../../domain/systemGraph';
import { extractVerilogInterface } from '../../../parser/VerilogParser';
import { extractVhdlInterface, type ParsedPort } from '../../../parser/VhdlParser';
import { applyDefinitions } from './applyDefinitions';
import type { EnrichmentIo, EnrichmentLog } from './enrichmentIo';
import { expandSubsystems } from './expandSubsystems';
import type { HdlEntry } from './fileEntries';
import {
  definitionFromHdl,
  definitionFromIpCore,
  type InstanceDefinition,
} from './instanceDefinition';
import { matchDefinitions } from './matchDefinitions';

/**
 * Ports of the matched file, or undefined when `moduleRef` is not its first
 * unit: the existing extractors read only the first unit of a file.
 */
function hdlPorts(
  text: string,
  entry: HdlEntry<unknown>,
  moduleRef: string
): ParsedPort[] | undefined {
  // The index's first unit is a cheap pre-check; the parser's own name guards
  // against a unit the index regex cannot see (e.g. `(* keep *) module a`).
  if (entry.vhdlEntities.length > 0) {
    const parsed = extractVhdlInterface(text);
    return entry.vhdlEntities[0].toLowerCase() === moduleRef.toLowerCase() &&
      parsed.entityName?.toLowerCase() === moduleRef.toLowerCase()
      ? parsed.ports
      : undefined;
  }
  const parsed = extractVerilogInterface(text);
  // The extractor reads a lifetime keyword (`module automatic foo`) as the name.
  const parsedName =
    parsed.moduleName === 'automatic' || parsed.moduleName === 'static'
      ? moduleRef
      : parsed.moduleName;
  return entry.verilogModules[0] === moduleRef && parsedName === moduleRef
    ? parsed.ports
    : undefined;
}

/** Whether every instance is a hierarchy block: nothing to look up. */
export function hasOnlyHierarchies(graph: SystemGraph): boolean {
  return Object.values(graph.instances).every((instance) => instance.kind === 'hier');
}

/** `designFile` is the path of the design: the nearest definition wins a tie. */
export async function enrichSystemGraph<R>(
  read: SystemGraph,
  designFile: string,
  io: EnrichmentIo<R>,
  log?: EnrichmentLog
): Promise<SystemGraph> {
  if (hasOnlyHierarchies(read)) {
    return read;
  }
  const graph = await expandSubsystems(read, designFile, io, log);
  const typed = Object.values(graph.instances).filter((instance) => instance.kind !== 'hier');
  if (typed.length === 0) {
    return graph;
  }
  const ipFiles = await io.listIpFiles();
  const hdlFiles = typed.some((instance) => instance.kind === 'module')
    ? await io.listHdlFiles()
    : [];
  const matches = matchDefinitions(graph, ipFiles, hdlFiles, designFile);

  const definitions = new Map<string, InstanceDefinition>();
  const notes: SystemDiagnostic[] = [...matches.diagnostics];
  for (const [path, entry] of matches.ip) {
    definitions.set(
      path,
      definitionFromIpCore(entry.ipCore, entry.file, entry.uri, entry.displayName)
    );
  }
  for (const [path, entry] of matches.hdl) {
    const instance = graph.instances[path];
    const moduleRef = instance.moduleRef ?? '';
    try {
      const ports = hdlPorts(await io.readText(entry.ref), entry, moduleRef);
      if (ports) {
        definitions.set(path, definitionFromHdl(ports, entry.file, entry.uri, entry.displayName));
      } else {
        notes.push({
          severity: 'info',
          message: `${instance.name}: ${entry.displayName} declares ${moduleRef} after another unit; its ports are not read.`,
          lines: [instance.line],
          ...(instance.parent !== '/' && { level: instance.parent }),
        });
      }
    } catch (error) {
      log?.error(`Failed to read ${entry.displayName}`, error as Error);
    }
  }
  const enriched = applyDefinitions(graph, definitions);
  enriched.diagnostics.push(...notes);
  return enriched;
}
