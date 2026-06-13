import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BUS_VLNV } from '../shared/busVlnv';

export interface ParsedPort {
  name: string;
  direction: string;
  type: string;
  width?: number | string;
}

export interface ParsedParameter {
  name: string;
  type: string;
  value?: string;
}

export interface ParseOptions {
  vendor?: string;
  library?: string;
  version?: string;
  detectBus?: boolean;
  outputDir?: string;
}

export interface ParseResult {
  entityName: string;
  yamlText: string;
  outputPath?: string;
  warnings?: string[];
}

export async function parseVhdlFile(
  vhdlPath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const content = await fs.readFile(vhdlPath, 'utf8');
  const cleaned = stripComments(content);

  const entityName = extractEntityName(cleaned);
  if (!entityName) {
    throw new Error('No VHDL entity found in file');
  }

  const parameters = extractParameters(cleaned);
  const ports = extractPorts(cleaned);

  const clockReset = classifyClocksResets(ports);

  const detectBus = options.detectBus !== false;
  const busDetection = detectBus ? detectBusInterfaces(ports, clockReset) : null;

  const excludedNames = new Set<string>();
  if (busDetection) {
    busDetection.busPortNames.forEach((name) => excludedNames.add(name));
  }
  clockReset.clocks.forEach((clock) => excludedNames.add(clock.name));
  clockReset.resets.forEach((reset) => excludedNames.add(reset.name));

  const userPorts = ports.filter((port) => !excludedNames.has(port.name));

  const outputDir = options.outputDir ?? path.dirname(vhdlPath);

  const yamlData: Record<string, unknown> = {
    vlnv: {
      vendor: options.vendor ?? 'user',
      library: options.library ?? 'ip',
      name: entityName,
      version: options.version ?? '1.0.0',
    },
    description: `Generated from ${path.basename(vhdlPath)}`,
  };

  const soleReset = clockReset.resets.length === 1 ? clockReset.resets[0].name : undefined;
  const soleClock = clockReset.clocks.length === 1 ? clockReset.clocks[0].name : undefined;

  if (clockReset.clocks.length > 0) {
    yamlData.clocks = clockReset.clocks.map((clock) => {
      const entry: Record<string, unknown> = { name: clock.name, direction: 'in' };
      if (soleReset) {
        entry.associatedReset = soleReset;
      }
      return entry;
    });
  }

  if (clockReset.resets.length > 0) {
    yamlData.resets = clockReset.resets.map((reset) => {
      const entry: Record<string, unknown> = {
        name: reset.name,
        direction: 'in',
        polarity: reset.polarity,
      };
      if (soleClock) {
        entry.associatedClock = soleClock;
      }
      return entry;
    });
  }

  if (userPorts.length > 0) {
    yamlData.ports = userPorts.map((port) => portToDict(port));
  }

  if (busDetection && busDetection.busInterfaces.length > 0) {
    yamlData.busInterfaces = busDetection.busInterfaces.map((bus) => {
      const entry: Record<string, unknown> = {
        name: bus.name,
        type: bus.type,
        mode: bus.mode,
        physicalPrefix: bus.physicalPrefix,
      };
      if (bus.associatedClock) {
        entry.associatedClock = bus.associatedClock;
      }
      if (bus.associatedReset) {
        entry.associatedReset = bus.associatedReset;
      }
      if (bus.portWidthOverrides && Object.keys(bus.portWidthOverrides).length > 0) {
        entry.portWidthOverrides = bus.portWidthOverrides;
      }
      if (bus.portNameOverrides && Object.keys(bus.portNameOverrides).length > 0) {
        entry.portNameOverrides = bus.portNameOverrides;
      }
      if (bus.absentPorts && bus.absentPorts.length > 0) {
        entry.absentPorts = bus.absentPorts;
      }
      return entry;
    });
  }

  const warnings: string[] = [];
  if (parameters.length > 0) {
    yamlData.parameters = parameters.map((param) => {
      const isVector = /std_logic_vector|bit_vector/i.test(param.type);
      if (isVector) {
        warnings.push(
          `Warning: std_logic_vector generic detected on generic '${param.name}'. Convert to integer for cross-vendor GUI compatibility.`
        );
      }
      return {
        name: param.name,
        value: parseParameterValue(param.value),
        dataType: normalizeParamDataType(param.type),
      };
    });
  }

  const relativeVhdlPath = path.relative(outputDir, vhdlPath);

  yamlData.fileSets = [
    {
      name: 'RTL_Sources',
      description: 'RTL source files',
      files: [{ path: relativeVhdlPath, type: 'vhdl', managed: false }],
    },
  ];

  const yamlText = yaml.dump(yamlData, {
    noRefs: true,
    sortKeys: false,
    lineWidth: -1,
    indent: 2,
  });

  return {
    entityName,
    yamlText,
    warnings,
  };
}

