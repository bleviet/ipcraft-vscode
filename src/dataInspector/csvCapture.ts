import { BitVector } from './BitVector';
import { parseLiteral, type LiteralRadix } from './parseLiteral';

export interface CsvSignalMapping {
  name: string;
  column: string;
  radix: LiteralRadix;
  width: number;
  signed?: boolean;
  byteOrder: 'bigEndian' | 'littleEndian';
  wordOrder: 'highFirst' | 'lowFirst';
  wordWidth: 8 | 16 | 32 | 64;
}

export interface CsvCaptureSample {
  index: number;
  values: ReadonlyMap<string, BitVector>;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      field += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index++;
      }
      row.push(field.trim());
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field');
  }
  row.push(field.trim());
  if (row.some((value) => value !== '')) {
    rows.push(row);
  }
  return rows;
}

export function getCsvHeaders(text: string): string[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new Error('CSV is empty');
  }
  return rows[0];
}

function explicitlySize(text: string, mapping: CsvSignalMapping): BitVector {
  if (mapping.radix === 'decimal') {
    return parseLiteral(text, {
      radix: 'decimal',
      width: mapping.width,
      signed: mapping.signed,
    }).vector;
  }
  const parsed = parseLiteral(text, { radix: mapping.radix }).vector;
  if (parsed.width > mapping.width) {
    throw new Error(
      `${mapping.name} value has ${parsed.width} bits but mapping width is ${mapping.width}`
    );
  }
  return parsed.width === mapping.width ? parsed : parsed.zeroExtend(mapping.width);
}

function reorderChunks(vector: BitVector, chunkWidth: number): BitVector {
  if (vector.width % chunkWidth !== 0) {
    throw new Error(`${vector.width}-bit value cannot be divided into ${chunkWidth}-bit chunks`);
  }
  const chunks: BitVector[] = [];
  for (let lsb = 0; lsb < vector.width; lsb += chunkWidth) {
    chunks.push(vector.slice(lsb + chunkWidth - 1, lsb));
  }
  let result = chunks[0];
  for (let index = 1; index < chunks.length; index++) {
    result = result.concat(chunks[index]);
  }
  return result;
}

function applyOrdering(vector: BitVector, mapping: CsvSignalMapping): BitVector {
  if (mapping.width % mapping.wordWidth !== 0) {
    throw new Error(`${mapping.name} width must be divisible by its word width`);
  }
  let ordered = vector;
  if (mapping.wordOrder === 'lowFirst' && mapping.width > mapping.wordWidth) {
    ordered = reorderChunks(ordered, mapping.wordWidth);
  }
  if (mapping.byteOrder === 'littleEndian' && mapping.wordWidth > 8) {
    const words: BitVector[] = [];
    for (let lsb = 0; lsb < ordered.width; lsb += mapping.wordWidth) {
      words.push(ordered.slice(lsb + mapping.wordWidth - 1, lsb).byteSwap());
    }
    let result = words[words.length - 1];
    for (let index = words.length - 2; index >= 0; index--) {
      result = result.concat(words[index]);
    }
    ordered = result;
  }
  return ordered;
}

export class CsvCapture {
  readonly headers: readonly string[];
  readonly samples: readonly CsvCaptureSample[];

  private constructor(headers: string[], samples: CsvCaptureSample[]) {
    this.headers = headers;
    this.samples = samples;
  }

  static parse(text: string, mappings: readonly CsvSignalMapping[]): CsvCapture {
    const rows = parseCsvRows(text);
    if (rows.length === 0) {
      throw new Error('CSV is empty');
    }
    const headers = rows[0];
    const columnIndexes = new Map(headers.map((header, index) => [header, index]));
    for (const mapping of mappings) {
      if (!columnIndexes.has(mapping.column)) {
        throw new Error(`CSV column not found: ${mapping.column}`);
      }
    }
    const samples = rows.slice(1).map((row, index) => {
      const values = new Map<string, BitVector>();
      for (const mapping of mappings) {
        const cell = row[columnIndexes.get(mapping.column)!];
        if (cell === undefined || cell === '') {
          throw new Error(`CSV row ${index + 2} has no value for ${mapping.column}`);
        }
        values.set(mapping.name, applyOrdering(explicitlySize(cell, mapping), mapping));
      }
      return { index, values };
    });
    return new CsvCapture(headers, samples);
  }
}

export const VIVADO_ILA_PRESET = {
  sampleColumn: 'Sample in Buffer',
  triggerColumn: 'Sample in Window',
} as const;

export const SIGNALTAP_PRESET = {
  sampleColumn: 'Data:',
  timeColumn: 'Time:',
} as const;

export type CsvCapturePreset = 'vivadoIla' | 'signalTap';

export function detectCsvCapturePreset(headers: readonly string[]): CsvCapturePreset | null {
  if (
    headers.includes(VIVADO_ILA_PRESET.sampleColumn) &&
    headers.includes(VIVADO_ILA_PRESET.triggerColumn)
  ) {
    return 'vivadoIla';
  }
  if (
    headers.includes(SIGNALTAP_PRESET.sampleColumn) &&
    headers.includes(SIGNALTAP_PRESET.timeColumn)
  ) {
    return 'signalTap';
  }
  return null;
}

export function csvSignalColumns(
  headers: readonly string[],
  preset: CsvCapturePreset | null
): string[] {
  const metadata =
    preset === 'vivadoIla'
      ? new Set([VIVADO_ILA_PRESET.sampleColumn, VIVADO_ILA_PRESET.triggerColumn])
      : preset === 'signalTap'
        ? new Set([SIGNALTAP_PRESET.sampleColumn, SIGNALTAP_PRESET.timeColumn])
        : new Set<string>();
  return headers.filter((header) => !metadata.has(header));
}
