import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { lookupBusDef } from '../webview/ipcore/data/busDefinitions';
import { resolveVendor } from '../utils/resolveVendor';

export interface HwTclParseOptions {
  library?: string;
  outputDir?: string;
  vendor?: string;
}

export interface HwTclParseResult {
  componentName: string;
  yamlText: string;
}

interface TclInterface {
  name: string;
  type: string;
  mode: string;
  properties: Map<string, string>;
  ports: TclPort[];
}

interface TclPort {
  portName: string;
  logicalName: string;
  direction: string;
  width: number;
}

interface TclFileSet {
  name: string;
  files: TclFile[];
}

interface TclFile {
  lang: string;
  filePath: string;
}

interface TclParameter {
  name: string;
  type: string;
  defaultValue?: string;
}

const BUS_TYPE_MAP: Record<string, string> = {
  axi4lite: 'ipcraft.busif.axi4_lite.1.0',
  axi4: 'ipcraft.busif.axi4_full.1.0',
  avalon: 'ipcraft.busif.avalon_mm.1.0',
  avalon_streaming: 'ipcraft.busif.avalon_st.1.0',
  avalonst: 'ipcraft.busif.avalon_st.1.0',
  axi4stream: 'ipcraft.busif.axi_stream.1.0',
  axis: 'ipcraft.busif.axi_stream.1.0',
};

const STREAMING_TYPES = new Set(['avalon_streaming', 'avalonst', 'axi4stream', 'axis']);

const FILE_TYPE_MAP: Record<string, string> = {
  VHDL: 'vhdl',
  VERILOG: 'verilog',
  SYSTEM_VERILOG: 'systemverilog',
  TCL: 'tcl',
  SDC: 'sdc',
  OTHER: 'unknown',
};

const FILESET_NAME_MAP: Record<string, string> = {
  QUARTUS_SYNTH: 'RTL_Sources',
  SIM_VHDL: 'Simulation_Resources',
  SIM_VERILOG: 'Simulation_Resources',
  SIM_SYSTEMVERILOG: 'Simulation_Resources',
  SIMULATION: 'Simulation_Resources',
};

const FILESET_DESC_MAP: Record<string, string> = {
  RTL_Sources: 'RTL source files',
  Simulation_Resources: 'Simulation files',
};

export async function parseHwTclFile(
  tclPath: string,
  options: HwTclParseOptions = {}
): Promise<HwTclParseResult> {
  const content = await fs.readFile(tclPath, 'utf8');
  return parseHwTclContent(content, tclPath, options);
}

