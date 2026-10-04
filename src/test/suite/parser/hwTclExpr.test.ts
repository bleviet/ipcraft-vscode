import {
  evaluateTclCondition,
  evaluateTclInt,
  numericParamValues,
  hasTclSyntax,
  log2ceilToClog2,
  reduceTclExpr,
  resolveTclWidth,
} from '../../../parser/hwTclExpr';

const params = new Set(['DMA_WIDTH', 'AVL_ADDR_WIDTH', 'CALENDAR_PAGES']);

describe('reduceTclExpr', () => {
  it.each([
    ['expr {8+2}', 10],
    ['expr 4 * 64', 256],
    ['expr 7/2', 3],
    ['expr -7/2', -4],
    ['expr -7 % 3', 2],
    ['expr (1+2)*3', 9],
  ])('evaluates %s', (text, expected) => {
    expect(reduceTclExpr(text, params)).toBe(expected);
  });

  it.each([
    ['expr DMA_WIDTH/8', 'DMA_WIDTH/8'],
    ['expr 16 *   CALENDAR_PAGES', '16 * CALENDAR_PAGES'],
    ['expr {[get_parameter_value "DMA_WIDTH"] / 8}', 'DMA_WIDTH / 8'],
    ['expr {[get_parameter_value AVL_ADDR_WIDTH] + 2}', 'AVL_ADDR_WIDTH + 2'],
  ])('keeps %s symbolic', (text, expected) => {
    expect(reduceTclExpr(text, params)).toBe(expected);
  });

  it.each([
    'expr {int(ceil(log(1)/log(2)))}',
    'expr {"L"*1}',
    'expr UNKNOWN + 1',
    'expr $x',
    'expr expr int(CHECK/2) *BITSPERSYMBOL',
    '[log2 DATA_WIDTH] - 3',
    'expr 1/0',
    'expr DMA_WIDTH +',
  ])('returns null for %s', (text) => {
    expect(reduceTclExpr(text, params)).toBeNull();
  });
});

describe('evaluateTclInt', () => {
  const values = new Map([['N', 3]]);
  it('substitutes parameter defaults', () => {
    expect(evaluateTclInt('N * 2', values)).toBe(6);
    expect(evaluateTclInt('[get_parameter_value N]', values)).toBe(3);
    expect(evaluateTclInt('[expr N + 1]', values)).toBe(4);
  });
  it('returns null for unknown identifiers', () => {
    expect(evaluateTclInt('M', values)).toBeNull();
  });
});

describe('hasTclSyntax', () => {
  it.each(['a$b', 'a[b', 'a]', '{a', 'a}', 'expr 4', 'x expr'])('flags %s', (s) => {
    expect(hasTclSyntax(s)).toBe(true);
  });
  it.each(['DATA_WIDTH/8', 'tx_ch0_datain', 'expr_width', ''])('accepts %s', (s) => {
    expect(hasTclSyntax(s)).toBe(false);
  });
});

describe('resolveTclWidth', () => {
  it('requires a full-match integer literal', () => {
    expect(resolveTclWidth('32', params)).toBe(32);
    expect(resolveTclWidth('2 * X', params)).toBe('2 * X');
    expect(resolveTclWidth('8${x}', params)).toBeUndefined();
  });
});

describe('evaluateTclCondition', () => {
  const values = new Map([
    ['W', 0],
    ['N', 8],
    ['EN', 1],
  ]);

  it.each([
    ['W > 0', false],
    ['N > 0', true],
    ['N == 8', true],
    ['N != 8', false],
    ['N <= 8 && W >= 0', true],
    ['W || EN', true],
    ['W && EN', false],
    ['!W', true],
    ['!(N == 8)', false],
    ['(W || EN) && (N > 4 || W)', true],
    ['N - 8 == 0', true],
    ['EN', true],
    ['W', false],
    ['{ [ get_parameter_value N ] == 8 }', true],
    ['[get_parameter_value W] > 0', false],
  ])('evaluates %s', (text, expected) => {
    expect(evaluateTclCondition(text, values)).toBe(expected);
  });

  it.each([['MODE == "Aligned Accesses"'], ['UNKNOWN > 0'], ['N = 8'], ['N > 0 &&'], ['$x > 0']])(
    'returns null for %s',
    (text) => {
      expect(evaluateTclCondition(text, values)).toBeNull();
    }
  );

  it('keeps comparison operators out of widths', () => {
    expect(reduceTclExpr('A == B', new Set(['A', 'B']))).toBeNull();
    expect(reduceTclExpr('expr {A > 1}', new Set(['A']))).toBeNull();
    expect(evaluateTclInt('1 == 1', new Map())).toBeNull();
  });
});

describe('numericParamValues', () => {
  it('keeps integers and maps booleans to 1/0', () => {
    const values = numericParamValues([
      { name: 'A', defaultValue: '8' },
      { name: 'B', defaultValue: 'true' },
      { name: 'C', defaultValue: 'FALSE' },
      { name: 'D', defaultValue: 'abc' },
      { name: 'E', defaultValue: ' ' },
      { name: 'F' },
    ]);
    expect(Object.fromEntries(values)).toEqual({ A: 8, B: 1, C: 0 });
  });
});

describe('clog2', () => {
  it.each([
    ['clog2(1)', 0],
    ['clog2(0)', 0],
    ['clog2(2)', 1],
    ['clog2(5)', 3],
    ['clog2(8)', 3],
    ['clog2(9) + 1', 5],
  ])('evaluates %s as an integer', (text, expected) => {
    expect(evaluateTclInt(text, new Map())).toBe(expected);
  });

  it('uses parameter defaults', () => {
    expect(evaluateTclInt('clog2(N)', new Map([['N', 16]]))).toBe(4);
    expect(evaluateTclInt('clog2(N)', new Map())).toBeNull();
  });

  it('works in conditions', () => {
    expect(evaluateTclCondition('[expr clog2(N) > 0]', new Map([['N', 4]]))).toBe(true);
    expect(evaluateTclCondition('clog2(N) > 0', new Map([['N', 1]]))).toBe(false);
  });

  it('resolves widths: constant, symbolic and unknown', () => {
    const names = new Set(['NUM_OF_INPUT', 'X']);
    expect(resolveTclWidth('clog2(8)', names)).toBe(3);
    expect(resolveTclWidth('clog2(NUM_OF_INPUT)', names)).toBe('clog2(NUM_OF_INPUT)');
    expect(resolveTclWidth('clog2(X  +  1)', names)).toBe('clog2(X + 1)');
    expect(resolveTclWidth('clog2(UNKNOWN)', names)).toBeUndefined();
  });
});

describe('log2ceilToClog2', () => {
  it.each([
    ['SYMBOLS_PER_BEAT', 'clog2(SYMBOLS_PER_BEAT)'],
    ['[get_parameter_value "inSymbolsPerBeat" ]', 'clog2(inSymbolsPerBeat)'],
    ['[expr {X + 1}]', 'clog2(X + 1)'],
    ['"P"', 'clog2(P)'],
    ['"8"', 'clog2(8)'],
    ['[get_parameter_value "P"]', 'clog2(P)'],
  ])('rewrites %s', (arg, expected) => {
    expect(log2ceilToClog2(arg)).toBe(expected);
  });

  it('returns null when Tcl syntax remains', () => {
    expect(log2ceilToClog2('$unknown')).toBeNull();
    expect(log2ceilToClog2('[some_proc 3]')).toBeNull();
    expect(log2ceilToClog2('"a" "b"')).toBeNull();
  });
});
