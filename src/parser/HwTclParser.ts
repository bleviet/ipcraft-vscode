import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { lookupBusDef } from '../webview/ipcore/data/busDefinitions';
import { resolveVendor } from '../utils/resolveVendor';
import { titleCaseIdentifier } from '../utils/titleCase';
import { BUS_VLNV } from '../shared/busVlnv';
import { normalizeParameterDataType } from './paramDataType';

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
  width: number | string;
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
  description?: string;
  displayName?: string;
  /** Verbatim ALLOWED_RANGES argument: either `min:max` or a brace list of choices. */
  allowedRanges?: string;
  /** Legacy `set_parameter_property <p> GROUP <name>` value, if present. */
  legacyGroup?: string;
}

/**
 * Platform Designer parameter GUI layout, collected from `add_display_item`.
 * `groupParents` maps a GROUP item id to its own parent id (`''` at the root);
 * `paramParents` maps a PARAMETER item id to the group holding it.
 */
interface TclDisplayLayout {
  groupParents: Map<string, string>;
  paramParents: Map<string, string>;
  displayNames: Map<string, string>;
}

const BUS_TYPE_MAP: Record<string, string> = {
  axi4lite: BUS_VLNV.AXI4_LITE,
  axi4: BUS_VLNV.AXI4_FULL,
  avalon: BUS_VLNV.AVALON_MM,
  avalon_streaming: BUS_VLNV.AVALON_ST,
  avalonst: BUS_VLNV.AVALON_ST,
  axi4stream: BUS_VLNV.AXI_STREAM,
  axis: BUS_VLNV.AXI_STREAM,
};

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
  const flattened = await flattenTclContent(content, tclPath, new Set(), false);
  return parseHwTclContent(flattened, tclPath, options);
}

// ── Source-file flattening ────────────────────────────────────────────────────

/**
 * Extracts the path argument from a TCL `source` command line.
 *
 * Handles common forms used in Quartus _hw.tcl files:
 *   source "file.tcl"
 *   source {file.tcl}
 *   source file.tcl
 *   source [file join [file dirname [info script]] subdir file.tcl]
 *
 * Returns null for unresolvable forms (variable substitutions, unknown commands).
 */
export function extractSourcePath(line: string): string | null {
  const trimmed = line.trim();
  if (!/^source\s/.test(trimmed)) {
    return null;
  }

  const rest = trimmed.slice('source'.length).trim();

  // Double-quoted string: source "path.tcl"
  const quotedMatch = /^"([^"]+)"/.exec(rest);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Braced string: source {path.tcl}
  const bracedMatch = /^\{([^}]+)\}/.exec(rest);
  if (bracedMatch) {
    return bracedMatch[1];
  }

  // [file join [file dirname [info script]] component...] — resolves to tclDir/<components>
  const SCRIPT_DIR_PREFIX = '[file join [file dirname [info script]] ';
  if (rest.startsWith(SCRIPT_DIR_PREFIX)) {
    const inner = rest.slice(SCRIPT_DIR_PREFIX.length);
    const lastBracket = inner.lastIndexOf(']');
    if (lastBracket >= 0) {
      const items = parseTclListItems(inner.slice(0, lastBracket).trim());
      if (items.length > 0) {
        return path.join(...items);
      }
    }
  }

  // Plain unquoted path (no $, [, { — skip variable/command substitutions)
  const plainMatch = /^([^\s\[${"\\]+)/.exec(rest);
  if (plainMatch && plainMatch[1].length > 0) {
    return plainMatch[1];
  }

  return null;
}

function parseTclListItems(s: string): string[] {
  const items: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
      i++;
    }
    if (i >= s.length) {
      break;
    }
    if (s[i] === '"') {
      i++;
      let val = '';
      while (i < s.length && s[i] !== '"') {
        val += s[i++];
      }
      i++;
      if (val) {
        items.push(val);
      }
    } else {
      let val = '';
      while (i < s.length && s[i] !== ' ' && s[i] !== '\t') {
        val += s[i++];
      }
      if (val) {
        items.push(val);
      }
    }
  }
  return items;
}

function normalizeFilesetFilePath(line: string, baseDir: string): string {
  if (!/^add_fileset_file\b/.test(line.trim())) {
    return line;
  }
  const m = /\bPATH\s+("([^"]+)"|(\S+))/.exec(line);
  if (!m) {
    return line;
  }
  const filePath = m[2] ?? m[3];
  if (path.isAbsolute(filePath)) {
    return line;
  }
  return line.replace(m[0], `PATH ${path.resolve(baseDir, filePath)}`);
}

