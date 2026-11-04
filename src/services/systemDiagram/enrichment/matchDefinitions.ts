/**
 * Matches the instances of a system graph to indexed definition files: `.ip.yml`
 * by VLNV (Vivado) or Platform Designer component name, HDL files by entity or
 * module name. Pure: the caller supplies the indexes.
 */

import type { SystemDiagnostic, SystemGraph } from '../../../domain/systemGraph';

export interface IpFileKey {
  file: string;
  displayName: string;
  vlnv: { vendor: string; library: string; name: string; version: string };
}

export interface HdlFileKey {
  file: string;
  displayName: string;
  /** VHDL entity names (matched case-insensitively). */
  vhdlEntities: string[];
  /** Verilog/SystemVerilog module names (matched exactly). */
  verilogModules: string[];
}

export interface DefinitionMatches<Ip extends IpFileKey, Hdl extends HdlFileKey> {
  ip: Map<string, Ip>;
  hdl: Map<string, Hdl>;
  diagnostics: SystemDiagnostic[];
}

const dirSegments = (file: string) => file.split(/[\\/]/).slice(0, -1);

/** Steps between the directories of two files in the directory tree. */
function treeDistance(a: string, b: string): number {
  const left = dirSegments(a);
  const right = dirSegments(b);
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) {
    shared += 1;
  }
  return left.length - shared + (right.length - shared);
}

const vlnvText = (vlnv: IpFileKey['vlnv']) =>
  `${vlnv.vendor}:${vlnv.library}:${vlnv.name}:${vlnv.version}`.toLowerCase();

export function matchDefinitions<Ip extends IpFileKey, Hdl extends HdlFileKey>(
  graph: SystemGraph,
  ipFiles: readonly Ip[],
  hdlFiles: readonly Hdl[],
  designFile: string
): DefinitionMatches<Ip, Hdl> {
  const result: DefinitionMatches<Ip, Hdl> = { ip: new Map(), hdl: new Map(), diagnostics: [] };

  /** The single candidate, or the one with `version`; otherwise none plus a diagnostic. */
  const pickOne = <T extends { file: string; displayName: string }>(
    candidates: T[],
    instanceName: string,
    line: number,
    versionOf?: (candidate: T) => string,
    version?: string
  ): T | undefined => {
    if (candidates.length <= 1) {
      return candidates[0];
    }
    const byVersion =
      versionOf && version !== undefined
        ? candidates.filter((candidate) => versionOf(candidate) === version)
        : [];
    if (byVersion.length === 1) {
      return byVersion[0];
    }
    // Prefer the candidate nearest to the design file; a tie stays ambiguous.
    const pool = byVersion.length > 1 ? byVersion : candidates;
    const distances = pool.map((candidate) => treeDistance(candidate.file, designFile));
    const best = Math.min(...distances);
    const nearest = pool.filter((_, index) => distances[index] === best);
    if (nearest.length === 1) {
      return nearest[0];
    }
    result.diagnostics.push({
      severity: 'info',
      message: `Several definitions match ${instanceName}: ${candidates
        .map((candidate) => candidate.displayName)
        .sort()
        .join(', ')}`,
      lines: [line],
    });
    return undefined;
  };

  for (const instance of Object.values(graph.instances)) {
    if (instance.kind === 'ip' && instance.vlnv) {
      const wanted = instance.vlnv.toLowerCase();
      const found = pickOne(
        ipFiles.filter((file) => vlnvText(file.vlnv) === wanted),
        instance.name,
        instance.line
      );
      if (found) {
        result.ip.set(instance.path, found);
      }
    } else if (instance.kind === 'ip' && instance.component) {
      const wanted = instance.component.toLowerCase();
      const found = pickOne(
        ipFiles.filter((file) => file.vlnv.name.toLowerCase() === wanted),
        instance.name,
        instance.line,
        (file) => file.vlnv.version,
        instance.version
      );
      if (found) {
        result.ip.set(instance.path, found);
      }
    } else if (instance.kind === 'module' && instance.moduleRef) {
      const ref = instance.moduleRef;
      const found = pickOne(
        hdlFiles.filter(
          (file) =>
            file.vhdlEntities.some((name) => name.toLowerCase() === ref.toLowerCase()) ||
            file.verilogModules.includes(ref)
        ),
        instance.name,
        instance.line
      );
      if (found) {
        result.hdl.set(instance.path, found);
      }
    }
  }
  return result;
}
