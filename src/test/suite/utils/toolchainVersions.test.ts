import {
  compareVersions,
  sortVersionsDescending,
  findClosestVersion,
  matchConfiguredVersions,
  candidateVivadoReleases,
} from '../../../utils/toolchainVersions';

describe('compareVersions', () => {
  it('orders numeric dotted versions ascending', () => {
    expect(compareVersions('2023.1', '2024.2')).toBeLessThan(0);
    expect(compareVersions('2024.2', '2023.1')).toBeGreaterThan(0);
    expect(compareVersions('2024.1', '2024.1')).toBe(0);
  });

  it('compares three-segment versions (Quartus style)', () => {
    expect(compareVersions('23.1.0', '23.1.1')).toBeLessThan(0);
  });

  it('falls back to lexicographic compare for non-numeric labels', () => {
    expect(compareVersions('latest-patched', 'stable')).toBeLessThan(0);
  });
});

describe('sortVersionsDescending', () => {
  it('sorts newest first', () => {
    expect(sortVersionsDescending(['2022.1', '2024.2', '2023.1'])).toEqual([
      '2024.2',
      '2023.1',
      '2022.1',
    ]);
  });
});

describe('findClosestVersion', () => {
  it('picks the numerically nearest configured version', () => {
    expect(findClosestVersion('2024.2', ['2022.1', '2024.1', '2025.1'])).toBe('2024.1');
  });

  it('breaks ties toward the higher version', () => {
    expect(findClosestVersion('2024.0', ['2023.2', '2025.2'])).toBe('2025.2');
  });

  it('returns undefined when nothing is configured', () => {
    expect(findClosestVersion('2024.2', [])).toBeUndefined();
  });
});

describe('matchConfiguredVersions', () => {
  it('returns only configured entries matching a candidate version', () => {
    const configured = [
      { runner: 'local' as const, version: '2024.1' },
      { runner: 'docker' as const, version: '2024.2' },
      { runner: 'local' as const, version: '2023.1' },
    ];
    expect(matchConfiguredVersions(['2024.1', '2024.2'], configured)).toEqual([
      configured[0],
      configured[1],
    ]);
  });
});

describe('candidateVivadoReleases', () => {
  it('returns an empty array for an unlisted format version', () => {
    expect(candidateVivadoReleases('999', '0')).toEqual([]);
  });
});
