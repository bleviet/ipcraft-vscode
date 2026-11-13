import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import { changeSummaryText } from '../../../../webview/systemDiagram/changeSummary';
import { emptyDiff, zynqDiff } from './compareFixtures';

const only = (key: 'instances' | 'ports' | 'segments', count: number): SystemGraphDiff => {
  const base = emptyDiff();
  return { ...base, [key]: Array(count).fill({}) };
};

describe('changeSummaryText', () => {
  it('names what differs, from the base', () => {
    expect(changeSummaryText(zynqDiff(), 'HEAD')).toBe(
      '4 blocks, 1 port and 3 address segments differ from HEAD.'
    );
  });

  it('leaves out what has no change and counts a single thing', () => {
    expect(changeSummaryText(only('instances', 1), 'v1')).toBe('1 block differs from v1.');
    expect(changeSummaryText(only('segments', 2), 'v1')).toBe('2 address segments differ from v1.');
    expect(changeSummaryText(only('ports', 1), 'v1')).toBe('1 port differs from v1.');
  });

  it('says so when nothing differs', () => {
    expect(changeSummaryText(emptyDiff(), 'main')).toBe('No changes compared with main.');
  });
});
