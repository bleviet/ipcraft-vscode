import {
  LABEL_MAX,
  middleTruncate,
  shortLabels,
} from '../../../../webview/systemDiagram/compareLabels';

describe('shortLabels', () => {
  it('shows the file names of two files', () => {
    expect(
      shortLabels('hardware/vivado/a/system.1.bd', 'hardware/vivado/a/system.3.bd', true)
    ).toEqual(['system.1.bd', 'system.3.bd']);
  });

  it('shows the shortest trailing paths that differ when the names are equal', () => {
    expect(shortLabels('a/system.bd', 'b/system.bd', true)).toEqual(['a/system.bd', 'b/system.bd']);
    expect(shortLabels('x/a/system.bd', 'x/b/system.bd', true)).toEqual([
      'a/system.bd',
      'b/system.bd',
    ]);
    expect(shortLabels('system.bd', 'sub/system.bd', true)).toEqual(['system.bd', 'sub/system.bd']);
  });

  it('shows a base that is not a file as it is, whatever it ends with', () => {
    expect(shortLabels('HEAD', 'sys/system.bd', false)).toEqual(['HEAD', 'system.bd']);
    expect(shortLabels('a1b2c3d Regenerate from scripts/design_1.tcl', 'hw/top.bd', false)).toEqual(
      ['a1b2c3d Regenerate from scripts/design_1.tcl', 'top.bd']
    );
    expect(shortLabels('feature/top.bd', 'hw/top.bd', false)).toEqual(['feature/top.bd', 'top.bd']);
    expect(shortLabels('main (merge base 1234567)', 'system.bd', false)).toEqual([
      'main (merge base 1234567)',
      'system.bd',
    ]);
  });

  it('shows the same file twice by name', () => {
    expect(shortLabels('a/system.bd', 'a/system.bd', true)).toEqual(['system.bd', 'system.bd']);
  });
});

describe('middleTruncate', () => {
  it('leaves a short text alone', () => {
    expect(middleTruncate('system.bd')).toBe('system.bd');
    expect(middleTruncate('x'.repeat(LABEL_MAX))).toBe('x'.repeat(LABEL_MAX));
  });

  it('keeps the head and a tail at least as long, in at most max characters', () => {
    const cut = middleTruncate('0123456789'.repeat(5));
    expect([...cut]).toHaveLength(LABEL_MAX);
    const [head, tail] = cut.split('…');
    expect(head.length).toBeLessThanOrEqual(tail.length);
    expect(cut.startsWith('012345678901234…')).toBe(true);
    expect(cut.endsWith('4567890123456789')).toBe(true);
  });

  it('tells apart two long names that differ only at the end', () => {
    const a = middleTruncate('nontrivial_mips_design_for_the_board.1.bd');
    const b = middleTruncate('nontrivial_mips_design_for_the_board.3.bd');
    expect(a).not.toBe(b);
  });

  it('counts code points and never splits a surrogate pair', () => {
    const text = `${'a'.repeat(14)}😀${'b'.repeat(14)}😀😀${'c'.repeat(14)}`;
    const cut = middleTruncate(text);
    expect([...cut]).toHaveLength(LABEL_MAX);
    expect(cut).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
    );
    expect(middleTruncate('😀'.repeat(40))).toBe(`${'😀'.repeat(15)}…${'😀'.repeat(16)}`);
  });

  it('takes the maximum as an argument', () => {
    expect(middleTruncate('abcdefghij', 5)).toBe('ab…ij');
  });
});
