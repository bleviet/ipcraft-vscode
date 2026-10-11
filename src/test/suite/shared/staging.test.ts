import { allKeptBanner, parseStagingActions, type StagingAction } from '../../../shared/staging';

type F = { status: string; protected: boolean; path: string };
const mod = (path: string, locked = false): F => ({ status: 'modified', protected: locked, path });
const keep = (): StagingAction => 'keep';

describe('allKeptBanner', () => {
  it('counts modified files and omits the locked note when none are locked', () => {
    const text = allKeptBanner([mod('a'), mod('b')], keep);
    expect(text).toMatch(/^2 modified file\(s\) are set to Keep — choose Auto-merge/);
    expect(text).not.toContain('locked');
  });

  it('adds the locked note when a modified file is protected', () => {
    expect(allKeptBanner([mod('a', true)], keep)).toContain('(locked managed: false files');
  });

  it('is undefined when any file is new, applied, excluded or there is nothing modified', () => {
    const newFile: F = { status: 'new', protected: false, path: 'n' };
    expect(allKeptBanner([mod('a'), newFile], keep)).toBeUndefined();
    expect(
      allKeptBanner([mod('a'), mod('b')], (f) => (f.path === 'b' ? 'overwrite' : 'keep'))
    ).toBe(undefined);
    expect(allKeptBanner([mod('a')], () => undefined)).toBeUndefined();
    expect(allKeptBanner([], keep)).toBeUndefined();
  });
});

describe('parseStagingActions', () => {
  it('keeps only known actions and tolerates non-objects', () => {
    expect(parseStagingActions({ a: 'keep', b: 'bogus', c: 'auto-merge' })).toEqual({
      a: 'keep',
      c: 'auto-merge',
    });
    expect(parseStagingActions(undefined)).toEqual({});
    expect(parseStagingActions(null)).toEqual({});
  });
});
