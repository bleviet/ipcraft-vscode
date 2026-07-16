import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { extractVhdlInterface } from '../../parser/VhdlParser';
import { extractVerilogInterface } from '../../parser/VerilogParser';
import { parseHwTclContent } from '../../parser/HwTclParser';
import { parseComponentXmlText } from '../../parser/ComponentXmlParser';
import {
  normalizeIpCoreData,
  expandBusInterfaces,
  getActiveBusPortsFromDefinition,
} from '../registerProcessor';
import { reconstructBusPortNameSet } from '../../shared/busPortNameSet';
import { lookupBusDef } from '../../webview/ipcore/data/busDefinitions';
import { crossCheckMemoryMapsAgainstVendor } from './registerCrossCheck';
import type { IpCoreData, ParameterDef, PortDef } from '../types';
import {
  SEVERITY_BY_KIND,
  type HdlCrossCheckKind,
  type ConsistencySeverity,
  type ConsistencySource,
  type InferredPort,
  type InferredParameter,
  type HdlCrossCheckFinding,
} from './types';

export {
  SEVERITY_BY_KIND,
  type HdlCrossCheckKind,
  type ConsistencySeverity,
  type ConsistencySource,
  type InferredPort,
  type InferredParameter,
  type HdlCrossCheckFinding,
};

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

/**
 * Every HDL fileSet entry regardless of `managed` — unlike collectManagedHdlFiles, this also
 * picks up files the generator considers itself free to overwrite (managed: true, the schema
 * default). A file being generator-owned doesn't mean its on-disk content still matches the
 * .ip.yml: a user can hand-edit generated RTL directly without ever flipping the flag, and that
 * drift is exactly what the consistency check (issue #84) exists to catch — the same file
 * would otherwise regenerate over their edit with no warning.
 */
function collectAllHdlFiles(ipCoreData: IpCoreData): ManagedHdlFile[] {
  type FileSetEntry = { files?: Array<{ path?: string; type?: string }> };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;
  const files = new Map<string, ManagedHdlFile>();
  for (const fset of fileSets ?? []) {
    for (const f of fset.files ?? []) {
      if (f.path && HDL_TYPES.has(f.type ?? '') && !files.has(f.path)) {
        files.set(f.path, { path: f.path, type: f.type as string });
      }
    }
  }
  return [...files.values()];
}

/**
 * Physical port names already accounted for by the .ip.yml's busInterfaces/interrupts, so they
 * must never be flagged extra-port just because they aren't literally in `ports`: bus interface
 * physical names are a generator-side reconstruction (physicalPrefix + portNameOverrides, mirrored
 * here via reconstructBusPortNameSet/expandBusInterfaces — the same formula the generator itself
 * uses), and an interrupt's `name` is its physical port name declared outside `ports` entirely.
 * Conduit interfaces run their conduitPorts through the same getActiveBusPortsFromDefinition
 * reconstruction (mirroring VivadoComponentXmlGenerator's busDefPortMaps) rather than treating
 * conduitPorts[].name as already-final: a conduit can still declare its own physicalPrefix (e.g.
 * to namespace an interface's signals), in which case the generator prefixes each conduit port's
 * name exactly as it would a standard bus's logical port.
 */
function collectAccountedForPortNames(ipCoreData: IpCoreData): Set<string> {
  const names = new Set<string>();

  for (const iface of expandBusInterfaces(ipCoreData)) {
    if ((iface.mode ?? '').toLowerCase() === 'conduit') {
      const activeConduitPorts = getActiveBusPortsFromDefinition(
        (iface.conduitPorts ?? []) as Array<{
          name: string;
          width?: number | string;
          direction?: string;
          presence?: string;
        }>,
        iface.useOptionalPorts ?? [],
        iface.physicalPrefix ?? '',
        iface.mode ?? '',
        iface.portWidthOverrides ?? {},
        undefined,
        iface.portNameOverrides,
        iface.absentPorts
      );
      for (const p of activeConduitPorts) {
        names.add(String(p.name).toLowerCase());
      }
      continue;
    }
    const reconstructed = reconstructBusPortNameSet(iface);
    if (reconstructed) {
      for (const name of reconstructed) {
        names.add(name);
      }
    } else {
      // Unrecognized/custom bus type imported from component.xml — rawPortMaps preserves the
      // literal physical names verbatim instead of a prefix+suffix formula to reconstruct.
      for (const portMap of iface.rawPortMaps ?? []) {
        if (portMap.physical) {
          names.add(portMap.physical.toLowerCase());
        }
      }
    }
  }

  const interrupts = (ipCoreData as Record<string, unknown>).interrupts as
    | Array<{ name?: string }>
    | undefined;
  for (const irq of interrupts ?? []) {
    if (irq.name) {
      names.add(irq.name.toLowerCase());
    }
  }

  return names;
}

