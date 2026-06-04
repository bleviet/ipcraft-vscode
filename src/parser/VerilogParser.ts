import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ParsedPort, ParsedParameter, ParseOptions } from './VhdlParser';
import {
  classifyClocksResets,
  detectBusInterfaces,
  portToDict,
  parseParameterValue,
} from './VhdlParser';

export interface VerilogParseResult {
  moduleName: string;
  yamlText: string;
}

export async function parseVerilogFile(
  filePath: string,
  options: ParseOptions = {}
): Promise<VerilogParseResult> {
  const content = await fs.readFile(filePath, 'utf8');
  const cleaned = stripComments(content);

  const moduleName = extractModuleName(cleaned);
  if (!moduleName) {
    throw new Error('No Verilog/SystemVerilog module declaration found in file');
  }

  const fileType = filePath.endsWith('.sv') ? 'systemverilog' : 'verilog';
  const parameters = extractParameters(cleaned);
  const ports = extractPorts(cleaned);

  const clockReset = classifyClocksResets(ports);
  const busDetection = options.detectBus !== false ? detectBusInterfaces(ports, clockReset) : null;

  const excludedNames = new Set<string>();
  busDetection?.busPortNames.forEach((n) => excludedNames.add(n));
  clockReset.clocks.forEach((c) => excludedNames.add(c.name));
  clockReset.resets.forEach((r) => excludedNames.add(r.name));

  const userPorts = ports.filter((p) => !excludedNames.has(p.name));
  const outputDir = options.outputDir ?? path.dirname(filePath);

  const yamlData: Record<string, unknown> = {
    vlnv: {
      vendor: options.vendor ?? 'user',
      library: options.library ?? 'ip',
      name: moduleName,
      version: options.version ?? '1.0.0',
    },
    description: `Generated from ${path.basename(filePath)}`,
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
    yamlData.ports = userPorts.map((p) => portToDict(p));
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
      dataType: normalizeParamType(param.type),
    }));
  }

  const relPath = path.relative(outputDir, filePath);
  yamlData.fileSets = [
    {
      name: 'RTL_Sources',
      description: 'RTL source files',
      files: [{ path: relPath, type: fileType, managed: false }],
    },
  ];

  return {
    moduleName,
    yamlText: yaml.dump(yamlData, { noRefs: true, sortKeys: false, lineWidth: -1, indent: 2 }),
  };
}

export function extractVerilogInterface(content: string): {
  moduleName: string | null;
  parameters: ParsedParameter[];
  ports: ParsedPort[];
} {
  const cleaned = stripComments(content);
  return {
    moduleName: extractModuleName(cleaned),
    parameters: extractParameters(cleaned),
    ports: extractPorts(cleaned),
  };
}

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

function stripComments(content: string): string {
  // Block comments: replace interior with spaces, preserve newlines so port
  // line-terminators still work as segment delimiters.
  let result = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  // Line comments
  result = result
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return result;
}

// ---------------------------------------------------------------------------
// Module name
// ---------------------------------------------------------------------------

function extractModuleName(content: string): string | null {
  const match = content.match(/\bmodule\s+(\w+)/i);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function extractParameters(content: string): ParsedParameter[] {
  // Try #(...) first (Verilog 2001 / SystemVerilog style).
  const hashParams = extractHashParameters(content);
  if (hashParams.length > 0) {
    return hashParams;
  }
  // Fallback: inline `parameter` declarations in module body (Verilog 95 style).
  return extractBodyParameters(content);
}

function extractHashParameters(content: string): ParsedParameter[] {
  const modMatch = content.match(/\bmodule\s+\w+/i);
  if (!modMatch?.index === undefined) {
    return [];
  }
  const after = content.slice((modMatch?.index ?? 0) + (modMatch?.[0].length ?? 0));

  // Accept optional SV import clause between module name and #(
  const hashMatch = after.match(/^[^(;]*#\s*\(/);
  if (!hashMatch) {
    return [];
  }

  const openIdx = hashMatch[0].length - 1; // position of '(' in `after`
  const block = extractParenBlock(after, openIdx);
  if (!block) {
    return [];
  }

  return parseParameterBlock(block);
}

function extractBodyParameters(content: string): ParsedParameter[] {
  const params: ParsedParameter[] = [];
  const seen = new Set<string>();
  // Matches: parameter [type] [dims] NAME = value
  const re =
    /\bparameter\b\s+(?:(?:int|integer|logic|bit|reg|wire|real|signed|unsigned|byte|shortint|longint)\s+)*(?:\[[^\]]*\]\s*)?(\w+)\s*=\s*([^;,)]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      params.push({ name, type: 'integer', value: m[2].trim() });
    }
  }
  return params;
}

