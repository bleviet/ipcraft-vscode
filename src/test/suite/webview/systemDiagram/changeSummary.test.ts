import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import { changeSummaryText } from '../../../../webview/systemDiagram/changeSummary';
import { emptyDiff, zynqDiff } from './compareFixtures';

const only = (key: 'instances' | 'ports' | 'segments', count: number): SystemGraphDiff => {
  const base = emptyDiff();
  return { ...base, [key]: Array(count).fill({}) };
};

describe('changeSummaryText', () => {
  it('names what differs', () => {
    expect(changeSummaryText(zynqDiff())).toBe('4 blocks, 1 port and 3 address segments differ.');
  });

  it('leaves out what has no change and counts a single thing', () => {
    expect(changeSummaryText(only('instances', 1))).toBe('1 block differs.');
    expect(changeSummaryText(only('segments', 2))).toBe('2 address segments differ.');
    expect(changeSummaryText(only('ports', 1))).toBe('1 port differs.');
  });

  it('says so when nothing differs', () => {
    expect(changeSummaryText(emptyDiff())).toBe('No changes.');
  });
});
