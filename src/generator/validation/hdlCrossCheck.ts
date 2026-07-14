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

function collectManagedHdlFiles(ipCoreData: IpCoreData): ManagedHdlFile[] {
  type FileSetEntry = { files?: Array<{ path?: string; type?: string; managed?: boolean }> };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;
  const files: ManagedHdlFile[] = [];
  for (const fset of fileSets ?? []) {
    for (const f of fset.files ?? []) {
      if (f.managed === false && f.path && HDL_TYPES.has(f.type ?? '')) {
        files.push({ path: f.path, type: f.type as string });
      }
    }
  }
  return files;
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

/**
 * Cross-checks a .ip.yml's declared ports/clocks/resets/parameters against the top-level
 * entity/module of every HDL file its fileSets mark managed:false — i.e. hand-authored HDL
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
    const hdlPorts = parsed.ports;
    const hdlParams = parsed.parameters;
    const hdlPortsByName = new Map(hdlPorts.map((p) => [p.name.toLowerCase(), p]));
    const hdlParamsByName = new Map(hdlParams.map((p) => [p.name.toLowerCase(), p]));

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