export function parseHwTclContent(
  content: string,
  tclPath: string,
  options: HwTclParseOptions = {}
): HwTclParseResult {
  const moduleProps = new Map<string, string>();
  const interfaces = new Map<string, TclInterface>();
  const fileSets = new Map<string, TclFileSet>();
  const parameters: TclParameter[] = [];
  let currentFileSet: TclFileSet | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const tokens = parseTclTokens(line);
    if (tokens.length === 0) {
      continue;
    }

    const [cmd, ...args] = tokens;

    if (cmd === 'set_module_property' && args.length >= 2) {
      moduleProps.set(args[0], args[1]);
    } else if (cmd === 'add_interface' && args.length >= 3) {
      const [name, type, mode] = args;
      interfaces.set(name, {
        name,
        type: type.toLowerCase(),
        mode: mode.toLowerCase(),
        properties: new Map(),
        ports: [],
      });
    } else if (cmd === 'set_interface_property' && args.length >= 3) {
      const [ifaceName, prop, value] = args;
      interfaces.get(ifaceName)?.properties.set(prop, value);
    } else if (cmd === 'add_interface_port' && args.length >= 5) {
      const [ifaceName, portName, logicalName, direction, widthStr] = args;
      interfaces.get(ifaceName)?.ports.push({
        portName,
        logicalName,
        direction,
        width: parseInt(widthStr, 10) || 1,
      });
    } else if (cmd === 'add_fileset' && args.length >= 1) {
      const fsName = args[0];
      if (!fileSets.has(fsName)) {
        const entry: TclFileSet = { name: fsName, files: [] };
        fileSets.set(fsName, entry);
        currentFileSet = entry;
      } else {
        currentFileSet = fileSets.get(fsName)!;
      }
    } else if (cmd === 'add_fileset_file' && args.length >= 4 && currentFileSet) {
      // add_fileset_file <name> <lang> PATH <path> [TOP_LEVEL_FILE]
      const pathIdx = args.indexOf('PATH');
      if (pathIdx !== -1 && pathIdx + 1 < args.length) {
        currentFileSet.files.push({ lang: args[1], filePath: args[pathIdx + 1] });
      }
    } else if (cmd === 'add_parameter' && args.length >= 2) {
      parameters.push({ name: args[0], type: args[1], defaultValue: args[2] });
    } else if (
      cmd === 'set_parameter_property' &&
      args.length >= 3 &&
      args[1] === 'DEFAULT_VALUE'
    ) {
      const param = parameters.find((p) => p.name === args[0]);
      if (param) {
        param.defaultValue = args[2];
      }
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const componentName =
    moduleProps.get('NAME') ??
    path
      .basename(tclPath)
      .replace(/_hw\.tcl$/i, '')
      .replace(/\.tcl$/i, '');

  // Author from hw.tcl AUTHOR property; fall back through setting → git email → default
  const authorFromTcl = moduleProps.get('AUTHOR')?.trim();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const vendor = authorFromTcl || resolveVendor(options.vendor);

  const yamlData: Record<string, unknown> = {
    vlnv: {
      vendor,
      library: options.library ?? 'ip',
      name: componentName,
      version: moduleProps.get('VERSION') ?? '1.0.0',
    },
  };

  const description = moduleProps.get('DESCRIPTION');
  if (description) {
    yamlData.description = description;
  }

  // ── Interface classification ────────────────────────────────────────────────

  const clockIfaces = Array.from(interfaces.values()).filter((i) => i.type === 'clock');
  const resetIfaces = Array.from(interfaces.values()).filter((i) => i.type === 'reset');
  const conduitIfaces = Array.from(interfaces.values()).filter((i) => i.type === 'conduit');
  const interruptIfaces = Array.from(interfaces.values()).filter((i) => i.type === 'interrupt');
  const busIfaces = Array.from(interfaces.values()).filter(
    (i) => BUS_TYPE_MAP[i.type] !== undefined
  );

  // Clock/reset interface name → first RTL port name (for associatedClock/Reset lookup)
  const clockPortByIface = new Map(clockIfaces.map((ci) => [ci.name, ci.ports[0]?.portName]));
  const resetPortByIface = new Map(resetIfaces.map((ri) => [ri.name, ri.ports[0]?.portName]));

  // ── Clocks ─────────────────────────────────────────────────────────────────

  const clockEntries = clockIfaces.flatMap((ci) =>
    ci.ports.map((p) => ({ name: p.portName, direction: 'in' }))
  );
  if (clockEntries.length > 0) {
    yamlData.clocks = clockEntries;
  }

  // ── Resets ─────────────────────────────────────────────────────────────────

  const resetEntries = resetIfaces.flatMap((ri) =>
    ri.ports.map((p) => {
      const activeLow =
        p.portName.toLowerCase().endsWith('n') ||
        ri.properties.get('synchronousEdges') === 'DEASSERT';
      return {
        name: p.portName,
        direction: 'in',
        polarity: activeLow ? 'activeLow' : 'activeHigh',
      };
    })
  );
  if (resetEntries.length > 0) {
    yamlData.resets = resetEntries;
  }

  // ── User ports (conduit) ────────────────────────────────────────────────────

  const portEntries = conduitIfaces.flatMap((ci) =>
    ci.ports.map((p) => {
      const entry: Record<string, unknown> = {
        name: p.portName,
        direction: mapDirection(p.direction),
      };
      if (p.width > 1) {
        entry.width = p.width;
      }
      return entry;
    })
  );
  if (portEntries.length > 0) {
    yamlData.ports = portEntries;
  }

  // ── Interrupts ─────────────────────────────────────────────────────────────

  const interruptEntries = interruptIfaces.flatMap((ii) =>
    ii.ports.map((p) => ({
      name: p.portName,
      direction: mapDirection(p.direction),
    }))
  );
  if (interruptEntries.length > 0) {
    yamlData.interrupts = interruptEntries;
  }

  // ── Bus interfaces ──────────────────────────────────────────────────────────

  const busEntries = busIfaces.map((bi) => {
    const isStreaming = STREAMING_TYPES.has(bi.type);
    const mode =
      bi.mode === 'start' ? (isStreaming ? 'source' : 'master') : isStreaming ? 'sink' : 'slave';

    const portNames = bi.ports.map((p) => p.portName);
    const physicalPrefix = computePhysicalPrefix(portNames);

    const entry: Record<string, unknown> = {
      name: bi.name,
      type: BUS_TYPE_MAP[bi.type],
      mode,
      physicalPrefix,
    };

    const assocClockIface = bi.properties.get('associatedClock');
    const clockPort = assocClockIface ? clockPortByIface.get(assocClockIface) : undefined;
    if (clockPort) {
      entry.associatedClock = clockPort;
    }

    const assocResetIface = bi.properties.get('associatedReset');
    const resetPort = assocResetIface ? resetPortByIface.get(assocResetIface) : undefined;
    if (resetPort) {
      entry.associatedReset = resetPort;
    }

    // Detect optional ports that are actually present in the hw.tcl
    const busDef = lookupBusDef(BUS_TYPE_MAP[bi.type]);
    if (busDef) {
      const presentLogical = new Set(bi.ports.map((p) => p.logicalName.toLowerCase()));
      const useOptionalPorts = busDef
        .filter((def) => def.presence === 'optional' && presentLogical.has(def.name.toLowerCase()))
        .map((def) => def.name.toLowerCase());
      if (useOptionalPorts.length > 0) {
        entry.useOptionalPorts = useOptionalPorts;
      }
    }

    return entry;
  });
  if (busEntries.length > 0) {
    yamlData.busInterfaces = busEntries;
  }

  // ── Parameters ─────────────────────────────────────────────────────────────

  if (parameters.length > 0) {
    yamlData.parameters = parameters.map((p) => ({
      name: p.name,
      value: parseParamValue(p.defaultValue),
      dataType: p.type.toLowerCase(),
    }));
  }

  // ── File sets ──────────────────────────────────────────────────────────────

  const tclDir = path.dirname(tclPath);
  const outputDir = options.outputDir ?? tclDir;
  const seenMappedNames = new Set<string>();
  const fsEntries: unknown[] = [];

  for (const [fsKey, fsData] of fileSets) {
    const mappedName = FILESET_NAME_MAP[fsKey] ?? fsKey;
    if (seenMappedNames.has(mappedName)) {
      continue;
    }
    seenMappedNames.add(mappedName);

    const files = fsData.files.map((f) => ({
      path: path.relative(outputDir, path.resolve(tclDir, f.filePath)),
      type: FILE_TYPE_MAP[f.lang] ?? 'unknown',
      managed: false,
    }));

    if (files.length > 0) {
      fsEntries.push({
        name: mappedName,
        description: FILESET_DESC_MAP[mappedName] ?? mappedName.replace(/_/g, ' '),
        files,
      });
    }
  }

  if (fsEntries.length > 0) {
    yamlData.fileSets = fsEntries;
  }

  const yamlText = yaml.dump(yamlData, { noRefs: true, sortKeys: false, lineWidth: -1, indent: 2 });

  return { componentName, yamlText };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTclTokens(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    if (ch === '"') {
      i++;
      let val = '';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) {
          i++;
          val += line[i];
        } else {
          val += line[i];
        }
        i++;
      }
      i++; // closing quote
      tokens.push(val);
      continue;
    }

    if (ch === '{') {
      i++;
      let val = '';
      let depth = 1;
      while (i < line.length && depth > 0) {
        if (line[i] === '{') {
          depth++;
        } else if (line[i] === '}') {
          depth--;
          if (depth === 0) {
            break;
          }
        }
        val += line[i];
        i++;
      }
      i++; // closing brace
      tokens.push(val);
      continue;
    }

    if (ch === '[') {
      // Command substitution — skip entirely
      let depth = 1;
      i++;
      while (i < line.length && depth > 0) {
        if (line[i] === '[') {
          depth++;
        } else if (line[i] === ']') {
          depth--;
        }
        i++;
      }
      continue;
    }

    // Plain token
    let val = '';
    while (i < line.length && line[i] !== ' ' && line[i] !== '\t') {
      val += line[i];
      i++;
    }
    tokens.push(val);
  }

  return tokens;
}

function mapDirection(dir: string): string {
  switch (dir.toLowerCase()) {
    case 'input':
      return 'in';
    case 'output':
      return 'out';
    case 'bidir':
      return 'inout';
    default:
      return dir.toLowerCase();
  }
}

function computePhysicalPrefix(portNames: string[]): string {
  if (portNames.length === 0) {
    return '';
  }
  let prefix = portNames[0];
  for (const name of portNames.slice(1)) {
    while (prefix.length > 0 && !name.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  const lastUs = prefix.lastIndexOf('_');
  if (lastUs >= 0) {
    return prefix.slice(0, lastUs + 1);
  }
  return prefix ? `${prefix}_` : '';
}

function parseParamValue(value?: string): unknown {
  if (value === undefined || value === '') {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}
