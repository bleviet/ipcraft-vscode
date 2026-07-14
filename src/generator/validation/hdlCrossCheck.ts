import * as fs from 'fs/promises';
import * as path from 'path';
import { extractVhdlInterface } from '../../parser/VhdlParser';
import { extractVerilogInterface } from '../../parser/VerilogParser';
import type { IpCoreData } from '../types';

export type HdlCrossCheckKind =
  | 'missing-port'
  | 'direction-mismatch'
  | 'width-mismatch'
  | 'missing-parameter'
  | 'parameter-default-mismatch';

export interface HdlCrossCheckFinding {
  kind: HdlCrossCheckKind;
  message: string;
  /** Path into the .ip.yml, e.g. ['ports', 2], ['clocks', 0] or ['parameters', 1]. */
  ipYmlPath: (string | number)[];
  /** Path (relative to the ip core dir) of the managed:false HDL file this finding came from. */
  hdlFile: string;
  /** Top-level entity/module name parsed from hdlFile, or null if it couldn't be found. */
  hdlEntity: string | null;
}

interface ManagedHdlFile {
  path: string;
  type: string;
}

const HDL_TYPES = new Set(['vhdl', 'verilog', 'systemverilog']);

/**
 * The same file commonly appears in more than one fileSet (e.g. `RTL_Sources` and
 * `Simulation_Resources` both listing the same source) — dedup by path so it isn't
 * cross-checked, and doesn't produce findings, twice.
 */
function collectManagedHdlFiles(ipCoreData: IpCoreData): ManagedHdlFile[] {
  type FileSetEntry = { files?: Array<{ path?: string; type?: string; managed?: boolean }> };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;
  const files = new Map<string, ManagedHdlFile>();
  for (const fset of fileSets ?? []) {
    for (const f of fset.files ?? []) {
      if (f.managed === false && f.path && HDL_TYPES.has(f.type ?? '') && !files.has(f.path)) {
        files.set(f.path, { path: f.path, type: f.type as string });
      }
    }
  }
  return [...files.values()];
}

/** Scalar ports (std_logic / no explicit range) parse with width undefined — treat as 1 bit. */
function widthOf(w: number | string | undefined): number | string {
  return w ?? 1;
}

/**
 * Only flags a conflict when both widths resolve to plain numbers; a parametrized width
 * (e.g. "DATA_WIDTH") can't be evaluated statically, so it's left unchecked rather than
 * risk a false positive.
 */
function widthsConflict(a: number | string, b: number | string): boolean {
  return typeof a === 'number' && typeof b === 'number' && a !== b;
}

interface ExpectedSignal {
  name: string;
  direction?: string;
  width?: number | string;
  ipYmlPath: (string | number)[];
}

function collectExpectedSignals(ipCoreData: IpCoreData): ExpectedSignal[] {
  const signals: ExpectedSignal[] = [];
  (ipCoreData.ports ?? []).forEach((port, idx) => {
    if (port.name) {
      signals.push({
        name: port.name,
        direction: port.direction,
        width: port.width,
        ipYmlPath: ['ports', idx],
      });
    }
  });
  (ipCoreData.clocks ?? []).forEach((clock, idx) => {
    if (clock.name) {
      signals.push({ name: clock.name, direction: 'in', width: 1, ipYmlPath: ['clocks', idx] });
    }
  });
  (ipCoreData.resets ?? []).forEach((reset, idx) => {
    if (reset.name) {
      signals.push({ name: reset.name, direction: 'in', width: 1, ipYmlPath: ['resets', idx] });
    }
  });
  return signals;
}

interface ParsedManagedFile {
  file: ManagedHdlFile;
  entityName: string | null;
  hdlPortsByName: Map<string, ReturnType<typeof extractVhdlInterface>['ports'][number]>;
  hdlParamsByName: Map<string, ReturnType<typeof extractVhdlInterface>['parameters'][number]>;
}

/**
 * A project can have more than one managed:false HDL file (a hand-authored top plus
 * hand-authored submodules it instantiates). Only the top-level entity/module is expected to
 * expose the .ip.yml's full ports/clocks/resets/parameters — checking a submodule against
 * that same full list produces false `missing-port`/`missing-parameter` findings for every
 * signal the submodule legitimately doesn't have.
 *
 * With a single managed:false file there's no ambiguity — that's the file cross-checked
 * whether or not its name happens to match the IP core's. With more than one, this narrows
 * to the file whose entity/module name matches the IP core's name (the conventional
 * top-level); if none or more than one match, which file is the top can't be determined, so
 * every file is checked (the pre-existing, imperfect-but-non-silent behavior) rather than
 * silently skipping the cross-check.
 */
function selectTopLevelFiles(
  parsedFiles: ParsedManagedFile[],
  ipCoreData: IpCoreData
): ParsedManagedFile[] {
  if (parsedFiles.length <= 1) {
    return parsedFiles;
  }
  const coreName = ipCoreData.vlnv?.name?.toLowerCase();
  const matches = parsedFiles.filter((f) => f.entityName?.toLowerCase() === coreName);
  return matches.length === 1 ? matches : parsedFiles;
}