async function flattenTclContent(
  content: string,
  tclPath: string,
  visited: Set<string>,
  normalizeFilePaths: boolean
): Promise<string> {
  const resolvedPath = path.resolve(tclPath);
  if (visited.has(resolvedPath)) {
    return '';
  }
  visited.add(resolvedPath);

  const tclDir = path.dirname(resolvedPath);
  const resultLines: string[] = [];

  for (const rawLine of content.split('\n')) {
    const sourcePath = extractSourcePath(rawLine);
    if (sourcePath !== null) {
      const absSourcePath = path.isAbsolute(sourcePath)
        ? sourcePath
        : path.resolve(tclDir, sourcePath);
      try {
        const sourceContent = await fs.readFile(absSourcePath, 'utf8');
        const inlined = await flattenTclContent(sourceContent, absSourcePath, visited, true);
        resultLines.push(inlined);
      } catch {
        // File not accessible — skip (unresolved source commands are already ignored by parser)
      }
    } else if (normalizeFilePaths) {
      resultLines.push(normalizeFilesetFilePath(rawLine, tclDir));
    } else {
      resultLines.push(rawLine);
    }
  }

  return resultLines.join('\n');
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
  const displayLayout: TclDisplayLayout = {
    groupParents: new Map(),
    paramParents: new Map(),
    displayNames: new Map(),
  };
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
      const parsedWidth = parseInt(widthStr, 10);
      interfaces.get(ifaceName)?.ports.push({
        portName,
        logicalName,
        direction,
        width: Number.isNaN(parsedWidth) ? (widthStr ?? 1) : parsedWidth,
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
    } else if (cmd === 'set_parameter_property' && args.length >= 3) {
      const param = parameters.find((p) => p.name === args[0]);
      if (param) {
        if (args[1] === 'DEFAULT_VALUE') {
          param.defaultValue = args[2];
        } else if (args[1] === 'DESCRIPTION') {
          param.description = args[2];
        } else if (args[1] === 'DISPLAY_NAME') {
          param.displayName = args[2];
        } else if (args[1] === 'ALLOWED_RANGES') {
          param.allowedRanges = args[2];
        } else if (args[1] === 'GROUP') {
          param.legacyGroup = args[2];
        }
      }
    } else if (cmd === 'add_display_item' && args.length >= 3) {
      const [parent, id, kind] = args;
      if (kind.toUpperCase() === 'GROUP') {
        displayLayout.groupParents.set(id, parent);
      } else if (kind.toUpperCase() === 'PARAMETER') {
        displayLayout.paramParents.set(id, parent);
      }
    } else if (
      cmd === 'set_display_item_property' &&
      args.length >= 3 &&
      args[1].toUpperCase() === 'DISPLAY_NAME'
    ) {
      displayLayout.displayNames.set(args[0], args[2]);
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
      if (typeof p.width === 'string' ? p.width.length > 0 : p.width > 1) {
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
    const mode = bi.mode === 'start' ? 'master' : 'slave';

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

    const firstSymbolInHighOrderBits = bi.properties.get('firstSymbolInHighOrderBits');
    if (bi.type === 'avalon_streaming' && firstSymbolInHighOrderBits !== undefined) {
      entry.endianness = /^(?:1|true)$/i.test(firstSymbolInHighOrderBits) ? 'big' : 'little';
    }

    // Detect optional ports and portWidthOverrides from bus definition
    const busDef = lookupBusDef(BUS_TYPE_MAP[bi.type]);
    if (busDef) {
      const presentLogical = new Set(bi.ports.map((p) => p.logicalName.toLowerCase()));
      const useOptionalPorts = busDef
        .filter((def) => def.presence === 'optional' && presentLogical.has(def.name.toLowerCase()))
        .map((def) => def.name);
      if (useOptionalPorts.length > 0) {
        entry.useOptionalPorts = useOptionalPorts;
      }

      // Emit portWidthOverrides for bus ports whose actual width differs from the
      // bus-definition default (numeric mismatch) or is a parameter expression
      // (string) — so the generator reproduces the original port sizes faithfully.
      // Keys use the bus definition's original case (e.g. uppercase for AXI, lowercase
      // for Avalon) so the canvas lookup `overrides[portDef.name]` matches directly.
      const defByUpper = new Map(busDef.map((def) => [def.name.toUpperCase(), def]));
      const hasWidthDefs = busDef.some((def) => typeof def.width === 'number');
      if (hasWidthDefs) {
        const portWidthOverrides: Record<string, number | string> = {};
        for (const p of bi.ports) {
          const logUpper = p.logicalName.toUpperCase();
          const def = defByUpper.get(logUpper);
          if (!def || typeof def.width !== 'number') {
            continue;
          }
          const canonicalKey = def.name;
          if (typeof p.width === 'string') {
            portWidthOverrides[canonicalKey] = p.width;
          } else if (p.width !== def.width) {
            portWidthOverrides[canonicalKey] = p.width;
          }
        }
        if (Object.keys(portWidthOverrides).length > 0) {
          entry.portWidthOverrides = portWidthOverrides;
        }
      }

      // Emit portNameOverrides for any physical port whose suffix (after the shared
      // physicalPrefix) does not match the conventional lowercase logical name. This
      // is lossless: physicalPrefix + suffix always reconstructs the original portName,
      // even when multiple interfaces of the same protocol share one physicalPrefix
      // (e.g. two Avalon-ST sinks both prefixed "asi_" but distinguished by an index/
      // direction-tag suffix like "_0_i" / "_1_i").
      const portNameOverrides: Record<string, string> = {};
      for (const p of bi.ports) {
        const suffix = p.portName.startsWith(physicalPrefix)
          ? p.portName.slice(physicalPrefix.length)
          : p.portName;
        if (suffix !== p.logicalName.toLowerCase()) {
          const def = defByUpper.get(p.logicalName.toUpperCase());
          const canonicalKey = def ? def.name : p.logicalName;
          portNameOverrides[canonicalKey] = suffix;
        }
      }
      if (Object.keys(portNameOverrides).length > 0) {
        entry.portNameOverrides = portNameOverrides;
      }
    }

    return entry;
  });
  if (busEntries.length > 0) {
    yamlData.busInterfaces = busEntries;
  }

  // ── Parameters ─────────────────────────────────────────────────────────────

  if (parameters.length > 0) {
    yamlData.parameters = parameters.map((p) => {
      const dataType = normalizeParameterDataType(p.type);
      return {
        name: p.name,
        value: parseParamValue(p.defaultValue, dataType),
        dataType,
        description: p.description ?? '',
        ...resolveParameterDisplayName(p),
        ...resolveParameterConstraint(p.allowedRanges, dataType),
        ...resolveParameterPlacement(p, displayLayout),
      };
    });
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
        if (line[i] === '\\' && i + 1 < line.length) {
          // An escaped brace is literal and must not affect the outer braced
          // word's nesting. Preserve the escape for a later Tcl-list parse.
          val += line[i];
          val += line[i + 1];
          i += 2;
          continue;
        }
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
      // Command substitution. Capture the bracket body so we can recover the
      // one form that carries port information: `[get_parameter_value PARAM]`,
      // which Quartus (and our own generator) use for parameter-dependent port
      // widths inside the elaborate callback.
      let depth = 1;
      i++;
      let body = '';
      while (i < line.length && depth > 0) {
        if (line[i] === '[') {
          depth++;
        } else if (line[i] === ']') {
          depth--;
          if (depth === 0) {
            break;
          }
        }
        body += line[i];
        i++;
      }
      i++; // closing bracket
      const paramRef = /^\s*get_parameter_value\s+(\S+)\s*$/.exec(body);
      if (paramRef) {
        tokens.push(paramRef[1]);
      } else {
        // A more complex expression this parser can't reduce to a single parameter
        // reference — e.g. a clog2-style width `[expr int(ceil(log([get_parameter_value
        // P])/log(2)))]`. Push the raw body as a fallback token rather than dropping
        // the argument outright: silently vanishing a token shifts every argument
        // after it, which can drop the enclosing command entirely once its arg count
        // falls below the command's minimum (e.g. add_interface_port's width arg).
        // add_interface_port's own width parsing already falls back to keeping a
        // non-numeric widthStr as-is, so this just surfaces the port with an
        // unresolved (string) width instead of losing it.
        tokens.push(body);
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

function parseParamValue(value: string | undefined, dataType: string): unknown {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (dataType === 'string') {
    return value;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

/**
 * Keeps DISPLAY_NAME only when it carries information. Generators (IPCraft's
 * included) emit a title-cased DISPLAY_NAME for every parameter, so importing
 * it unconditionally would add a redundant `displayName` to every entry.
 */
function resolveParameterDisplayName(param: TclParameter): { displayName?: string } {
  if (!param.displayName) {
    return {};
  }
  if (param.displayName === titleCaseIdentifier(param.name)) {
    return {};
  }
  return { displayName: param.displayName };
}

/**
 * ALLOWED_RANGES is either a `min:max` span or a Tcl list of discrete choices
 * (the tokenizer already unwraps the braces). Choices may be quoted for string
 * parameters.
 *
 * For a STRING-typed parameter, every choice is kept as a string even when it
 * looks numeric: `add_parameter CODE STRING "01"` with choices `{ "01" "1" }`
 * must import as `["01", "1"]`, not `[1, 1]` — coercing would both change the
 * dataType's meaning and lose leading-zero spellings.
 */
function resolveParameterConstraint(
  allowedRanges: string | undefined,
  dataType: string
): { min?: number; max?: number } | { allowedValues?: Array<number | string> } {
  if (!allowedRanges) {
    return {};
  }
  const span = /^\s*(-?\d+)\s*:\s*(-?\d+)\s*$/.exec(allowedRanges);
  if (span) {
    return { min: Number(span[1]), max: Number(span[2]) };
  }
  const isString = dataType === 'string';
  // Quoted choices are one token even when they contain spaces.
  const tokens = parseTclTokens(allowedRanges);
  const choices = tokens.map((token) => {
    const unquoted = token.replace(/^"(.*)"$/, '$1');
    if (isString) {
      return unquoted;
    }
    const num = Number(unquoted);
    return unquoted !== '' && Number.isFinite(num) ? num : unquoted;
  });
  return choices.length > 0 ? { allowedValues: choices } : {};
}

/**
 * Recovers `uiPage` / `uiGroup` from the parameter GUI layout: the nested
 * `add_display_item` tree when present, otherwise the legacy flat GROUP
 * property (whose value older IPCraft releases joined with a slash).
 */
function resolveParameterPlacement(
  param: TclParameter,
  layout: TclDisplayLayout
): { uiPage?: string; uiGroup?: string } {
  const parent = layout.paramParents.get(param.name);
  if (parent !== undefined) {
    if (parent === '') {
      return {};
    }
    const grandparent = layout.groupParents.get(parent);
    const parentLabel = layout.displayNames.get(parent) ?? parent;
    if (grandparent) {
      return {
        uiPage: layout.displayNames.get(grandparent) ?? grandparent,
        uiGroup: parentLabel,
      };
    }
    return { uiPage: parentLabel };
  }

  if (!param.legacyGroup) {
    return {};
  }
  const slash = param.legacyGroup.indexOf('/');
  if (slash === -1) {
    return { uiPage: param.legacyGroup };
  }
  return {
    uiPage: param.legacyGroup.slice(0, slash),
    uiGroup: param.legacyGroup.slice(slash + 1),
  };
}
