import { mergeThreeWay } from '../../../../generator/staging/threeWayMerge';

const base = [
  'entity foo_core is',
  '  port (',
  '    clk : in std_logic',
  '  );',
  'end entity foo_core;',
  'architecture rtl of foo_core is',
  'begin',
  '  -- body',
  'end architecture rtl;',
  '',
].join('\n');

describe('mergeThreeWay', () => {
  it('returns the input when nothing changed', () => {
    expect(mergeThreeWay(base, base, base)).toEqual({ clean: true, content: base });
  });

  it('merges a generator port addition with a user architecture edit', () => {
    const incoming = base.replace(
      'clk : in std_logic',
      'clk : in std_logic;\n    irq : out std_logic'
    );
    const current = base.replace('-- body', '-- body\n  user_logic <= clk;');
    const result = mergeThreeWay(base, current, incoming);
    expect(result.clean).toBe(true);
    expect(result.content).toContain('irq : out std_logic');
    expect(result.content).toContain('user_logic <= clk;');
  });

  it('reports a conflict when both sides change the same line differently', () => {
    const current = base.replace('-- body', '-- user body');
    const incoming = base.replace('-- body', '-- generated body');
    expect(mergeThreeWay(base, current, incoming).clean).toBe(false);
  });

  it('does not treat identical changes on both sides as a conflict', () => {
    const changed = base.replace('-- body', '-- same change');
    expect(mergeThreeWay(base, changed, changed)).toEqual({ clean: true, content: changed });
  });

  it('preserves the trailing newline state and CRLF line endings', () => {
    const crlfBase = 'a\r\nb\r\nc';
    const result = mergeThreeWay(crlfBase, 'a\r\nb\r\nc', 'a\r\nB\r\nc');
    expect(result).toEqual({ clean: true, content: 'a\r\nB\r\nc' });
    const withNewline = mergeThreeWay('a\nb\n', 'a\nb\n', 'a\nb\nc\n');
    expect(withNewline.content).toBe('a\nb\nc\n');
  });
});