/**
 * Cross-checks a .ip.yml's declared ports/clocks/resets/parameters against the top-level
 * entity/module of the HDL file(s) its fileSets mark managed:false — i.e. hand-authored HDL
 * that IPCraft never generates and could silently drift from the spec (issue #74).
 *
 * Deliberately scoped to ports/clocks/resets/parameters, not busInterfaces: bus interface
 * physical port names are a generator-side reconstruction (physicalPrefix + per-port
 * overrides), not something declared directly in the .ip.yml, so they're out of scope here.
 */
export async function crossCheckIpCoreAgainstHdl(
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  readFile: (absPath: string) => Promise<string> = (p) => fs.readFile(p, 'utf8')
): Promise<HdlCrossCheckFinding[]> {
  const managedFiles = collectManagedHdlFiles(ipCoreData);
  const findings: HdlCrossCheckFinding[] = [];
  if (managedFiles.length === 0) {
    return findings;
  }

  const expectedSignals = collectExpectedSignals(ipCoreData);
  const expectedParams = (ipCoreData.parameters ?? []).map((p, idx) => ({ ...p, idx }));

  const parsedFiles: ParsedManagedFile[] = [];
  for (const file of managedFiles) {
    const absPath = path.resolve(ipCoreDir, file.path);
    let content: string;
    try {
      content = await readFile(absPath);
    } catch {
      // Not authored on disk yet — nothing to cross-check against.
      continue;
    }

    const isVhdl = file.type === 'vhdl';
    const parsed = isVhdl ? extractVhdlInterface(content) : extractVerilogInterface(content);
    const entityName = isVhdl
      ? (parsed as ReturnType<typeof extractVhdlInterface>).entityName
      : (parsed as ReturnType<typeof extractVerilogInterface>).moduleName;
    parsedFiles.push({
      file,
      entityName,
      hdlPortsByName: new Map(parsed.ports.map((p) => [p.name.toLowerCase(), p])),
      hdlParamsByName: new Map(parsed.parameters.map((p) => [p.name.toLowerCase(), p])),
    });
  }

  for (const { file, entityName, hdlPortsByName, hdlParamsByName } of selectTopLevelFiles(
    parsedFiles,
    ipCoreData
  )) {
    for (const expected of expectedSignals) {
      const hdlPort = hdlPortsByName.get(expected.name.toLowerCase());
      if (!hdlPort) {
        findings.push({
          kind: 'missing-port',
          message:
            `'${expected.name}' is declared in the .ip.yml but has no matching port in ` +
            `${file.path}${entityName ? ` (entity/module '${entityName}')` : ''}.`,
          ipYmlPath: expected.ipYmlPath,
          hdlFile: file.path,
          hdlEntity: entityName,
        });
        continue;
      }

      if (expected.direction && hdlPort.direction && expected.direction !== hdlPort.direction) {
        findings.push({
          kind: 'direction-mismatch',
          message:
            `'${expected.name}' is declared direction '${expected.direction}' in the .ip.yml ` +
            `but '${hdlPort.direction}' in ${file.path}#${hdlPort.name}.`,
          ipYmlPath: expected.ipYmlPath,
          hdlFile: file.path,
          hdlEntity: entityName,
        });
      }

      const expectedWidth = widthOf(expected.width);
      const hdlWidth = widthOf(hdlPort.width);
      if (widthsConflict(expectedWidth, hdlWidth)) {
        findings.push({
          kind: 'width-mismatch',
          message:
            `'${expected.name}' is declared width ${expectedWidth} in the .ip.yml but width ` +
            `${hdlWidth} in ${file.path}#${hdlPort.name}.`,
          ipYmlPath: expected.ipYmlPath,
          hdlFile: file.path,
          hdlEntity: entityName,
        });
      }
    }

    for (const param of expectedParams) {
      if (!param.name) {
        continue;
      }
      const hdlParam = hdlParamsByName.get(param.name.toLowerCase());
      if (!hdlParam) {
        findings.push({
          kind: 'missing-parameter',
          message:
            `Parameter '${param.name}' is declared in the .ip.yml but has no matching generic ` +
            `in ${file.path}${entityName ? ` (entity/module '${entityName}')` : ''}.`,
          ipYmlPath: ['parameters', param.idx],
          hdlFile: file.path,
          hdlEntity: entityName,
        });
        continue;
      }
      if (
        param.value !== undefined &&
        hdlParam.value !== undefined &&
        String(param.value).trim() !== String(hdlParam.value).trim()
      ) {
        findings.push({
          kind: 'parameter-default-mismatch',
          message:
            `Parameter '${param.name}' default is '${param.value}' in the .ip.yml but ` +
            `'${hdlParam.value}' in ${file.path}#${hdlParam.name}.`,
          ipYmlPath: ['parameters', param.idx],
          hdlFile: file.path,
          hdlEntity: entityName,
        });
      }
    }
  }

  return findings;
}
