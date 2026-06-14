import { clockResetResolver } from '../../../../generator/resolvers/clockReset';
import { normalizeIpCoreData } from '../../../../generator/registerProcessor';
import { BUS_REGISTRY } from '../../../../generator/buses/builtin';
import type { ResolverInput } from '../../../../generator/resolvers/types';

function makeInput(raw: Record<string, unknown>): ResolverInput {
  return {
    ipCore: normalizeIpCoreData(raw),
    registers: [],
    busDefinitions: {},
    registry: BUS_REGISTRY,
  };
}

describe('clockResetResolver', () => {
  it('uses defaults when no clocks/resets defined', () => {
    const result = clockResetResolver.resolve(makeInput({}));
    expect(result.clock_port).toBe('clk');
    expect(result.reset_port).toBe('rst');
    expect(result.reset_active_high).toBe(true);
    expect(result.clocks_with_period).toEqual([]);
  });

  it('picks first clock and reset names', () => {
    const result = clockResetResolver.resolve(
      makeInput({
        clocks: [{ name: 'i_clk', frequency: '100MHz' }],
        resets: [{ name: 'i_rstn', polarity: 'activeLow' }],
      })
    );
    expect(result.clock_port).toBe('i_clk');
    expect(result.reset_port).toBe('i_rstn');
    expect(result.reset_active_high).toBe(false);
  });

  it('computes clock period for MHz', () => {
    const result = clockResetResolver.resolve(
      makeInput({ clocks: [{ name: 'clk', frequency: '100MHz' }] })
    );
    const cws = result.clocks_with_period as Array<{ period_ns: string }>;
    expect(cws[0].period_ns).toBe('10.000');
  });

  it('computes clock period for GHz', () => {
    const result = clockResetResolver.resolve(
      makeInput({ clocks: [{ name: 'clk', frequency: '1GHz' }] })
    );
    const cws = result.clocks_with_period as Array<{ period_ns: string }>;
    expect(cws[0].period_ns).toBe('1.000');
  });

  it('returns null period for unparseable frequency', () => {
    const result = clockResetResolver.resolve(
      makeInput({ clocks: [{ name: 'clk', frequency: 'fast' }] })
    );
    const cws = result.clocks_with_period as Array<{ period_ns: string | null }>;
    expect(cws[0].period_ns).toBeNull();
  });
});
