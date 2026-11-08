import {
  parseUserSection,
  createUserLibraryMatcher,
} from '../../../../services/vhdlLsConfig/userSection';

describe('parseUserSection', () => {
  it('returns lower-cased user libraries with files and exclude', () => {
    const result = parseUserSection(
      "[libraries.OSVVM]\nfiles = ['ext/osvvm/*.vhd']\nexclude = ['ext/osvvm/old/*.vhd']\n"
    );
    expect(result).toEqual({
      ok: true,
      section: {
        libraries: [
          { name: 'osvvm', files: ['ext/osvvm/*.vhd'], exclude: ['ext/osvvm/old/*.vhd'] },
        ],
        proposedLibraries: new Set(),
      },
    });
  });

  it('collects the libraries that already have a proposal marker', () => {
    const result = parseUserSection(
      '# Missing library OSVVM, used by a.vhd:3.\n# [libraries.osvvm]\n#Missing library unisim\n'
    );
    expect(result.ok && [...result.section.proposedLibraries].sort()).toEqual(['osvvm', 'unisim']);
  });

  it('reports invalid TOML with its line', () => {
    const result = parseUserSection('[lint]\nunused = \n');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.line).toBe(2);
  });
});

describe('createUserLibraryMatcher', () => {
  const lib = { name: 'x', files: ['src/**/*.vhd', 'top.vhd'], exclude: ['src/old/*.vhd'] };

  it('matches ** and * globs against root-relative paths', () => {
    expect(createUserLibraryMatcher(lib)('src/a.vhd')).toBe(true);
    expect(createUserLibraryMatcher(lib)('src/deep/er/a.vhd')).toBe(true);
    expect(createUserLibraryMatcher(lib)('top.vhd')).toBe(true);
    expect(createUserLibraryMatcher(lib)('other/a.vhd')).toBe(false);
  });

  it('applies exclude patterns', () => {
    expect(createUserLibraryMatcher(lib)('src/old/a.vhd')).toBe(false);
  });

  it('keeps * within one path segment', () => {
    expect(
      createUserLibraryMatcher({ name: 'x', files: ['a/*.vhd'], exclude: [] })('a/b/c.vhd')
    ).toBe(false);
  });
});
