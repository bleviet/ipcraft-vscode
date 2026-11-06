/**
 * Reads the workspace definitions (`.ip.yml` files and HDL modules) of the
 * instances in a system graph and merges their pins into it.
 *
 * This keeps its own small indexes instead of reusing `SubcoreResolver`: that
 * index is not instantiated by the extension and keys only exact VLNVs, while
 * the system viewer also needs case-insensitive VLNVs, Platform Designer
 * component names and HDL entity/module names. Both indexes are built lazily
 * and kept current per file by watchers (see {@link WorkspaceFileIndex}).
 */

import * as vscode from 'vscode';
import type { SystemDiagnostic, SystemGraph } from '../../domain/systemGraph';
import type { IpCore } from '../../domain/ipcore.types';
import { parseIpCore } from '../../domain/parse';
import { extractVerilogInterface } from '../../parser/VerilogParser';
import { extractVhdlInterface, type ParsedPort } from '../../parser/VhdlParser';
import { Logger } from '../../utils/Logger';
import { applyDefinitions } from './enrichment/applyDefinitions';
import {
  definitionFromHdl,
  definitionFromIpCore,
  type InstanceDefinition,
} from './enrichment/instanceDefinition';
import { matchDefinitions, type HdlFileKey, type IpFileKey } from './enrichment/matchDefinitions';
import { SubsystemExpander } from './SubsystemExpander';
import { WorkspaceFileIndex } from './WorkspaceFileIndex';

const IP_GLOB = '**/*.ip.yml';
const HDL_GLOB = '**/*.{vhd,vhdl,v,sv}';
const IP_LIMIT = 2000;
const HDL_LIMIT = 5000;
/** Generated netlists are not module references. */
const HDL_MAX_BYTES = 1024 * 1024;
const UNTRUSTED_MESSAGE = 'IP definitions are not read in untrusted workspaces.';

interface IpEntry extends IpFileKey {
  uri: vscode.Uri;
  ipCore: IpCore;
}

interface HdlEntry extends HdlFileKey {
  uri: vscode.Uri;
}

const VHDL_ENTITY = /^\s*entity\s+([A-Za-z_]\w*)\s+is\b/gim;
// SystemVerilog lifetime keywords may sit between `module` and its name.
const VERILOG_MODULE = /^\s*module\s+(?:(?:automatic|static)\s+)?([A-Za-z_]\w*)/gm;

function namesIn(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[1]);
}

export class SystemDesignEnricher {
  private readonly logger = new Logger('SystemDesignEnricher');
  private readonly ipIndex = new WorkspaceFileIndex<IpEntry>(
    IP_GLOB,
    IP_LIMIT,
    (uri) => this.readIpEntry(uri),
    this.logger
  );
  private readonly subsystems = new SubsystemExpander();
  private readonly hdlIndex = new WorkspaceFileIndex<HdlEntry>(
    HDL_GLOB,
    HDL_LIMIT,
    (uri) => this.readHdlEntry(uri),
    this.logger
  );

  /** `designFile` is the path of the design: the nearest definition wins a tie. */
  async enrich(read: SystemGraph, designFile: string): Promise<SystemGraph> {
    if (Object.values(read.instances).every((instance) => instance.kind === 'hier')) {
      return read;
    }
    if (!vscode.workspace.isTrusted) {
      return {
        ...read,
        diagnostics: [...read.diagnostics, { severity: 'info', message: UNTRUSTED_MESSAGE }],
      };
    }
    const graph = await this.subsystems.expand(read, designFile);
    const typed = Object.values(graph.instances).filter((instance) => instance.kind !== 'hier');
    if (typed.length === 0) {
      return graph;
    }
    const ipFiles = await this.ipIndex.get();
    const hdlFiles = typed.some((instance) => instance.kind === 'module')
      ? await this.hdlIndex.get()
      : [];
    const matches = matchDefinitions(graph, ipFiles, hdlFiles, designFile);

    const definitions = new Map<string, InstanceDefinition>();
    const notes: SystemDiagnostic[] = [...matches.diagnostics];
    for (const [path, entry] of matches.ip) {
      definitions.set(
        path,
        definitionFromIpCore(
          entry.ipCore,
          entry.uri.fsPath,
          entry.uri.toString(),
          entry.displayName
        )
      );
    }
    for (const [path, entry] of matches.hdl) {
      const instance = graph.instances[path];
      const moduleRef = instance.moduleRef ?? '';
      try {
        const ports = await this.readHdlPorts(entry, moduleRef);
        if (ports) {
          definitions.set(
            path,
            definitionFromHdl(ports, entry.uri.fsPath, entry.uri.toString(), entry.displayName)
          );
        } else {
          notes.push({
            severity: 'info',
            message: `${instance.name}: ${entry.displayName} declares ${moduleRef} after another unit; its ports are not read.`,
            lines: [instance.line],
            ...(instance.parent !== '/' && { level: instance.parent }),
          });
        }
      } catch (error) {
        this.logger.error(`Failed to read ${entry.displayName}`, error as Error);
      }
    }
    const enriched = applyDefinitions(graph, definitions);
    enriched.diagnostics.push(...notes);
    return enriched;
  }

  dispose(): void {
    this.ipIndex.dispose();
    this.hdlIndex.dispose();
    this.subsystems.dispose();
  }

  private async readText(uri: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  }

  private async readIpEntry(uri: vscode.Uri): Promise<IpEntry> {
    const ipCore = parseIpCore(await this.readText(uri));
    const { vendor, library, name, version } = ipCore.vlnv;
    return {
      uri,
      ipCore,
      file: uri.fsPath,
      displayName: vscode.workspace.asRelativePath(uri, false),
      vlnv: { vendor, library, name, version },
    };
  }

  private async readHdlEntry(uri: vscode.Uri): Promise<HdlEntry | undefined> {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > HDL_MAX_BYTES) {
      return undefined;
    }
    const text = await this.readText(uri);
    const isVhdl = /\.vhdl?$/i.test(uri.fsPath);
    return {
      uri,
      file: uri.fsPath,
      displayName: vscode.workspace.asRelativePath(uri, false),
      vhdlEntities: isVhdl ? namesIn(text, VHDL_ENTITY) : [],
      verilogModules: isVhdl ? [] : namesIn(text, VERILOG_MODULE),
    };
  }

  /**
   * Ports of the matched file, or undefined when `moduleRef` is not its first
   * unit: the existing extractors read only the first unit of a file.
   */
  private async readHdlPorts(
    entry: HdlEntry,
    moduleRef: string
  ): Promise<ParsedPort[] | undefined> {
    const text = await this.readText(entry.uri);
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
}
