import { buildExcludeGlob } from '../../../../../services/systemDiagram/enrichment/excludeGlob';
import { IGNORED_DIRECTORY_GLOBS } from '../../../../../services/systemDiagram/enrichment/workspaceFilter';

const DEFAULTS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.Xil/**',
  '**/*.gen/**',
  '**/*.cache/**',
  '**/*.ip_user_files/**',
  '**/*.runs/**',
  '**/*.sim/**',
];

describe('buildExcludeGlob', () => {
  it('derives the ignored directory globs from the shared list', () => {
    expect(IGNORED_DIRECTORY_GLOBS).toEqual(DEFAULTS);
    expect(buildExcludeGlob(undefined)).toEqual({ glob: `{${DEFAULTS.join(',')}}`, skipped: [] });
  });

  it('adds true entries of search.exclude', () => {
    const { glob } = buildExcludeGlob({ '**/build': true, '**/out/**': true });
    expect(glob).toBe(`{${[...DEFAULTS, '**/build', '**/out/**'].join(',')}}`);
  });

  it('ignores false entries and entries with a when clause', () => {
    const { glob } = buildExcludeGlob({
      '**/a': false,
      '**/b': { when: '$(basename).ts' },
      '**/c': true,
    });
    expect(glob).toBe(`{${[...DEFAULTS, '**/c'].join(',')}}`);
  });

  it('expands a brace group into alternatives', () => {
    const { glob } = buildExcludeGlob({ '**/*.{bak,tmp}': true });
    expect(glob).toBe(`{${[...DEFAULTS, '**/*.bak', '**/*.tmp'].join(',')}}`);
  });

  it('expands several separate brace groups', () => {
    const { glob } = buildExcludeGlob({ '{a,b}/x.{c,d}': true });
    expect(glob).toContain('a/x.c,a/x.d,b/x.c,b/x.d');
  });

  it('skips and reports patterns with nested, unbalanced or stray braces', () => {
    const result = buildExcludeGlob({
      '**/{a,{b,c}}': true,
      '**/}x': true,
      '**/{x': true,
      '**/ok': true,
    });
    expect(result.skipped).toEqual(['**/{a,{b,c}}', '**/}x', '**/{x']);
    expect(result.glob).toBe(`{${[...DEFAULTS, '**/ok'].join(',')}}`);
  });

  it('does not treat braces inside a character class as a group', () => {
    const { glob, skipped } = buildExcludeGlob({ '**/[{]x': true, '**/[}]y': true });
    expect(skipped).toEqual([]);
    expect(glob).toContain('**/[{]x,**/[}]y');
  });
});
