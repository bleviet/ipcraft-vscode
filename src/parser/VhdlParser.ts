import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

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

  if (clockReset.clocks.length > 0) {
    yamlData.clocks = clockReset.clocks.map((clock) => ({
      name: clock.name,
      direction: 'in',
    }));
  }

  if (clockReset.resets.length > 0) {
    yamlData.resets = clockReset.resets.map((reset) => ({
      name: reset.name,
      direction: 'in',
      polarity: reset.polarity,
    }));
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
      return entry;
    });
  }

  if (parameters.length > 0) {
    yamlData.parameters = parameters.map((param) => ({
      name: param.name,
      value: parseParameterValue(param.value),
      dataType: param.type.toLowerCase(),
    }));
  }

  const relativeVhdlPath = path.relative(outputDir, vhdlPath);

  yamlData.fileSets = [
    {
      name: 'RTL_Sources',
      description: 'RTL source files',
      files: [{ path: relativeVhdlPath, type: 'vhdl' }],
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
    if (!cleaned?.includes(':')) {
      continue;
    }
    const [namesPart, typePart] = cleaned.split(':');
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

function extractWidthFromType(type: string): number | string | undefined {
  if (/std_logic_vector/i.test(type)) {
    const rangeMatch = type.match(/\(([^)]+)\)/);
    if (!rangeMatch) {
      return undefined;
    }
    const range = rangeMatch[1];
    const paramMatch = range.match(/(\w+)\s*-\s*1\s+downto\s+0/i);
    if (paramMatch) {
      return paramMatch[1];
    }
    const numericMatch = range.match(/(\d+)\s+downto\s+(\d+)/i);
    if (numericMatch) {
      const high = Number(numericMatch[1]);
      const low = Number(numericMatch[2]);
      return Math.abs(high - low) + 1;
    }
    return undefined;
  }

  if (/\bstd_logic\b/i.test(type)) {
    return 1;
  }

  return undefined;
}

function portToDict(port: ParsedPort): Record<string, unknown> {
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

function parseParameterValue(value?: string): unknown {
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

function classifyClocksResets(ports: ParsedPort[]): {
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

function detectBusInterfaces(
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
  }>;
  busPortNames: Set<string>;
} {
  const lowerPorts = ports.map((port) => port.name.toLowerCase());
  const axiSignals = [
    'awaddr',
    'awvalid',
    'awready',
    'wdata',
    'wstrb',
    'wvalid',
    'wready',
    'bresp',
    'bvalid',
    'bready',
    'araddr',
    'arvalid',
    'arready',
    'rdata',
    'rresp',
    'rvalid',
    'rready',
  ];
  const avalonSignals = ['address', 'read', 'write', 'writedata', 'readdata'];

  const axiMatch = findBestPrefix(lowerPorts, axiSignals);
  const avalonMatch = findBestPrefix(lowerPorts, avalonSignals);

  let selected: {
    prefix: string;
    count: number;
    type: string;
  } | null = null;

  if (axiMatch.count >= 4 || avalonMatch.count >= 3) {
    if (axiMatch.count >= avalonMatch.count) {
      selected = {
        prefix: axiMatch.prefix,
        count: axiMatch.count,
        type: 'ipcraft.busif.axi4_lite.1.0',
      };
    } else {
      selected = {
        prefix: avalonMatch.prefix,
        count: avalonMatch.count,
        type: 'ipcraft.busif.avalon_mm.1.0',
      };
    }
  }

  if (!selected?.prefix) {
    return { busInterfaces: [], busPortNames: new Set() };
  }

  const physicalPrefix = selected.prefix;
  const busName = physicalPrefix.replace(/_+$/, '') || 'bus';
  const busPortNames = new Set<string>();
  ports.forEach((port) => {
    if (port.name.toLowerCase().startsWith(physicalPrefix)) {
      busPortNames.add(port.name);
    }
  });

  const associatedClock = clockReset.clocks.find((c) =>
    c.name.toLowerCase().startsWith(physicalPrefix)
  )?.name;
  const associatedReset = clockReset.resets.find((r) =>
    r.name.toLowerCase().startsWith(physicalPrefix)
  )?.name;

  return {
    busInterfaces: [
      {
        name: busName,
        type: selected.type,
        mode: 'slave',
        physicalPrefix,
        associatedClock,
        associatedReset,
      },
    ],
    busPortNames,
  };
}

function findBestPrefix(ports: string[], signals: string[]): { prefix: string; count: number } {
  const counts = new Map<string, number>();
  ports.forEach((name) => {
    signals.forEach((signal) => {
      if (name.endsWith(signal)) {
        const prefix = name.slice(0, name.length - signal.length);
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
    });
  });

  let bestPrefix = '';
  let bestCount = 0;
  counts.forEach((count, prefix) => {
    if (count > bestCount) {
      bestCount = count;
      bestPrefix = prefix;
    }
  });

  return { prefix: bestPrefix, count: bestCount };
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