function stripComments(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function extractEntityName(content: string): string | null {
  const match = content.match(/\bentity\s+(\w+)\s+is\b/i);
  return match ? match[1] : null;
}

function extractParameters(content: string): ParsedParameter[] {
  const body = extractBlockContent(content, 'generic');
  if (!body) {
    return [];
  }

  const entries = splitEntries(body);
  const params: ParsedParameter[] = [];

  for (const entry of entries) {
    const cleaned = entry.replace(/\s+/g, ' ').trim();
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const namesPart = cleaned.slice(0, colonIdx);
    const typePart = cleaned.slice(colonIdx + 1);
    const names = namesPart
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const typeMatch = typePart.split(':=');
    const type = typeMatch[0].trim();
    const value = typeMatch[1]?.trim();

    names.forEach((name) => {
      params.push({ name, type, value });
    });
  }

  return params;
}

function extractPorts(content: string): ParsedPort[] {
  const body = extractBlockContent(content, 'port');
  if (!body) {
    return [];
  }

  const entries = splitEntries(body);
  const ports: ParsedPort[] = [];

  for (const entry of entries) {
    const cleaned = entry.replace(/\s+/g, ' ').trim();
    if (!cleaned?.includes(':')) {
      continue;
    }
    const [namesPart, typePart] = cleaned.split(':');
    const names = namesPart
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const dirMatch = typePart.trim().match(/^(in|out|inout)\s+(.+)$/i);
    if (!dirMatch) {
      continue;
    }
    const direction = dirMatch[1].toLowerCase();
    const type = dirMatch[2].trim();
    const width = extractWidthFromType(type);

    names.forEach((name) => {
      ports.push({ name, direction, type, width });
    });
  }

  return ports;
}

function extractFirstParenContent(s: string): string | null {
  const start = s.indexOf('(');
  if (start === -1) {
    return null;
  }
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') {
      depth++;
    } else if (s[i] === ')') {
      depth--;
      if (depth === 0) {
        return s.slice(start + 1, i).trim();
      }
    }
  }
  return null;
}

function extractWidthFromType(type: string): number | string | undefined {
  if (/std_logic_vector/i.test(type)) {
    const range = extractFirstParenContent(type);
    if (!range) {
      return undefined;
    }
    // All patterns are anchored (^...$) to match the full range unambiguously.
    // Simple parameter: AxiDataWidth_g - 1 downto 0 → "AxiDataWidth_g"
    const paramMatch = range.match(/^(\w+)\s*-\s*1\s+downto\s+0$/i);
    if (paramMatch) {
      return paramMatch[1];
    }
    // Paren-wrapped expression: (AxiDataWidth_g/8) - 1 downto 0 → "AxiDataWidth_g/8"
    const parenExprMatch = range.match(/^\((.+)\)\s*-\s*1\s+downto\s+0$/i);
    if (parenExprMatch) {
      return parenExprMatch[1].trim();
    }
    // Numeric downto range: 31 downto 0 → 32
    const numericDowntoMatch = range.match(/^(\d+)\s+downto\s+(\d+)$/i);
    if (numericDowntoMatch) {
      const high = Number(numericDowntoMatch[1]);
      const low = Number(numericDowntoMatch[2]);
      return Math.abs(high - low) + 1;
    }
    // Numeric to range: 0 to 31 → 32
    const numericToMatch = range.match(/^(\d+)\s+to\s+(\d+)$/i);
    if (numericToMatch) {
      const a = Number(numericToMatch[1]);
      const b = Number(numericToMatch[2]);
      return Math.abs(a - b) + 1;
    }
    // General compound expression: N*2 - 1 downto 0 → "N*2", A + B - 1 downto 0 → "A + B"
    // Uses lazy (.+?) so the match anchors to the last "- 1 downto 0" sequence.
    const generalDowntoMatch = range.match(/^(.+?)\s*-\s*1\s+downto\s+0$/i);
    if (generalDowntoMatch) {
      return generalDowntoMatch[1].trim();
    }
    // General to direction: 0 to N*2 - 1 → "N*2"
    const generalToMatch = range.match(/^0\s+to\s+(.+?)\s*-\s*1$/i);
    if (generalToMatch) {
      return generalToMatch[1].trim();
    }
    return undefined;
  }

  if (/\bstd_logic\b/i.test(type)) {
    return 1;
  }

  return undefined;
}

