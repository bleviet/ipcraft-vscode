import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import { CHANGE_KINDS, changeSummaryText } from '../../../../webview/systemDiagram/changeSummary';
import { emptyDiff, renameDiff, zynqDiff } from './compareFixtures';

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

  it('counts a renamed block as a block that differs', () => {
    const rename = renameDiff();
    expect(rename.instances.map((i) => i.status)).toEqual(['renamed', 'changed']);
    expect(changeSummaryText(rename)).toBe('2 blocks differ.');
    expect(changeSummaryText({ ...rename, instances: rename.instances.slice(0, 1) })).toBe(
      '1 block differs.'
    );
  });
});

describe('CHANGE_KINDS', () => {
  it('lists the five kinds in display order, the renamed one fourth', () => {
    expect(CHANGE_KINDS.map(({ sign, key, chip }) => [sign, key, chip])).toEqual([
      ['+', 'added', 'Added'],
      ['−', 'removed', 'Removed'],
      ['~', 'changed', 'Changed'],
      ['→', 'renamed', 'Renamed'],
      ['v', 'version', 'Version only'],
    ]);
    expect(CHANGE_KINDS[3]).toMatchObject({
      badge: 'Renamed',
      meaning: 'Same block under a new name',
    });
  });
});
