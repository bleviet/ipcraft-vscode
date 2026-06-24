import {
  parse,
  serialize,
  containsParamRef,
  containsCall,
  widthExprUsesMathReal,
  normalizeFunctionNames,
  IPXACT_UNSUPPORTED,
  type WidthExprNode,
} from '../../../shared/widthExprAst';

function ast(expr: string): WidthExprNode {
  const node = parse(expr);
  if (!node) {
    throw new Error(`failed to parse: ${expr}`);
  }
  return node;
}

describe('widthExprAst.parse', () => {
  it('parses a bare parameter into a ParamRef', () => {
    expect(parse('DATA_W')).toEqual({ type: 'ParamRef', name: 'DATA_W' });
  });

  it('parses a function call, canonicalizing the name to lowercase', () => {
    expect(parse('CLOG2(DEPTH)')).toEqual({
      type: 'Call',
      fn: 'clog2',
      args: [{ type: 'ParamRef', name: 'DEPTH' }],
    });
  });

  it('returns undefined for an unknown function or bad arity', () => {
    expect(parse('frob(8)')).toBeUndefined();
    expect(parse('clog2(1,2)')).toBeUndefined();
    expect(parse('max(8)')).toBeUndefined();
  });

  it('returns undefined for trailing or invalid characters', () => {
    expect(parse('DATA_W &')).toBeUndefined();
    expect(parse('(DATA_W')).toBeUndefined();
  });
});

describe('containsParamRef / containsCall (drives is_parameterized)', () => {
  it('a constant is not parameterized', () => {
    expect(containsParamRef(ast('clog2(8)'))).toBe(false);
    expect(containsParamRef(ast('32'))).toBe(false);
  });

  it('a function of a parameter is parameterized', () => {
    expect(containsParamRef(ast('clog2(DEPTH)'))).toBe(true);
  });

  it('mixed literal and parameter arguments are parameterized', () => {
    expect(containsParamRef(ast('max(8, DATA_W)'))).toBe(true);
  });

  it('detects function calls anywhere in the tree', () => {
    expect(containsCall(ast('clog2(DEPTH)'))).toBe(true);
    expect(containsCall(ast('DATA_W/8'))).toBe(false);
  });
});

describe('widthExprUsesMathReal (drives the VHDL math_real context clause)', () => {
  it('is true for a parameterized clog2/ceil/floor/log2', () => {
    expect(widthExprUsesMathReal('clog2(DEPTH)')).toBe(true);
    expect(widthExprUsesMathReal('ceil(DATA_W/8)')).toBe(true);
  });

  it('is false for a constant function (folds to a literal)', () => {
    expect(widthExprUsesMathReal('clog2(8)')).toBe(false);
  });

  it('is false for plain arithmetic and bare params', () => {
    expect(widthExprUsesMathReal('DATA_W/8')).toBe(false);
    expect(widthExprUsesMathReal('DATA_W')).toBe(false);
  });

  it('is false for abs/min/max (no math_real needed)', () => {
    expect(widthExprUsesMathReal('max(A,B)')).toBe(false);
  });
});

describe('serialize — constant folding', () => {
  it('folds a constant expression to a literal in every dialect', () => {
    for (const dialect of ['systemverilog', 'vhdl', 'tcl', 'ipxact'] as const) {
      expect(serialize(ast('clog2(8)'), dialect).code).toBe('3');
      expect(serialize(ast('clog2(8)'), dialect).usedFunction).toBe(false);
    }
  });
});

describe('serialize — SystemVerilog', () => {
  it('expands clog2 to the $clog2 built-in', () => {
    expect(serialize(ast('clog2(DEPTH)'), 'systemverilog').code).toBe('$clog2(DEPTH)');
  });

  it('preserves bare params and arithmetic', () => {
    expect(serialize(ast('XCVR_DW'), 'systemverilog').code).toBe('XCVR_DW');
    expect(serialize(ast('DATA_W/8'), 'systemverilog').code).toBe('DATA_W/8');
  });
});

describe('serialize — VHDL', () => {
  it('expands clog2 via math_real', () => {
    expect(serialize(ast('clog2(DEPTH)'), 'vhdl').code).toBe('integer(ceil(log2(real(DEPTH))))');
  });

  it('expands ceil and floor', () => {
    expect(serialize(ast('ceil(DATA_W/8)'), 'vhdl').code).toBe('integer(ceil(real(DATA_W/8)))');
    expect(serialize(ast('floor(DATA_W/8)'), 'vhdl').code).toBe('integer(floor(real(DATA_W/8)))');
  });

  it('uses minimum/maximum for min/max', () => {
    expect(serialize(ast('max(A,B)'), 'vhdl').code).toBe('maximum(A, B)');
    expect(serialize(ast('min(A,B)'), 'vhdl').code).toBe('minimum(A, B)');
  });
});

describe('serialize — Tcl', () => {
  it('expands clog2 using natural-log identity', () => {
    expect(serialize(ast('clog2(DEPTH)'), 'tcl').code).toBe('int(ceil(log(DEPTH)/log(2)))');
  });

  it('renders parameter references via the supplied formatter', () => {
    const result = serialize(ast('clog2(DEPTH)'), 'tcl', {
      paramRef: (name) => `[get_parameter_value ${name.toUpperCase()}]`,
    });
    expect(result.code).toBe('int(ceil(log([get_parameter_value DEPTH])/log(2)))');
  });
});

describe('serialize — IP-XACT (XPATH)', () => {
  it('maps clog2 to ceiling(log(2, x)) with param decode', () => {
    const result = serialize(ast('clog2(DEPTH)'), 'ipxact', {
      paramRef: (name) => `spirit:decode(id('PARAM_VALUE.${name}'))`,
    });
    expect(result.code).toBe("ceiling(log(2, spirit:decode(id('PARAM_VALUE.DEPTH'))))");
  });

  it('returns the unsupported sentinel for max/min', () => {
    expect(serialize(ast('max(A,B)'), 'ipxact').code).toBe(IPXACT_UNSUPPORTED);
    expect(serialize(ast('min(A,B)'), 'ipxact').code).toBe(IPXACT_UNSUPPORTED);
  });
});

describe('normalizeFunctionNames', () => {
  it('lowercases recognized function tokens only', () => {
    expect(normalizeFunctionNames('CLOG2(DEPTH)')).toBe('clog2(DEPTH)');
    expect(normalizeFunctionNames('Ceil(DATA_W/8)')).toBe('ceil(DATA_W/8)');
  });

  it('leaves parameter names and unknown identifiers untouched', () => {
    expect(normalizeFunctionNames('DATA_W/8')).toBe('DATA_W/8');
    expect(normalizeFunctionNames('Custom_Fn(8)')).toBe('Custom_Fn(8)');
  });
});
