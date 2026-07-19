import * as fs from 'fs';
import * as path from 'path';
import {
  CsvCapture,
  SIGNALTAP_PRESET,
  VIVADO_ILA_PRESET,
  csvSignalColumns,
  detectCsvCapturePreset,
} from '../../../dataInspector/csvCapture';

const mapping = (overrides: Partial<Parameters<typeof CsvCapture.parse>[1][number]> = {}) => ({
  name: 'BUS',
  column: 'BUS',
  radix: 'hex' as const,
  width: 32,
  byteOrder: 'bigEndian' as const,
  wordOrder: 'highFirst' as const,
  wordWidth: 16 as const,
  ...overrides,
});

describe('CsvCapture', () => {
  it('maps a signal column with an explicit radix and width', () => {
    const capture = CsvCapture.parse('sample,BUS\n0,1\n1,00FF\n', [mapping()]);

    expect(capture.samples[0].values.get('BUS')?.toLiteral()).toBe("32'h00000001");
    expect(capture.samples[1].values.get('BUS')?.toLiteral()).toBe("32'h000000FF");
  });

  it('keeps word order, byte order, bit reversal, and concatenation distinct', () => {
    const text = 'BUS\n12345678\n';
    const normal = CsvCapture.parse(text, [mapping()]).samples[0].values.get('BUS')!;
    const lowWordFirst = CsvCapture.parse(text, [
      mapping({ wordOrder: 'lowFirst' }),
    ]).samples[0].values.get('BUS')!;
    const littleEndianWords = CsvCapture.parse(text, [
      mapping({ byteOrder: 'littleEndian' }),
    ]).samples[0].values.get('BUS')!;

    expect(normal.toLiteral()).toBe("32'h12345678");
    expect(lowWordFirst.toLiteral()).toBe("32'h56781234");
    expect(littleEndianWords.toLiteral()).toBe("32'h34127856");
    expect(normal.reverseBits().toLiteral()).toBe("32'h1E6A2C48");
    expect(normal.slice(31, 16).concat(normal.slice(15, 0)).toLiteral()).toBe("32'h12345678");
  });

  it('preserves X/Z states and handles quoted CSV fields', () => {
    const capture = CsvCapture.parse('sample,BUS\n"row, 0",XXZZ\n', [mapping({ width: 16 })]);
    expect(capture.samples[0].values.get('BUS')?.toLiteral()).toBe("16'hXXZZ");
  });

  it('recognizes checked-in Vivado ILA and SignalTap export fixtures', () => {
    const fixtureDir = path.join(process.cwd(), 'src', 'test', 'fixtures', 'data-inspector');
    const ila = fs.readFileSync(path.join(fixtureDir, 'vivado-ila.csv'), 'utf8');
    const signalTap = fs.readFileSync(path.join(fixtureDir, 'signaltap.csv'), 'utf8');

    expect(CsvCapture.parse(ila, [mapping({ name: 'ADDR', column: 'ADDR' })]).headers).toContain(
      VIVADO_ILA_PRESET.sampleColumn
    );
    expect(CsvCapture.parse(signalTap, [mapping({ column: 'BUS', width: 16 })]).headers).toContain(
      SIGNALTAP_PRESET.timeColumn
    );
    const ilaHeaders = CsvCapture.parse(ila, [mapping({ name: 'ADDR', column: 'ADDR' })]).headers;
    const signalTapHeaders = CsvCapture.parse(signalTap, [
      mapping({ column: 'BUS', width: 16 }),
    ]).headers;
    expect(detectCsvCapturePreset(ilaHeaders)).toBe('vivadoIla');
    expect(csvSignalColumns(ilaHeaders, 'vivadoIla')).toEqual(['ADDR']);
    expect(detectCsvCapturePreset(signalTapHeaders)).toBe('signalTap');
    expect(csvSignalColumns(signalTapHeaders, 'signalTap')).toEqual(['BUS']);
  });

  it('rejects missing columns, overflow, and incompatible word widths', () => {
    expect(() => CsvCapture.parse('A\n1\n', [mapping()])).toThrow('column not found');
    expect(() => CsvCapture.parse('BUS\n1FF\n', [mapping({ width: 8, wordWidth: 8 })])).toThrow(
      'mapping width is 8'
    );
    expect(() => CsvCapture.parse('BUS\n123\n', [mapping({ width: 12 })])).toThrow(
      'divisible by its word width'
    );
  });
});
