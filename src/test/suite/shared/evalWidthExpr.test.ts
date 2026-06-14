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
});