/**
 * Removes accounted-for physical ports from an implementation's port map before diffing, so
 * they neither surface as extra-port nor risk shadowing a same-named expected port/parameter.
 */
function withoutAccountedForPorts(
  ports: Map<string, ImplPort>,
  accountedFor: Set<string>
): Map<string, ImplPort> {
  if (accountedFor.size === 0) {
    return ports;
  }
  const filtered = new Map<string, ImplPort>();
  for (const [key, value] of ports) {
    if (!accountedFor.has(key)) {
      filtered.set(key, value);
    }
  }
  return filtered;
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

/**
 * Strips a single layer of literal double-quotes from a string-typed parameter value, mirroring
 * resolveGenericDefault's convention (generator/resolvers/generics.ts): a .ip.yml author may write
 * a string default either bare (`COMP`) or already wrapped in VHDL string-literal quotes
 * (`"COMP"`) — the generator treats both as equivalent. Applied to *both* sides of the comparison
 * (not just the .ip.yml side) because the implementation side carries the same ambiguity: VhdlParser
 * already strips quotes at parse time (unquoteVhdlLiteral, issue #94) and HwTclParser's tokenizer
 * strips TCL's own quote delimiters, but ComponentXmlParser does not — a Vivado `format="string"`
 * modelParameter's raw XML text is the literal VHDL syntax (`"COMP"`), quotes and all.
 */
function normalizeStringParamValue(value: string, dataType: string | undefined): string {
  if (!/\bstring\b/i.test(dataType ?? '')) {
    return value;
  }
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

interface ExpectedBusPort {
  physicalName: string;
  direction?: string;
  width: number;
  logicalName: string;
  ifaceName: string;
  ipYmlPath: (string | number)[];
}

/**
 * Reconstructs each recognized (non-conduit) bus interface's active physical ports — name,
 * direction, width — using the generator's own getActiveBusPortsFromDefinition (mirroring
 * registerProcessor.ts's expandBusInterfaces + per-interface expansion), so "expected" here is
 * exactly what the generator itself would emit. Conduit interfaces and unrecognized/custom bus
 * types (lookupBusDef returns null or an empty array) are skipped — their physical ports remain
 * excluded from extra-port via collectAccountedForPortNames's conduitPorts/rawPortMaps fallback;
 * signal-by-signal diffing isn't possible without a known bus definition to diff against.
 *
 * Iterates busInterfaces one at a time (rather than expanding the whole list in one call) so an
 * array interface's expanded copies can still be traced back to their original ipYmlPath index —
 * expandBusInterfaces itself doesn't retain that mapping once interfaces are flattened together.
 */
function collectExpectedBusPorts(ipCoreData: IpCoreData): ExpectedBusPort[] {
  const result: ExpectedBusPort[] = [];
  (ipCoreData.busInterfaces ?? []).forEach((rawIface, origIdx) => {
    const expanded = expandBusInterfaces({
      ...ipCoreData,
      busInterfaces: [rawIface],
    } as IpCoreData);

    for (const iface of expanded) {
      if ((iface.mode ?? '').toLowerCase() === 'conduit') {
        continue;
      }
      const busDef = lookupBusDef(iface.type ?? '');
      if (!busDef || busDef.length === 0) {
        continue;
      }
      const activePorts = getActiveBusPortsFromDefinition(
        busDef,
        iface.useOptionalPorts ?? [],
        iface.physicalPrefix ?? '',
        iface.mode ?? '',
        iface.portWidthOverrides ?? {},
        ipCoreData.parameters as
          | { name: string; value?: number | string; data_type?: string }[]
          | undefined,
        iface.portNameOverrides,
        iface.absentPorts
      );
      for (const p of activePorts) {
        result.push({
          physicalName: String(p.name),
          direction: typeof p.direction === 'string' ? p.direction : undefined,
          width: Number(p.width),
          logicalName: String(p.logical_name),
          ifaceName: iface.name ?? rawIface.name ?? '',
          ipYmlPath: ['busInterfaces', origIdx],
        });
      }
    }
  });
  return result;
}

/**
 * Diffs a bus interface's expected physical ports (collectExpectedBusPorts) against an
 * implementation's full (unfiltered) port map, emitting missing-bus-port /
 * bus-port-direction-mismatch / bus-port-width-mismatch. Matched physical names are removed from
 * the returned map so callers can still run the regular extra-port pass over what's left without
 * double-flagging a bus signal that was already diffed here (whether it matched cleanly or not).
 */
/**
 * Reduces a bus interface's active ports to the same name-keyed ImplPort shape used for HDL/
 * vendor ports, so a vendor's own reconstructed bus interfaces (see collectExpectedBusPorts's
 * docstring on vendorData below) can be diffed with the same diffBusPorts comparator used for
 * the .ip.yml side.
 */
function busPortsToImplPortMap(busPorts: ExpectedBusPort[]): Map<string, ImplPort> {
  const map = new Map<string, ImplPort>();
  for (const p of busPorts) {
    map.set(p.physicalName.toLowerCase(), {
      name: p.physicalName,
      direction: p.direction,
      width: p.width,
    });
  }
  return map;
}

function diffBusPorts(
  expectedBusPorts: ExpectedBusPort[],
  implPortsByName: Map<string, ImplPort>,
  sourceFile: string,
  sourceEntity: string | null,
  source: ConsistencySource
): { findings: HdlCrossCheckFinding[]; remainingImplPorts: Map<string, ImplPort> } {
  const findings: HdlCrossCheckFinding[] = [];
  const remaining = new Map(implPortsByName);

  const push = (kind: HdlCrossCheckKind, message: string, ipYmlPath: (string | number)[]): void => {
    findings.push({
      kind,
      message,
      ipYmlPath,
      hdlFile: sourceFile,
      hdlEntity: sourceEntity,
      severity: SEVERITY_BY_KIND[kind],
      source,
    });
  };

  for (const expected of expectedBusPorts) {
    const key = expected.physicalName.toLowerCase();
    const implPort = remaining.get(key);
    remaining.delete(key);

    const label = `'${expected.physicalName}' (${expected.logicalName} on bus interface '${expected.ifaceName}')`;

    if (!implPort) {
      push(
        'missing-bus-port',
        `${label} is declared in the .ip.yml but has no matching port in ${sourceFile}` +
          `${sourceEntity ? ` (entity/module '${sourceEntity}')` : ''}.`,
        expected.ipYmlPath
      );
      continue;
    }

    if (expected.direction && implPort.direction && expected.direction !== implPort.direction) {
      push(
        'bus-port-direction-mismatch',
        `${label} is declared direction '${expected.direction}' in the .ip.yml but ` +
          `'${implPort.direction}' in ${sourceFile}#${implPort.name}.`,
        expected.ipYmlPath
      );
    }

    if (widthsConflict(expected.width, widthOf(implPort.width))) {
      push(
        'bus-port-width-mismatch',
        `${label} is declared width ${expected.width} in the .ip.yml but width ` +
          `${widthOf(implPort.width)} in ${sourceFile}#${implPort.name}.`,
        expected.ipYmlPath
      );
    }
  }

  return { findings, remainingImplPorts: remaining };
}

interface ExpectedSignal {
  name: string;
  direction?: string;
  width?: number | string;
  ipYmlPath: (string | number)[];
}

interface ExpectedParam {
  name?: string;
  value?: number | string;
  dataType?: string;
  idx: number;
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

interface ImplPort {
  name: string;
  direction?: string;
  width?: number | string;
}

interface ImplParam {
  name: string;
  value?: string;
}

/**
 * Flattens an implementation-side IpCoreData (parsed from a vendor artifact) into the same
 * name-keyed port shape used for HDL ports, merging in its clocks/resets exactly as
 * collectExpectedSignals does for the .ip.yml side — otherwise a vendor-declared clock with no
 * .ip.yml counterpart would never surface as an extra-port finding.
 */
function collectImplPorts(coreData: IpCoreData): Map<string, ImplPort> {
  const ports = new Map<string, ImplPort>();
  (coreData.ports ?? []).forEach((port) => {
    if (port.name) {
      ports.set(port.name.toLowerCase(), {
        name: port.name,
        direction: port.direction,
        width: port.width,
      });
    }
  });
  (coreData.clocks ?? []).forEach((clock) => {
    if (clock.name && !ports.has(clock.name.toLowerCase())) {
      ports.set(clock.name.toLowerCase(), { name: clock.name, direction: 'in', width: 1 });
    }
  });
  (coreData.resets ?? []).forEach((reset) => {
    if (reset.name && !ports.has(reset.name.toLowerCase())) {
      ports.set(reset.name.toLowerCase(), { name: reset.name, direction: 'in', width: 1 });
    }
  });
  return ports;
}

function collectImplParams(coreData: IpCoreData): Map<string, ImplParam> {
  const params = new Map<string, ImplParam>();
  (coreData.parameters ?? []).forEach((param) => {
    if (param.name) {
      params.set(param.name.toLowerCase(), {
        name: param.name,
        value: param.value !== undefined ? String(param.value) : undefined,
      });
    }
  });
  return params;
}

interface ParsedManagedFile {
  file: ManagedHdlFile;
  entityName: string | null;
  hdlPortsByName: Map<string, ImplPort>;
  hdlParamsByName: Map<string, ImplParam>;
  /** Unfiltered port map (before withoutAccountedForPorts) — bus-port diffing needs to see bus
   *  signals directly rather than the accounted-for-stripped map used for the regular ports diff. */
  rawHdlPortsByName: Map<string, ImplPort>;
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
  if (!coreName) {
    // No IP core name to match against (e.g. schema-invalid .ip.yml) — can't identify the
    // top, so fall through to checking every file rather than matching every file whose
    // entityName also failed to parse (undefined === undefined).
    return parsedFiles;
  }
  const matches = parsedFiles.filter((f) => f.entityName?.toLowerCase() === coreName);
  return matches.length === 1 ? matches : parsedFiles;
}

/**
 * Diffs the .ip.yml's declared ports/clocks/resets/parameters against a single implementation
 * source (an HDL top-level entity/module, or a vendor artifact reduced to the same name-keyed
 * port/parameter maps), emitting both directions of drift: SSOT-only (missing-*, declared in the
 * .ip.yml but absent from the implementation) and implementation-only (extra-*, present in the
 * implementation but not yet declared in the .ip.yml).
 */
function diffAgainstImplementation(
  expectedSignals: ExpectedSignal[],
  expectedParams: ExpectedParam[],
  implPortsByName: Map<string, ImplPort>,
  implParamsByName: Map<string, ImplParam>,
  sourceFile: string,
  sourceEntity: string | null,
  source: ConsistencySource
): HdlCrossCheckFinding[] {
  const findings: HdlCrossCheckFinding[] = [];
  const matchedPortKeys = new Set<string>();
  const matchedParamKeys = new Set<string>();

  const push = (
    kind: HdlCrossCheckKind,
    message: string,
    ipYmlPath: (string | number)[],
    inferred?: InferredPort | InferredParameter
  ): void => {
    findings.push({
      kind,
      message,
      ipYmlPath,
      hdlFile: sourceFile,
      hdlEntity: sourceEntity,
      severity: SEVERITY_BY_KIND[kind],
      source,
      ...(inferred ? { inferred } : {}),
    });
  };

  for (const expected of expectedSignals) {
    const key = expected.name.toLowerCase();
    const implPort = implPortsByName.get(key);
    if (!implPort) {
      push(
        'missing-port',
        `'${expected.name}' is declared in the .ip.yml but has no matching port in ` +
          `${sourceFile}${sourceEntity ? ` (entity/module '${sourceEntity}')` : ''}.`,
        expected.ipYmlPath
      );
      continue;
    }
    matchedPortKeys.add(key);

    if (expected.direction && implPort.direction && expected.direction !== implPort.direction) {
      push(
        'direction-mismatch',
        `'${expected.name}' is declared direction '${expected.direction}' in the .ip.yml ` +
          `but '${implPort.direction}' in ${sourceFile}#${implPort.name}.`,
        expected.ipYmlPath
      );
    }

    const expectedWidth = widthOf(expected.width);
    const implWidth = widthOf(implPort.width);
    if (widthsConflict(expectedWidth, implWidth)) {
      push(
        'width-mismatch',
        `'${expected.name}' is declared width ${expectedWidth} in the .ip.yml but width ` +
          `${implWidth} in ${sourceFile}#${implPort.name}.`,
        expected.ipYmlPath
      );
    }
  }

  for (const param of expectedParams) {
    if (!param.name) {
      continue;
    }
    const key = param.name.toLowerCase();
    const implParam = implParamsByName.get(key);
    if (!implParam) {
      push(
        'missing-parameter',
        `Parameter '${param.name}' is declared in the .ip.yml but has no matching generic ` +
          `in ${sourceFile}${sourceEntity ? ` (entity/module '${sourceEntity}')` : ''}.`,
        ['parameters', param.idx]
      );
      continue;
    }
    matchedParamKeys.add(key);

    if (
      param.value !== undefined &&
      implParam.value !== undefined &&
      normalizeStringParamValue(String(param.value), param.dataType).trim() !==
        normalizeStringParamValue(implParam.value, param.dataType).trim()
    ) {
      push(
        'parameter-default-mismatch',
        `Parameter '${param.name}' default is '${param.value}' in the .ip.yml but ` +
          `'${implParam.value}' in ${sourceFile}#${implParam.name}.`,
        ['parameters', param.idx]
      );
    }
  }

  for (const [key, implPort] of implPortsByName) {
    if (matchedPortKeys.has(key)) {
      continue;
    }
    push(
      'extra-port',
      `'${implPort.name}' exists in ${sourceFile}` +
        `${sourceEntity ? ` (entity/module '${sourceEntity}')` : ''} but is not declared in the .ip.yml.`,
      ['ports'],
      { name: implPort.name, direction: implPort.direction, width: implPort.width }
    );
  }

  for (const [key, implParam] of implParamsByName) {
    if (matchedParamKeys.has(key)) {
      continue;
    }
    push(
      'extra-parameter',
      `Parameter '${implParam.name}' exists in ${sourceFile}` +
        `${sourceEntity ? ` (entity/module '${sourceEntity}')` : ''} but is not declared in the .ip.yml.`,
      ['parameters'],
      { name: implParam.name, value: implParam.value }
    );
  }

  return findings;
}

/**
 * Shared body for both HDL cross-check entry points below: parses each candidate file, narrows
 * to the top-level entity/module (selectTopLevelFiles), and diffs it against the .ip.yml. The
 * only thing that differs between the two public functions is which files are candidates.
 */
async function diffAgainstHdlFiles(
  files: ManagedHdlFile[],
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  readFile: (absPath: string) => Promise<string>
): Promise<HdlCrossCheckFinding[]> {
  const findings: HdlCrossCheckFinding[] = [];
  if (files.length === 0) {
    return findings;
  }

  const expectedSignals = collectExpectedSignals(ipCoreData);
  const expectedParams = (ipCoreData.parameters ?? []).map((p, idx) => ({ ...p, idx }));
  const accountedFor = collectAccountedForPortNames(ipCoreData);
  const expectedBusPorts = collectExpectedBusPorts(ipCoreData);

  const parsedFiles: ParsedManagedFile[] = [];
  for (const file of files) {
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
    const rawHdlPortsByName = new Map(parsed.ports.map((p) => [p.name.toLowerCase(), p]));
    parsedFiles.push({
      file,
      entityName,
      hdlPortsByName: withoutAccountedForPorts(rawHdlPortsByName, accountedFor),
      hdlParamsByName: new Map(
        parsed.parameters.map((p) => [p.name.toLowerCase(), { name: p.name, value: p.value }])
      ),
      rawHdlPortsByName,
    });
  }

  for (const {
    file,
    entityName,
    hdlPortsByName,
    hdlParamsByName,
    rawHdlPortsByName,
  } of selectTopLevelFiles(parsedFiles, ipCoreData)) {
    findings.push(
      ...diffBusPorts(expectedBusPorts, rawHdlPortsByName, file.path, entityName, 'hdl').findings
    );
    findings.push(
      ...diffAgainstImplementation(
        expectedSignals,
        expectedParams,
        hdlPortsByName,
        hdlParamsByName,
        file.path,
        entityName,
        'hdl'
      )
    );
  }

  return findings;
}

/**
 * Cross-checks a .ip.yml's declared ports/clocks/resets/parameters against the top-level
 * entity/module of the HDL file(s) its fileSets mark managed:false — i.e. hand-authored HDL
 * that IPCraft never generates and could silently drift from the spec (issue #74).
 *
 * Also diffs each recognized bus interface's physical ports signal-by-signal (missing-bus-port /
 * bus-port-direction-mismatch / bus-port-width-mismatch — issue #96) via collectExpectedBusPorts +
 * diffBusPorts, reconstructed the same way the generator itself expands physicalPrefix + per-port
 * overrides. Conduit/custom interfaces (no known bus definition) fall back to the coarser
 * collectAccountedForPortNames exclusion — their literal port names are still kept out of
 * extra-port, but aren't diffed signal-by-signal. Interrupts are excluded from extra-port the
 * same way, also without per-signal diffing.
 *
 * Scoped to managed:false files only — see crossCheckIpCoreAgainstTopLevelHdl for the broader
 * check (issue #84) that also covers generator-owned (managed:true) HDL.
 */
export async function crossCheckIpCoreAgainstHdl(
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  readFile: (absPath: string) => Promise<string> = (p) => fs.readFile(p, 'utf8')
): Promise<HdlCrossCheckFinding[]> {
  return diffAgainstHdlFiles(collectManagedHdlFiles(ipCoreData), ipCoreData, ipCoreDir, readFile);
}

/**
 * The issue #84 Consistency Check's HDL arm: cross-checks against the top-level entity/module
 * among *every* HDL file in fileSets, regardless of the managed flag. A generator-owned
 * (managed: true) file is nominally safe to overwrite, but nothing stops a user from
 * hand-editing it directly without flipping that flag or updating the .ip.yml — and unlike a
 * managed:false file, that drift is actively dangerous: the next generate silently overwrites
 * the edit with no warning. crossCheckIpCoreAgainstHdl's managed:false-only scoping (issue #74)
 * exists to protect hand-authored files from being flagged as generator drift; this function
 * instead answers "does the .ip.yml still match what's actually on disk", independent of who
 * owns the file.
 */
export async function crossCheckIpCoreAgainstTopLevelHdl(
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  readFile: (absPath: string) => Promise<string> = (p) => fs.readFile(p, 'utf8')
): Promise<HdlCrossCheckFinding[]> {
  return diffAgainstHdlFiles(collectAllHdlFiles(ipCoreData), ipCoreData, ipCoreDir, readFile);
}

export type VendorSource = 'hwTcl' | 'componentXml';

/**
 * Vendor artifacts live at conventional, non-configurable paths relative to the .ip.yml —
 * the same locations the toolchains (VivadoToolchain / QuartusToolchain) scaffold them at.
 */
function vendorRelPath(ipCoreData: IpCoreData, source: VendorSource): string | null {
  if (source === 'componentXml') {
    return path.join('xilinx', 'component.xml');
  }
  const name = ipCoreData.vlnv?.name;
  if (!name) {
    return null;
  }
  return path.join('altera', `${name.toLowerCase()}_hw.tcl`);
}

/**
 * Cross-checks a .ip.yml against a vendor-scaffolded artifact (_hw.tcl or component.xml) at its
 * conventional path, reusing the same importers the manual "Import" commands use and the same
 * diffAgainstImplementation comparator as the HDL arm. Deliberately uses each importer's pure
 * string entry point (parseHwTclContent / parseComponentXmlText) rather than its file-reading
 * wrapper so this stays testable via the injected readFile — the tradeoff is that _hw.tcl
 * `source`-included sub-files are not flattened here (only IpCoreSourcePreviewProvider's
 * file-based import path does that); self-contained _hw.tcl files are unaffected.
 */
export async function crossCheckIpCoreAgainstVendor(
  ipCoreData: IpCoreData,
  ipCoreDir: string,
  source: VendorSource,
  readFile: (absPath: string) => Promise<string> = (p) => fs.readFile(p, 'utf8')
): Promise<HdlCrossCheckFinding[]> {
  const relPath = vendorRelPath(ipCoreData, source);
  if (!relPath) {
    return [];
  }
  const absPath = path.resolve(ipCoreDir, relPath);

  let content: string;
  try {
    content = await readFile(absPath);
  } catch {
    // Vendor artifact not scaffolded yet — nothing to cross-check against.
    return [];
  }

  let vendorYamlText: string;
  let vendorMmYamlText: string | undefined;
  try {
    if (source === 'hwTcl') {
      vendorYamlText = parseHwTclContent(content, absPath).yamlText;
    } else {
      const parsedComponent = parseComponentXmlText(content);
      vendorYamlText = parsedComponent.ipYamlText;
      vendorMmYamlText = parsedComponent.mmYamlText;
    }
  } catch {
    // Unparsable vendor artifact (e.g. mid-edit, hand-corrupted) — skip rather than fail the
    // whole consistency check over one bad file.
    return [];
  }

  const parsed: unknown = yaml.load(vendorYamlText);
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const vendorData = normalizeIpCoreData(parsed as Record<string, unknown>);

  const expectedSignals = collectExpectedSignals(ipCoreData);
  const expectedParams: ExpectedParam[] = (ipCoreData.parameters ?? []).map((p, idx) => ({
    ...p,
    idx,
  }));
  const expectedBusPorts = collectExpectedBusPorts(ipCoreData);
  const rawVendorPorts = collectImplPorts(vendorData);
  const vendorEntity = vendorData.vlnv?.name ?? null;

  // Vendor importers (HwTclParser/ComponentXmlParser) never flatten a recognized bus
  // interface's physical ports into the top-level `ports:` list — like the .ip.yml side, they
  // reconstruct physicalPrefix/portNameOverrides/useOptionalPorts from the physical signals they
  // actually saw. So the vendor's bus ports live in vendorData.busInterfaces, not
  // collectImplPorts(vendorData); reuse collectExpectedBusPorts on the vendor side too and diff
  // against that instead — the vendor's derivation is lossless, so its reconstructed physical
  // names/widths are exactly what the artifact declared.
  const vendorBusPorts = busPortsToImplPortMap(collectExpectedBusPorts(vendorData));

  const busFindings = diffBusPorts(
    expectedBusPorts,
    vendorBusPorts,
    relPath,
    vendorEntity,
    source
  ).findings;

  // Register/field comparison (issue #96) only applies to component.xml — Platform Designer's
  // _hw.tcl carries no memory-map/register data to diff against.
  const registerFindings =
    source === 'componentXml' && vendorMmYamlText
      ? await crossCheckMemoryMapsAgainstVendor(
          ipCoreData,
          ipCoreDir,
          vendorMmYamlText,
          relPath,
          source,
          readFile
        )
      : [];

  return [
    ...busFindings,
    ...registerFindings,
    ...diffAgainstImplementation(
      expectedSignals,
      expectedParams,
      withoutAccountedForPorts(rawVendorPorts, collectAccountedForPortNames(ipCoreData)),
      collectImplParams(vendorData),
      relPath,
      vendorEntity,
      source
    ),
  ];
}

// Re-exported so consumers can build inferred port/parameter shapes without reaching into
// generator internals.
export type { PortDef, ParameterDef };