function parseParameterBlock(block: string): ParsedParameter[] {
  const params: ParsedParameter[] = [];
  const seen = new Set<string>();

  for (const entry of splitByComma(block)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    // Strip leading keyword
    let rest = trimmed.replace(/^\s*(parameter|localparam)\s+/i, '');
    // Strip optional type keywords and packed dims
    rest = rest.replace(
      /^(?:(?:int|integer|logic|bit|reg|wire|real|realtime|time|string|byte|shortint|longint|signed|unsigned)\s+)+/i,
      ''
    );
    rest = rest.replace(/^\s*\[[^\]]*\]\s*/, '');

    const eqIdx = rest.indexOf('=');
    let name: string;
    let value: string | undefined;
    if (eqIdx === -1) {
      name = rest.trim();
      value = undefined;
    } else {
      name = rest.slice(0, eqIdx).trim();
      value = rest.slice(eqIdx + 1).trim() || undefined;
    }

    if (!name || !/^\w+$/.test(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    params.push({ name, type: 'integer', value });
  }

  return params;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

// Net/var type keywords that follow a direction keyword but aren't part of
// the port name. Covers standard Verilog and most SystemVerilog types.
const TYPE_KW =
  /^(?:(?:wire|reg|logic|bit|tri|supply0|supply1|wand|wor|triand|trior|tri0|tri1|trireg|integer|real|realtime|time|shortint|int|longint|byte|shortreal|signed|unsigned|automatic|var)\s+)+/i;

function extractPorts(content: string): ParsedPort[] {
  const ports: ParsedPort[] = [];
  const seen = new Set<string>();

  // Collect positions of every direction keyword in the source.
  // input/output/inout are reserved and only appear in port declarations.
  const dirRe = /\b(input|output|inout)\b/gi;
  const hits: Array<{ index: number; dir: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = dirRe.exec(content)) !== null) {
    hits.push({ index: m.index, dir: m[1] });
  }

  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : content.length;
    const segment = content.slice(start, end);

    const dir =
      hits[i].dir.toLowerCase() === 'output'
        ? 'out'
        : hits[i].dir.toLowerCase() === 'inout'
          ? 'inout'
          : 'in';

    // Strip direction keyword
    let rest = segment.replace(/^(input|output|inout)\s+/i, '');
    // Strip type keywords
    rest = rest.replace(TYPE_KW, '');
    // Strip optional packed dimensions and derive width
    let width: number | string | undefined = 1;
    const dimMatch = rest.match(/^\s*(\[([^\]]*)\])\s*/);
    if (dimMatch) {
      width = extractWidth(dimMatch[2]);
      rest = rest.slice(dimMatch[0].length);
    }

    // Everything up to the first ; ) or newline-that-ends-a-port is name(s).
    const nameChunk = rest.match(/^([^;)\n]*)/)?.[1] ?? '';
    const names = nameChunk
      .split(',')
      .map((s) => s.match(/^\s*(\w+)/)?.[1])
      .filter((n): n is string => !!n && !/^\s*$/.test(n));

    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        ports.push({ name, direction: dir, type: 'wire', width });
      }
    }
  }

  return ports;
}

function extractWidth(rangeStr: string): number | string | undefined {
  const s = rangeStr.trim();

  // N : M  (both numeric)
  const numeric = s.match(/^(\d+)\s*:\s*(\d+)$/);
  if (numeric) {
    return Math.abs(parseInt(numeric[1], 10) - parseInt(numeric[2], 10)) + 1;
  }

  // PARAM-1 : 0  →  width = PARAM
  const paramMinus1 = s.match(/^(\w+)\s*-\s*1\s*:\s*0$/);
  if (paramMinus1) {
    return paramMinus1[1];
  }

  // PARAM : 0  →  treat PARAM as width (less common but valid)
  const paramColon0 = s.match(/^(\w+)\s*:\s*0$/);
  if (paramColon0) {
    return paramColon0[1];
  }

  return undefined; // complex expression — leave width unspecified
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeParamType(type: string): string {
  const t = type.toLowerCase().trim();
  if (['real', 'realtime'].includes(t)) {
    return 'real';
  }
  if (t === 'string') {
    return 'string';
  }
  return 'integer';
}

function extractParenBlock(content: string, openIdx: number): string | null {
  if (content[openIdx] !== '(') {
    return null;
  }
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === '(') {
      depth++;
    } else if (content[i] === ')') {
      depth--;
      if (depth === 0) {
        return content.slice(openIdx + 1, i);
      }
    }
  }
  return null;
}

function splitByComma(block: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of block) {
    if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      if (current.trim()) {
        entries.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    entries.push(current.trim());
  }
  return entries;
}
