import { collectLoopBody, resolveLoop, type LoopResolveContext } from '../../../parser/hwTclLoops';

function ctx(vars: Record<string, string> = {}, params: Record<string, number> = {}) {
  const context: LoopResolveContext = {
    substitute: (text) => text.replace(/\$\{?(\w+)\}?/g, (m, n: string) => vars[n] ?? m),
    getVariable: (name) => vars[name],
    isParameter: (name) => name in params,
    paramValues: new Map(Object.entries(params)),
  };
  return context;
}

describe('resolveLoop', () => {
  it('resolves < and <= bounds', () => {
    expect(resolveLoop('for {set i 0} {$i < 3} {incr i} {', ctx())).toEqual({
      variable: 'i',
      values: ['0', '1', '2'],
    });
    expect(resolveLoop('for {set i 1} {$i <= 3} {incr i} {', ctx())?.values).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('accepts ${i}, tight and padded conditions, and a step', () => {
    expect(resolveLoop('for {set i 0} {${i}<4} {incr i 2} {', ctx())?.values).toEqual(['0', '2']);
    expect(
      resolveLoop('for {set index 0} { $index < N} {incr index} {', ctx({}, { N: 2 }))?.values
    ).toEqual(['0', '1']);
  });

  it('resolves parameter bounds via variables and get_parameter_value', () => {
    expect(
      resolveLoop('for {set i 0} {$i < $n} {incr i} {', ctx({ n: 'NUM' }, { NUM: 2 }))?.values
    ).toEqual(['0', '1']);
    expect(
      resolveLoop('for {set i 0} {$i < [get_parameter_value NUM]} {incr i} {', ctx({}, { NUM: 3 }))
        ?.values
    ).toHaveLength(3);
  });

  it('resolves foreach over a literal list and a variable', () => {
    expect(resolveLoop('foreach i {0 1 2} {', ctx())).toEqual({
      variable: 'i',
      values: ['0', '1', '2'],
    });
    expect(resolveLoop('foreach n $names {', ctx({ names: 'a b' }))?.values).toEqual(['a', 'b']);
  });

  it('parses quoted and braced foreach items as a Tcl list', () => {
    expect(resolveLoop('foreach s { "_a" "_b" {c d} } {', ctx())?.values).toEqual([
      '_a',
      '_b',
      'c d',
    ]);
  });

  it('expands [list ...] variables but not parameter or command values', () => {
    expect(resolveLoop('foreach n $l {', ctx({ l: '[list a "b"]' }))?.values).toEqual(['a', 'b']);
    expect(resolveLoop('foreach n $l {', ctx({ l: 'CHANS' }, { CHANS: 2 }))).toBeNull();
    expect(resolveLoop('foreach n $l {', ctx({ l: '[get_x]' }))).toBeNull();
  });

  it('returns null for unresolved or unsupported loops', () => {
    expect(resolveLoop('for {set i 0} {$i < $unknown} {incr i} {', ctx())).toBeNull();
    expect(resolveLoop('for {set i 0} {$i < 3} {incr j} {', ctx())).toBeNull();
    expect(resolveLoop('for {set i 0} {$i < 3} {incr i 0} {', ctx())).toBeNull();
    expect(resolveLoop('foreach {a b} {1 2 3 4} {', ctx())).toBeNull();
    expect(resolveLoop('foreach i $missing {', ctx())).toBeNull();
    expect(resolveLoop('foreach i {$a b} {', ctx())).toBeNull();
  });

  it('returns null above 256 iterations', () => {
    expect(resolveLoop('for {set i 0} {$i < 257} {incr i} {', ctx())).toBeNull();
    expect(resolveLoop('for {set i 0} {$i < 256} {incr i} {', ctx())?.values).toHaveLength(256);
  });
});

describe('collectLoopBody', () => {
  it('collects a multi-line body by brace depth', () => {
    const lines = ['for {set i 0} {$i < 2} {incr i} {', 'a', 'if {x} {', 'b', '}', '}', 'after'];
    expect(collectLoopBody(lines, 0)).toEqual({ body: ['a', 'if {x} {', 'b', '}'], next: 6 });
  });

  it('takes the last braced word when closed on the header line', () => {
    expect(collectLoopBody(['foreach i {0 1} { add_interface c$i conduit end }'], 0)).toEqual({
      body: [' add_interface c$i conduit end '],
      next: 1,
    });
  });
});