export function extractVhdlInterface(content: string): {
  entityName: string | null;
  parameters: ParsedParameter[];
  ports: ParsedPort[];
} {
  const cleaned = stripComments(content);
  return {
    entityName: extractEntityName(cleaned),
    parameters: extractParameters(cleaned),
    ports: extractPorts(cleaned),
  };
}

export function portToDict(port: ParsedPort): Record<string, unknown> {
  const upper = port.name.toUpperCase();
  let logicalName = upper;
  for (const prefix of ['IO_', 'I_', 'O_']) {
    if (upper.startsWith(prefix)) {
      logicalName = upper.slice(prefix.length);
      break;
    }
  }

  const result: Record<string, unknown> = {
    name: port.name,
    direction: port.direction,
  };

  if (logicalName !== upper) {
    result.logicalName = logicalName;
  }

  if (port.width !== undefined) {
    if (typeof port.width === 'number') {
      if (port.width > 1) {
        result.width = port.width;
      }
    } else {
      result.width = port.width;
    }
  }

  return result;
}

/**
 * Normalises a VHDL generic type string to one of the allowed ParameterType
 * values in the schema.  VHDL allows constrained subtypes such as
 * `natural range 12 to 64`; we strip the range clause and keep only the
 * base type name so schema validation passes.
 */
export function normalizeParamDataType(rawType: string): string {
  const normalized = rawType
    .replace(/\s+range\s+.*/i, '')
    .trim()
    .toLowerCase();

  if (normalized === 'boolean') {
    return 'boolean';
  }
  if (normalized === 'string') {
    return 'string';
  }
  return 'integer';
}

