import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { extractVhdlInterface } from '../../parser/VhdlParser';
import { extractVerilogInterface } from '../../parser/VerilogParser';
import { parseHwTclContent } from '../../parser/HwTclParser';
import { parseComponentXmlText } from '../../parser/ComponentXmlParser';
import { normalizeIpCoreData, expandBusInterfaces } from '../registerProcessor';
import { reconstructBusPortNameSet } from '../../shared/busPortNameSet';
import type { IpCoreData, ParameterDef, PortDef } from '../types';

export type HdlCrossCheckKind =
  | 'missing-port'
  | 'extra-port'
  | 'direction-mismatch'
  | 'width-mismatch'
  | 'missing-parameter'
  | 'extra-parameter'
  | 'parameter-default-mismatch';

/** amber = additive/reconcilable (e.g. a new HDL port not yet in the .ip.yml); red = destructive/conflict. */
export type ConsistencySeverity = 'amber' | 'red';

export type ConsistencySource = 'hdl' | 'hwTcl' | 'componentXml';

const SEVERITY_BY_KIND: Record<HdlCrossCheckKind, ConsistencySeverity> = {
  'missing-port': 'red',
  'extra-port': 'amber',
  'direction-mismatch': 'red',
  'width-mismatch': 'amber',
  'missing-parameter': 'red',
  'extra-parameter': 'amber',
  'parameter-default-mismatch': 'amber',
};

export interface InferredPort {
  name: string;
  direction?: string;
  width?: number | string;
}

export interface InferredParameter {
  name: string;
  value?: string;
}

export interface HdlCrossCheckFinding {
  kind: HdlCrossCheckKind;
  message: string;
  /** Path into the .ip.yml, e.g. ['ports', 2], ['clocks', 0] or ['parameters', 1]. For
   *  extra-port/extra-parameter (no existing entry yet) this is the collection itself,
   *  e.g. ['ports'], since there is no index to point at. */
  ipYmlPath: (string | number)[];
  /** Path (relative to the ip core dir) of the implementation source this finding came from. */
  hdlFile: string;
  /** Top-level entity/module/component name parsed from hdlFile, or null if it couldn't be found. */
  hdlEntity: string | null;
  severity: ConsistencySeverity;
  source: ConsistencySource;
  /** For extra-port/extra-parameter: the implementation-declared shape, ready to insert into the
   *  .ip.yml verbatim if the user chooses to adopt it. */
  inferred?: InferredPort | InferredParameter;
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
 * Conduit interfaces declare their signals' literal physical names directly in `conduitPorts`.
 */
function collectAccountedForPortNames(ipCoreData: IpCoreData): Set<string> {
  const names = new Set<string>();

  for (const iface of expandBusInterfaces(ipCoreData)) {
    if ((iface.mode ?? '').toLowerCase() === 'conduit') {
      for (const cp of iface.conduitPorts ?? []) {
        const name = (cp as { name?: string }).name;
        if (name) {
          names.add(name.toLowerCase());
        }
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

interface ExpectedSignal {
  name: string;
  direction?: string;
  width?: number | string;
  ipYmlPath: (string | number)[];
}

interface ExpectedParam {
  name?: string;
  value?: number | string;
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
      String(param.value).trim() !== implParam.value.trim()
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
    parsedFiles.push({
      file,
      entityName,
      hdlPortsByName: withoutAccountedForPorts(
        new Map(parsed.ports.map((p) => [p.name.toLowerCase(), p])),
        accountedFor
      ),
      hdlParamsByName: new Map(
        parsed.parameters.map((p) => [p.name.toLowerCase(), { name: p.name, value: p.value }])
      ),
    });
  }

  for (const { file, entityName, hdlPortsByName, hdlParamsByName } of selectTopLevelFiles(
    parsedFiles,
    ipCoreData
  )) {
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
 * Does not validate individual bus-interface ports (missing/mismatched physical signals) —
 * those are a generator-side reconstruction (physicalPrefix + per-port overrides), not something
 * declared directly as a `ports` entry, so verifying them signal-by-signal is out of scope here.
 * Their reconstructed physical names (plus interrupts' and conduit ports') are still excluded
 * from extra-port detection via collectAccountedForPortNames — otherwise every bus/interrupt
 * signal in the HDL would be wrongly reported as an undeclared new port.
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
  try {
    vendorYamlText =
      source === 'hwTcl'
        ? parseHwTclContent(content, absPath).yamlText
        : parseComponentXmlText(content).ipYamlText;
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

  return diffAgainstImplementation(
    expectedSignals,
    expectedParams,
    withoutAccountedForPorts(
      collectImplPorts(vendorData),
      collectAccountedForPortNames(ipCoreData)
    ),
    collectImplParams(vendorData),
    relPath,
    vendorData.vlnv?.name ?? null,
    source
  );
}

// Re-exported so consumers can build inferred port/parameter shapes without reaching into
// generator internals.
export type { PortDef, ParameterDef };
