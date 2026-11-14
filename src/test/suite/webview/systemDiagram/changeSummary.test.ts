import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import {
  CHANGE_KINDS,
  changeSummaryText,
  shownKinds,
} from '../../../../webview/systemDiagram/changeSummary';
import { emptyDiff, moveDiff, renameDiff, zynqDiff } from './compareFixtures';

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
  it('lists the six kinds in display order, the renamed and the moved one after the changed one', () => {
    expect(CHANGE_KINDS.map(({ sign, key, chip }) => [sign, key, chip])).toEqual([
      ['+', 'added', 'Added'],
      ['−', 'removed', 'Removed'],
      ['~', 'changed', 'Changed'],
      ['→', 'renamed', 'Renamed'],
      ['»', 'moved', 'Moved'],
      ['v', 'version', 'Version only'],
    ]);
    expect(CHANGE_KINDS[3]).toMatchObject({
      badge: 'Renamed',
      meaning: 'Same block under a new name',
    });
    expect(CHANGE_KINDS[4]).toMatchObject({
      badge: 'Moved',
      meaning: 'Same block under another level',
    });
  });
});

describe('shownKinds', () => {
  const keys = (kinds: typeof CHANGE_KINDS) => kinds.map(({ key }) => key);

  it('lists the version kind by default, and the renamed kind only after a rename', () => {
    expect(keys(shownKinds(zynqDiff().summary))).toEqual([
      'added',
      'removed',
      'changed',
      'version',
    ]);
    expect(keys(shownKinds(renameDiff().summary))).toContain('renamed');
  });

  it('lists the moved kind only after a move', () => {
    expect(keys(shownKinds(zynqDiff().summary))).not.toContain('moved');
    expect(keys(shownKinds(renameDiff().summary))).not.toContain('moved');
    expect(keys(shownKinds(moveDiff().summary))).toEqual([
      'added',
      'removed',
      'changed',
      'moved',
      'version',
    ]);
  });

  it('leaves the version kind out when asked, whatever the count', () => {
    expect(keys(shownKinds(zynqDiff().summary, { version: false }))).toEqual([
      'added',
      'removed',
      'changed',
    ]);
    expect(keys(shownKinds(renameDiff().summary, { version: false }))).toEqual([
      'added',
      'removed',
      'changed',
      'renamed',
    ]);
  });
});
