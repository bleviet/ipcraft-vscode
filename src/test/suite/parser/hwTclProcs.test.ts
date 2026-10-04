import {
  computeProcDefaults,
  hasCeilLog2Proc,
  isCeilLog2Proc,
  parseProcParams,
} from '../../../parser/hwTclProcs';

const lines = (text: string): string[] => text.split('\n');

describe('parseProcParams', () => {
  it('parses plain, defaulted, quoted and empty defaults', () => {
    expect(parseProcParams('addr_width {addr_width 7} {port_role "export"} {suffix {}}')).toEqual([
      { name: 'addr_width' },
      { name: 'addr_width', defaultValue: '7' },
      { name: 'port_role', defaultValue: 'export' },
      { name: 'suffix', defaultValue: '' },
    ]);
  });

  it('returns no params for an empty list', () => {
    expect(parseProcParams('')).toEqual([]);
  });
});

describe('computeProcDefaults', () => {
  it('binds defaults of a proc called without arguments', () => {
    const defaults = computeProcDefaults(
      lines(`proc mgmt { {addr_width 7} } {
  add_interface_port a b c Input $addr_width
}
mgmt`)
    );
    expect(defaults.get('mgmt')).toEqual(new Map([['addr_width', '7']]));
  });

  it('binds all defaults of an uncalled callback', () => {
    const defaults = computeProcDefaults(lines('proc elaborate { {a 1} {b 2} } {\n}'));
    expect(defaults.get('elaborate')).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ])
    );
  });

  it('does not bind a param that any call site passes', () => {
    const defaults = computeProcDefaults(
      lines(`proc add_splitter { {n 4} } {
}
add_splitter $x
add_splitter`)
    );
    expect(defaults.has('add_splitter')).toBe(false);
  });

  it('binds only the params beyond the passed arity', () => {
    const defaults = computeProcDefaults(lines('proc p { {a 1} {b 2} } {\n}\np 5'));
    expect(defaults.get('p')).toEqual(new Map([['b', '2']]));
  });
});

describe('isCeilLog2Proc', () => {
  const loop = (init: string, cmp = '<'): string[] =>
    lines(`proc log2ceil {num} {
    #comment
    set val ${init}
    set i 1
    while {$i ${cmp} $num} {
        set val [expr $val + 1]
        set i [expr 1 << $val]
    }
    return $val;
}`);

  it('accepts the loop form', () => {
    expect(isCeilLog2Proc(loop('0'), 0)).toBe(true);
  });

  it('accepts the loop form regardless of spacing inside expr', () => {
    const l = loop('0').map((x) => x.replace('[expr $val + 1]', '[ expr $val+1 ]'));
    expect(isCeilLog2Proc(l, 0)).toBe(true);
  });

  it('accepts the quoted one-liner', () => {
    expect(isCeilLog2Proc(['proc log2ceil x "expr {int(ceil(log(\\$x)/[expr log(2)]))}"'], 0)).toBe(
      true
    );
  });

  it('accepts the return [expr ...] body', () => {
    expect(
      isCeilLog2Proc(
        lines('proc log2ceil {x} {\n  return [expr {int(ceil(log($x) / log(2)))}]\n}'),
        0
      )
    ).toBe(true);
  });

  it('rejects the log(1) = 1 variant', () => {
    expect(isCeilLog2Proc(loop('1'), 0)).toBe(false);
  });

  it('rejects the <= variant', () => {
    expect(isCeilLog2Proc(loop('0', '<='), 0)).toBe(false);
  });

  it('hasCeilLog2Proc classifies the last definition', () => {
    const quoted = 'proc log2ceil x "expr {int(ceil(log(\\$x)/[expr log(2)]))}"';
    expect(hasCeilLog2Proc([quoted, ...loop('1')])).toBe(false);
    expect(hasCeilLog2Proc([...loop('1'), quoted])).toBe(true);
    expect(hasCeilLog2Proc(['set a 1'])).toBe(false);
  });
});
