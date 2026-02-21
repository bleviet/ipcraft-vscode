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
}

export interface ParseResult {
  entityName: string;
  yamlText: string;
  outputPath?: string;
}

export class VhdlParser {
  async parseFile(vhdlPath: string, options: ParseOptions = {}): Promise<ParseResult> {
    const content = await fs.readFile(vhdlPath, 'utf8');
    const cleaned = this.stripComments(content);

    const entityName = this.extractEntityName(cleaned);
    if (!entityName) {
      throw new Error('No VHDL entity found in file');
    }

    const parameters = this.extractParameters(cleaned);
    const ports = this.extractPorts(cleaned);

    const detectBus = options.detectBus !== false;
    const busDetection = detectBus ? this.detectBusInterfaces(ports) : null;

    const clockReset = this.classifyClocksResets(ports);

    const excludedNames = new Set<string>();
    if (busDetection) {
      busDetection.busPortNames.forEach((name) => excludedNames.add(name));
    }
    clockReset.clocks.forEach((clock) => excludedNames.add(clock.name));
    clockReset.resets.forEach((reset) => excludedNames.add(reset.name));

    const userPorts = ports.filter((port) => !excludedNames.has(port.name));

    const yamlData: Record<string, unknown> = {
      apiVersion: 'ipcore/v1.0',
      vlnv: {
        vendor: options.vendor ?? 'user',
        library: options.library ?? 'ip',
        name: entityName,
        version: options.version ?? '1.0',
      },
      description: `Generated from ${path.basename(vhdlPath)}`,
    };

    if (clockReset.clocks.length > 0) {
      yamlData.clocks = clockReset.clocks.map((clock) => ({
        name: clock.name,
        description: '',
      }));
    }

    if (clockReset.resets.length > 0) {
      yamlData.resets = clockReset.resets.map((reset) => ({
        name: reset.name,
        polarity: reset.polarity,
        description: '',
      }));
    }

    if (userPorts.length > 0) {
      yamlData.ports = userPorts.map((port) => this.portToDict(port));
    }

    if (busDetection && busDetection.busInterfaces.length > 0) {
      yamlData.busInterfaces = busDetection.busInterfaces.map((bus) => ({
        name: bus.name,
        type: bus.type,
        mode: bus.mode,
        physicalPrefix: bus.physicalPrefix,
        description: '',
      }));
    }

    if (parameters.length > 0) {
      yamlData.parameters = parameters.map((param) => ({
        name: param.name,
        value: this.parseParameterValue(param.value),
        dataType: param.type.toLowerCase(),
      }));
    }

    yamlData.fileSets = [
      {
        name: 'RTL_Sources',
        description: 'RTL source files',
        files: [{ path: path.basename(vhdlPath), type: 'vhdl' }],
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

  private stripComments(content: string): string {
    return content
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
  }

  private extractEntityName(content: string): string | null {
    const match = content.match(/\bentity\s+(\w+)\s+is\b/i);
    return match ? match[1] : null;
  }

  private extractParameters(content: string): ParsedParameter[] {
    const body = this.extractBlockContent(content, 'generic');
    if (!body) {
      return [];
    }

    const entries = this.splitEntries(body);
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

  private extractPorts(content: string): ParsedPort[] {
    const body = this.extractBlockContent(content, 'port');
    if (!body) {
      return [];
    }

    const entries = this.splitEntries(body);
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
      const width = this.extractWidthFromType(type);

      names.forEach((name) => {
        ports.push({ name, direction, type, width });
      });
    }

    return ports;
  }

  private extractWidthFromType(type: string): number | string | undefined {
    if (/\bstd_logic\b/i.test(type)) {
      if (/std_logic_vector/i.test(type)) {
        const rangeMatch = type.match(/\(([^)]+)\)/);
        if (!rangeMatch) {
          return undefined;
        }
        const range = rangeMatch[1];
        const numericMatch = range.match(/(\d+)\s+downto\s+(\d+)/i);
        if (numericMatch) {
          const high = Number(numericMatch[1]);
          const low = Number(numericMatch[2]);
          return Math.abs(high - low) + 1;
        }

        const paramMatch = range.match(/(\w+)\s*-\s*1\s+downto\s+0/i);
        if (paramMatch) {
          return paramMatch[1];
        }
      }
      return 1;
    }

    return undefined;
  }

  private portToDict(port: ParsedPort): Record<string, unknown> {
    let logicalName = port.name.toUpperCase();
    for (const prefix of ['IO_', 'I_', 'O_']) {
      if (logicalName.startsWith(prefix)) {
        logicalName = logicalName.slice(prefix.length);
        break;
      }
    }

    const result: Record<string, unknown> = {
      name: port.name,
      logicalName,
      direction: port.direction,
    };

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

  private parseParameterValue(value?: string): unknown {
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

  private classifyClocksResets(ports: ParsedPort[]): {
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

  private detectBusInterfaces(ports: ParsedPort[]): {
    busInterfaces: Array<{
      name: string;
      type: string;
      mode: string;
      physicalPrefix: string;
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

    const axiMatch = this.findBestPrefix(lowerPorts, axiSignals);
    const avalonMatch = this.findBestPrefix(lowerPorts, avalonSignals);

    let selected: {
      prefix: string;
      count: number;
      type: 'AXI4L' | 'AVALON_MM';
    } | null = null;

    if (axiMatch.count >= 4 || avalonMatch.count >= 3) {
      if (axiMatch.count >= avalonMatch.count) {
        selected = {
          prefix: axiMatch.prefix,
          count: axiMatch.count,
          type: 'AXI4L',
        };
      } else {
        selected = {
          prefix: avalonMatch.prefix,
          count: avalonMatch.count,
          type: 'AVALON_MM',
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

    return {
      busInterfaces: [
        {
          name: busName,
          type: selected.type,
          mode: 'slave',
          physicalPrefix: physicalPrefix,
        },
      ],
      busPortNames,
    };
  }

  private findBestPrefix(ports: string[], signals: string[]): { prefix: string; count: number } {
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

  private extractBlockContent(content: string, keyword: string): string | null {
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

  private splitEntries(body: string): string[] {
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
}
