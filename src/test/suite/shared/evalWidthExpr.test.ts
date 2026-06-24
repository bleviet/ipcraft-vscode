import { evalWidthExpr } from '../../../webview/shared/utils/evalWidthExpr';

describe('evalWidthExpr (webview, no new Function)', () => {
  it('resolves a plain integer string', () => {
    expect(evalWidthExpr('32', {})).toBe(32);
  });

  it('resolves a single param name', () => {
    expect(evalWidthExpr('DATA_W', { DATA_W: 32 })).toBe(32);
  });

  it('resolves param used in division', () => {
    expect(evalWidthExpr('DATA_W/8', { DATA_W: 64 })).toBe(8);
  });

  it('resolves param used in multiplication', () => {
    expect(evalWidthExpr('DATA_W*2', { DATA_W: 16 })).toBe(32);
  });

  it('resolves compound expression with parentheses', () => {
    expect(evalWidthExpr('(DATA_W+8)/2', { DATA_W: 24 })).toBe(16);
  });

  it('returns undefined for an unresolvable identifier', () => {
    expect(evalWidthExpr('UNKNOWN/8', {})).toBeUndefined();
  });

  it('returns undefined when substitution leaves a non-numeric identifier', () => {
    expect(evalWidthExpr('DATA_W + MISSING', { DATA_W: 32 })).toBeUndefined();
  });

  it('truncates non-integer results', () => {
    expect(evalWidthExpr('DATA_W/3', { DATA_W: 10 })).toBe(3);
  });

  it('prefers longer param name to avoid partial-name collisions', () => {
    const m: Record<string, number> = { AxiDataWidth_g: 64, DataWidth: 8 };
    expect(evalWidthExpr('AxiDataWidth_g/8', m)).toBe(8);
  });

  it('handles multiple params in one expression', () => {
    expect(evalWidthExpr('A+B', { A: 10, B: 22 })).toBe(32);
  });

  it('handles subtraction', () => {
    expect(evalWidthExpr('DATA_W-8', { DATA_W: 40 })).toBe(32);
  });

  it('handles unary minus', () => {
    expect(evalWidthExpr('-(-32)', {})).toBe(32);
  });

  describe('predefined functions', () => {
    it('clog2 returns ceiling of log2', () => {
      expect(evalWidthExpr('clog2(8)', {})).toBe(3);
      expect(evalWidthExpr('clog2(1024)', {})).toBe(10);
      expect(evalWidthExpr('clog2(256)', {})).toBe(8);
    });

    it('clog2(1) is 0 (matches SystemVerilog $clog2)', () => {
      expect(evalWidthExpr('clog2(1)', {})).toBe(0);
    });

    it('clog2(0) is undefined (surfaces the error rather than a 0-bit port)', () => {
      expect(evalWidthExpr('clog2(0)', {})).toBeUndefined();
    });

    it('clog2 of a parameter resolves with defaults', () => {
      expect(evalWidthExpr('clog2(FIFO_DEPTH)', { FIFO_DEPTH: 1024 })).toBe(10);
      expect(evalWidthExpr('clog2(NUM_CHANNELS)', { NUM_CHANNELS: 4 })).toBe(2);
    });

    it('log2 returns floor of log2', () => {
      expect(evalWidthExpr('log2(8)', {})).toBe(3);
      expect(evalWidthExpr('log2(9)', {})).toBe(3);
    });

    it('ceil rounds up a division', () => {
      expect(evalWidthExpr('ceil(DATA_W/8)', { DATA_W: 33 })).toBe(5);
      expect(evalWidthExpr('ceil(DATA_W/8)', { DATA_W: 32 })).toBe(4);
    });

    it('floor rounds down', () => {
      expect(evalWidthExpr('floor(DATA_W/8)', { DATA_W: 33 })).toBe(4);
    });

    it('abs returns absolute value', () => {
      expect(evalWidthExpr('abs(0-7)', {})).toBe(7);
    });

    it('max and min take two scalar arguments', () => {
      expect(evalWidthExpr('max(A,B)', { A: 8, B: 16 })).toBe(16);
      expect(evalWidthExpr('min(A,B)', { A: 8, B: 16 })).toBe(8);
    });

    it('supports nested function calls', () => {
      expect(evalWidthExpr('clog2(max(A,B))', { A: 100, B: 200 })).toBe(8);
    });

    it('matches function names case-insensitively', () => {
      expect(evalWidthExpr('CLOG2(8)', {})).toBe(3);
      expect(evalWidthExpr('Ceil(DATA_W/8)', { DATA_W: 33 })).toBe(5);
    });

    it('returns undefined for an unknown function', () => {
      expect(evalWidthExpr('frobnicate(8)', {})).toBeUndefined();
    });

    it('returns undefined for wrong arity', () => {
      expect(evalWidthExpr('clog2(1, 2)', {})).toBeUndefined();
      expect(evalWidthExpr('max(8)', {})).toBeUndefined();
    });
  });
});
