import * as fs from 'fs';
import * as path from 'path';
import { VcdCapture } from '../../../dataInspector/vcd';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'src', 'test', 'fixtures', 'data-inspector', 'basic.vcd'),
  'utf8'
);

describe('VcdCapture', () => {
  it('discovers scoped signals and indexes only selected signal changes', () => {
    const capture = VcdCapture.parse(fixture);
    const selection = capture.selectSignals(['top.state', 'top.count']);

    expect(capture.timescale).toBe('1ns');
    expect(capture.signals.map((signal) => signal.name)).toEqual([
      'top.state',
      'top.count',
      'top.error',
    ]);
    expect(selection.sampleCount).toBe(4);
    expect(selection.sampleTimes).toEqual([BigInt(0), BigInt(10), BigInt(20), BigInt(30)]);
  });

  it('navigates samples and highlights against the immediately preceding selected sample', () => {
    const selection = VcdCapture.parse(fixture).selectSignals(['top.state', 'top.count']);
    const sample = selection.sample(2);

    expect(sample.values.get('top.state')?.toBinary()).toBe('10');
    expect(sample.values.get('top.count')?.toLiteral()).toBe("8'h81");
    expect(sample.changedSignals).toEqual(new Set(['top.state', 'top.count']));
    expect(sample.changedBits.get('top.state')).toEqual(new Set([0, 1]));
    expect(sample.changedBits.get('top.count')).toEqual(new Set([7]));
  });

  it('preserves X/Z states and does not mark an unchanged signal', () => {
    const selection = VcdCapture.parse(fixture).selectSignals(['top.state', 'top.count']);
    const sample = selection.sample(3);

    expect(sample.values.get('top.state')?.toBinary()).toBe('1X');
    expect(sample.changedSignals).toEqual(new Set(['top.state']));
    expect(sample.changedBits.get('top.state')).toEqual(new Set([0]));
  });

  it('rejects unknown signal names and out-of-range sample indexes', () => {
    const capture = VcdCapture.parse(fixture);
    expect(() => capture.selectSignals(['top.missing'])).toThrow('VCD signal not found');
    const selection = capture.selectSignals(['top.state']);
    expect(() => selection.sample(99)).toThrow('outside');
  });
});