export function parseParameterValue(value?: string): unknown {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

export function classifyClocksResets(ports: ParsedPort[]): {
  clocks: Array<{ name: string }>;
  resets: Array<{ name: string; polarity: string }>;
} {
  const clocks: Array<{ name: string }> = [];
  const resets: Array<{ name: string; polarity: string }> = [];

  ports.forEach((port) => {
    const name = port.name.toLowerCase();
    if (port.direction !== 'in') {
      return;
    }
    if (/(^|_)(clk|clock|aclk)$/.test(name)) {
      clocks.push({ name: port.name });
      return;
    }
    if (/(^|_)(rst|reset|aresetn|reset_n|rst_n)$/.test(name)) {
      const activeLow = name.endsWith('n') || name.includes('reset_n') || name.includes('rst_n');
      resets.push({
        name: port.name,
        polarity: activeLow ? 'activeLow' : 'activeHigh',
      });
    }
  });

  return { clocks, resets };
}

interface BusSignalDef {
  name: string;
  presence: 'required' | 'optional';
  direction: 'in' | 'out';
}

interface BusDef {
  id: string;
  signals: readonly BusSignalDef[];
  minRequired: number;
  exclusiveSignals?: readonly string[];
}

// Derived from ipcraft-spec/bus_definitions/*.yml — listed most-specific first so
// the disambiguation logic (exclusiveSignals + score comparison) resolves correctly.
const BUS_DEFINITIONS: readonly BusDef[] = [
  {
    id: BUS_VLNV.AXI4_FULL,
    minRequired: 8,
    exclusiveSignals: ['awlen', 'awburst', 'wlast', 'rlast'],
    signals: [
      { name: 'awid', presence: 'required', direction: 'out' },
      { name: 'awaddr', presence: 'required', direction: 'out' },
      { name: 'awlen', presence: 'required', direction: 'out' },
      { name: 'awsize', presence: 'required', direction: 'out' },
      { name: 'awburst', presence: 'required', direction: 'out' },
      { name: 'awlock', presence: 'required', direction: 'out' },
      { name: 'awcache', presence: 'required', direction: 'out' },
      { name: 'awprot', presence: 'required', direction: 'out' },
      { name: 'awvalid', presence: 'required', direction: 'out' },
      { name: 'awready', presence: 'required', direction: 'in' },
      { name: 'wdata', presence: 'required', direction: 'out' },
      { name: 'wstrb', presence: 'required', direction: 'out' },
      { name: 'wlast', presence: 'required', direction: 'out' },
      { name: 'wvalid', presence: 'required', direction: 'out' },
      { name: 'wready', presence: 'required', direction: 'in' },
      { name: 'bid', presence: 'required', direction: 'in' },
      { name: 'bresp', presence: 'required', direction: 'in' },
      { name: 'bvalid', presence: 'required', direction: 'in' },
      { name: 'bready', presence: 'required', direction: 'out' },
      { name: 'arid', presence: 'required', direction: 'out' },
      { name: 'araddr', presence: 'required', direction: 'out' },
      { name: 'arlen', presence: 'required', direction: 'out' },
      { name: 'arsize', presence: 'required', direction: 'out' },
      { name: 'arburst', presence: 'required', direction: 'out' },
      { name: 'arlock', presence: 'required', direction: 'out' },
      { name: 'arcache', presence: 'required', direction: 'out' },
      { name: 'arprot', presence: 'required', direction: 'out' },
      { name: 'arvalid', presence: 'required', direction: 'out' },
      { name: 'arready', presence: 'required', direction: 'in' },
      { name: 'rid', presence: 'required', direction: 'in' },
      { name: 'rdata', presence: 'required', direction: 'in' },
      { name: 'rresp', presence: 'required', direction: 'in' },
      { name: 'rlast', presence: 'required', direction: 'in' },
      { name: 'rvalid', presence: 'required', direction: 'in' },
      { name: 'rready', presence: 'required', direction: 'out' },
    ],
  },
  {
    id: BUS_VLNV.AXI4_LITE,
    minRequired: 4,
    signals: [
      { name: 'awaddr', presence: 'required', direction: 'out' },
      { name: 'awprot', presence: 'required', direction: 'out' },
      { name: 'awvalid', presence: 'required', direction: 'out' },
      { name: 'awready', presence: 'required', direction: 'in' },
      { name: 'wdata', presence: 'required', direction: 'out' },
      { name: 'wstrb', presence: 'required', direction: 'out' },
      { name: 'wvalid', presence: 'required', direction: 'out' },
      { name: 'wready', presence: 'required', direction: 'in' },
      { name: 'bresp', presence: 'required', direction: 'in' },
      { name: 'bvalid', presence: 'required', direction: 'in' },
      { name: 'bready', presence: 'required', direction: 'out' },
      { name: 'araddr', presence: 'required', direction: 'out' },
      { name: 'arprot', presence: 'required', direction: 'out' },
      { name: 'arvalid', presence: 'required', direction: 'out' },
      { name: 'arready', presence: 'required', direction: 'in' },
      { name: 'rdata', presence: 'required', direction: 'in' },
      { name: 'rresp', presence: 'required', direction: 'in' },
      { name: 'rvalid', presence: 'required', direction: 'in' },
      { name: 'rready', presence: 'required', direction: 'out' },
    ],
  },
  {
    id: BUS_VLNV.AXI_STREAM,
    minRequired: 2,
    signals: [
      { name: 'tdata', presence: 'required', direction: 'out' },
      { name: 'tvalid', presence: 'required', direction: 'out' },
      { name: 'tready', presence: 'required', direction: 'in' },
      { name: 'tstrb', presence: 'optional', direction: 'out' },
      { name: 'tkeep', presence: 'optional', direction: 'out' },
      { name: 'tlast', presence: 'optional', direction: 'out' },
      { name: 'tid', presence: 'optional', direction: 'out' },
      { name: 'tdest', presence: 'optional', direction: 'out' },
      { name: 'tuser', presence: 'optional', direction: 'out' },
    ],
  },
  {
    id: BUS_VLNV.AVALON_MM,
    minRequired: 3,
    signals: [
      { name: 'address', presence: 'required', direction: 'out' },
      { name: 'read', presence: 'required', direction: 'out' },
      { name: 'write', presence: 'required', direction: 'out' },
      { name: 'writedata', presence: 'required', direction: 'out' },
      { name: 'readdata', presence: 'required', direction: 'in' },
      { name: 'byteenable', presence: 'optional', direction: 'out' },
      { name: 'chipselect', presence: 'optional', direction: 'out' },
      { name: 'readdatavalid', presence: 'optional', direction: 'in' },
      { name: 'waitrequest', presence: 'optional', direction: 'in' },
      { name: 'burstcount', presence: 'optional', direction: 'out' },
      { name: 'beginbursttransfer', presence: 'optional', direction: 'out' },
      { name: 'response', presence: 'optional', direction: 'in' },
    ],
  },
  {
    id: BUS_VLNV.AVALON_ST,
    minRequired: 2,
    signals: [
      { name: 'data', presence: 'required', direction: 'out' },
      { name: 'valid', presence: 'required', direction: 'out' },
      { name: 'ready', presence: 'optional', direction: 'in' },
      { name: 'startofpacket', presence: 'optional', direction: 'out' },
      { name: 'endofpacket', presence: 'optional', direction: 'out' },
      { name: 'empty', presence: 'optional', direction: 'out' },
      { name: 'channel', presence: 'optional', direction: 'out' },
      { name: 'error', presence: 'optional', direction: 'out' },
    ],
  },
];

export function detectBusInterfaces(
  ports: ParsedPort[],
  clockReset: { clocks: Array<{ name: string }>; resets: Array<{ name: string; polarity: string }> }
): {
  busInterfaces: Array<{
    name: string;
    type: string;
    mode: string;
    physicalPrefix: string;
    associatedClock?: string;
    associatedReset?: string;
    portWidthOverrides?: Record<string, string | number>;
    portNameOverrides?: Record<string, string>;
    absentPorts?: string[];
  }>;
  busPortNames: Set<string>;
} {
  const portMap = new Map<string, ParsedPort>();
  ports.forEach((p) => portMap.set(p.name.toLowerCase(), p));

  // Collect candidate prefixes: the portion of each port name before a known signal suffix.
  // Always include '' so unprefixed entities (e.g. bare TDATA/TVALID) are also evaluated.
  const candidatePrefixes = new Set<string>(['']);
  for (const busDef of BUS_DEFINITIONS) {
    for (const sig of busDef.signals) {
      for (const lowerName of portMap.keys()) {
        if (lowerName.endsWith(sig.name) && lowerName.length > sig.name.length) {
          const prefix = lowerName.slice(0, lowerName.length - sig.name.length);
          if (prefix.endsWith('_')) {
            candidatePrefixes.add(prefix);
          }
        }
      }
    }
  }

  const candidates: Array<{
    prefix: string;
    busDef: BusDef;
    requiredCount: number;
    totalCount: number;
    mode: 'master' | 'slave';
    matchedPorts: Set<string>;
  }> = [];

  for (const prefix of candidatePrefixes) {
    for (const busDef of BUS_DEFINITIONS) {
      // Require at least one exclusive signal to prevent misclassifying a less-specific
      // protocol as a more-specific one (e.g. AXI4-Lite ports matching AXI4-Full).
      if (busDef.exclusiveSignals) {
        const hasExclusive = busDef.exclusiveSignals.some((s) => portMap.has(prefix + s));
        if (!hasExclusive) {
          continue;
        }
      }

      let requiredCount = 0;
      let totalCount = 0;
      let masterVotes = 0;
      let slaveVotes = 0;
      const matchedPorts = new Set<string>();

      for (const sig of busDef.signals) {
        const port = portMap.get(prefix + sig.name);
        if (!port) {
          continue;
        }
        matchedPorts.add(port.name);
        totalCount++;
        if (sig.presence === 'required') {
          requiredCount++;
        }
        if (port.direction === sig.direction) {
          masterVotes++;
        } else if (port.direction !== 'inout') {
          slaveVotes++;
        }
      }

      if (requiredCount < busDef.minRequired) {
        continue;
      }
      // For prefixed groups, reject the candidate when the number of same-prefix
      // ports that the bus definition does NOT explain is at least as large as the
      // number it does explain.  This prevents generic suffixes like "data"/"valid"
      // from triggering Avalon-ST (or similar) on a plain register-bank interface
      // that happens to have rd_data / rd_valid alongside rd_en / rd_addr.
      if (prefix) {
        const samePrefixCount = [...portMap.keys()].filter((k) => k.startsWith(prefix)).length;
        const unrecognizedCount = samePrefixCount - matchedPorts.size;
        if (unrecognizedCount >= matchedPorts.size) {
          continue;
        }
      }
      candidates.push({
        prefix,
        busDef,
        requiredCount,
        totalCount,
        mode: slaveVotes >= masterVotes ? 'slave' : 'master',
        matchedPorts,
      });
    }
  }

  // Per prefix, keep only the best-scoring bus definition.
  const byPrefix = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const existing = byPrefix.get(c.prefix);
    if (
      !existing ||
      c.requiredCount > existing.requiredCount ||
      (c.requiredCount === existing.requiredCount && c.totalCount > existing.totalCount)
    ) {
      byPrefix.set(c.prefix, c);
    }
  }

  // Longer (more specific) prefix first, then higher required count.
  const sorted = [...byPrefix.values()].sort(
    (a, b) => b.prefix.length - a.prefix.length || b.requiredCount - a.requiredCount
  );

  // Greedy assignment: skip a candidate if the majority of its matched ports are
  // already claimed by a previously accepted (more specific) bus interface.
  const claimedPorts = new Set<string>();
  const busInterfaces: Array<{
    name: string;
    type: string;
    mode: string;
    physicalPrefix: string;
    associatedClock?: string;
    associatedReset?: string;
    portWidthOverrides?: Record<string, string | number>;
    portNameOverrides?: Record<string, string>;
    absentPorts?: string[];
  }> = [];
  const busPortNames = new Set<string>();

  for (const { prefix, busDef, matchedPorts, mode } of sorted) {
    const overlap = [...matchedPorts].filter((n) => claimedPorts.has(n)).length;
    if (overlap * 2 > matchedPorts.size) {
      continue;
    }

    if (prefix) {
      ports.forEach((p) => {
        if (p.name.toLowerCase().startsWith(prefix)) {
          claimedPorts.add(p.name);
          busPortNames.add(p.name);
        }
      });
    } else {
      matchedPorts.forEach((n) => {
        claimedPorts.add(n);
        busPortNames.add(n);
      });
    }

    const busName = prefix.replace(/_+$/, '') || busDef.id.split('.')[3] || 'bus';

    const associatedClock =
      clockReset.clocks.find((c) => c.name.toLowerCase().startsWith(prefix))?.name ??
      (clockReset.clocks.length === 1 ? clockReset.clocks[0].name : undefined);
    const associatedReset =
      clockReset.resets.find((r) => r.name.toLowerCase().startsWith(prefix))?.name ??
      (clockReset.resets.length === 1 ? clockReset.resets[0].name : undefined);

    // Recover original-case prefix from the first matched port (port names are case-preserved
    // in portMap values even though keys are lowercased for matching).
    let originalPrefix = prefix;
    for (const sig of busDef.signals) {
      const port = portMap.get(prefix + sig.name);
      if (port && prefix.length > 0) {
        originalPrefix = port.name.slice(0, prefix.length);
        break;
      }
    }

    const portWidthOverrides: Record<string, string | number> = {};
    const portNameOverrides: Record<string, string> = {};
    const absentPorts: string[] = [];
    for (const sig of busDef.signals) {
      const port = portMap.get(prefix + sig.name);
      if (!port) {
        if (sig.presence === 'required') {
          absentPorts.push(sig.name.toUpperCase());
        }
        continue;
      }
      const logicalName = sig.name.toUpperCase();

      if (typeof port.width === 'string') {
        let overrideExpr = port.width;
        if (logicalName === 'WSTRB') {
          // Generator applies /8 automatically for WSTRB; strip the trailing /N from
          // the extracted VHDL expression so the override stores the data-width param.
          overrideExpr = overrideExpr.replace(/\s*\/\s*\d+\s*$/, '').trim();
          if (!overrideExpr) {
            continue;
          }
        }
        portWidthOverrides[logicalName] = overrideExpr;
      }

      // Record a suffix override when the actual physical suffix differs from the
      // conventional lowercase form (sig.name), preserving the original casing.
      const actualSuffix = port.name.slice(prefix.length);
      if (actualSuffix !== sig.name) {
        portNameOverrides[logicalName] = actualSuffix;
      }
    }

    busInterfaces.push({
      name: busName,
      type: busDef.id,
      mode,
      physicalPrefix: originalPrefix,
      associatedClock,
      associatedReset,
      portWidthOverrides:
        Object.keys(portWidthOverrides).length > 0 ? portWidthOverrides : undefined,
      portNameOverrides: Object.keys(portNameOverrides).length > 0 ? portNameOverrides : undefined,
      absentPorts: absentPorts.length > 0 ? absentPorts : undefined,
    });
  }

  return { busInterfaces, busPortNames };
}

function extractBlockContent(content: string, keyword: string): string | null {
  const match = content.match(new RegExp(`\\b${keyword}\\b`, 'i'));
  if (match?.index === undefined) {
    return null;
  }

  const startIndex = content.indexOf('(', match.index);
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  for (let i = startIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(startIndex + 1, i);
      }
    }
  }

  return null;
}

function splitEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }

    if (char === ';' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        entries.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }
  }

  const trimmed = current.trim();
  if (trimmed) {
    entries.push(trimmed);
  }

  return entries;
}
