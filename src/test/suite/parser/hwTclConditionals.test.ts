import { collectIfChain, selectIfBranches } from '../../../parser/hwTclConditionals';

describe('collectIfChain', () => {
  it('collects a multi-line if/elseif/else chain', () => {
    const lines = [
      'if { $a > 0 } {',
      '  add_a',
      '} elseif { $b } {',
      '  add_b',
      '} else {',
      '  add_c',
      '}',
      'after',
    ];
    const chain = collectIfChain(lines, 0);
    expect(chain.parsed).toBe(true);
    expect(chain.next).toBe(7);
    expect(chain.branches.map((b) => b.condition?.trim() ?? null)).toEqual(['$a > 0', '$b', null]);
    expect(chain.branches.map((b) => b.body.map((l) => l.trim()).filter(Boolean))).toEqual([
      ['add_a'],
      ['add_b'],
      ['add_c'],
    ]);
  });

  it('collects single-line braced forms', () => {
    const lines = ['if {X} {add_a} else {add_b}', 'next'];
    const chain = collectIfChain(lines, 0);
    expect(chain.next).toBe(1);
    expect(chain.branches).toEqual([
      { condition: 'X', body: ['add_a'] },
      { condition: null, body: ['add_b'] },
    ]);
  });

  it('keeps nested braces inside bodies and ignores comment lines', () => {
    const lines = [
      'if {X} {',
      '  # a stray { in a comment',
      '  foreach i {1 2} {',
      '    cmd $i',
      '  }',
      '}',
    ];
    const chain = collectIfChain(lines, 0);
    expect(chain.parsed).toBe(true);
    expect(chain.next).toBe(6);
    const body = chain.branches[0].body.map((l) => l.trim()).filter(Boolean);
    expect(body).toEqual(['foreach i {1 2} {', 'cmd $i', '}']);
  });

  it('falls back to one flat body when the chain is not parseable', () => {
    const lines = ['if $x {', '  cmd', '}'];
    const chain = collectIfChain(lines, 0);
    expect(chain.parsed).toBe(false);
    expect(chain.branches).toEqual([{ condition: null, body: ['  cmd'] }]);
    expect(chain.next).toBe(3);
  });
});

describe('selectIfBranches', () => {
  const chain = {
    parsed: true,
    next: 1,
    branches: [
      { condition: 'a', body: ['A'] },
      { condition: 'b', body: ['B'] },
      { condition: null, body: ['C'] },
    ],
  };

  it('selects the first true branch', () => {
    expect(selectIfBranches(chain, (c) => c === 'b')).toEqual({ bodies: [['B']], resolved: true });
  });

  it('selects else when all conditions are false', () => {
    expect(selectIfBranches(chain, () => false)).toEqual({ bodies: [['C']], resolved: true });
  });

  it('selects nothing when no else matches', () => {
    const noElse = { ...chain, branches: chain.branches.slice(0, 2) };
    expect(selectIfBranches(noElse, () => false)).toEqual({ bodies: [], resolved: true });
  });

  it('returns every body when a reached condition is unevaluable', () => {
    expect(selectIfBranches(chain, (c) => (c === 'a' ? false : null))).toEqual({
      bodies: [['A'], ['B'], ['C']],
      resolved: false,
    });
  });

  it('ignores unevaluable conditions after a selection', () => {
    expect(selectIfBranches(chain, (c) => (c === 'a' ? true : null)).resolved).toBe(true);
  });
});
