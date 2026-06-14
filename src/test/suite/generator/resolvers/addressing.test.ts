import { addressingResolver } from '../../../../generator/resolvers/addressing';
import { normalizeIpCoreData } from '../../../../generator/registerProcessor';
import { BUS_REGISTRY } from '../../../../generator/buses/builtin';
import type { ResolverInput } from '../../../../generator/resolvers/types';

function makeInput(
  raw: Record<string, unknown>,
  registers: Record<string, unknown>[] = [],
  busDefinitions: ResolverInput['busDefinitions'] = {}
): ResolverInput {
  return {
    ipCore: normalizeIpCoreData(raw),
    registers,
    busDefinitions,
    registry: BUS_REGISTRY,
  };
}

describe('addressingResolver', () => {
  it('defaults to data_width=32, reg_width=4 with no bus definitions', () => {
    const result = addressingResolver.resolve(makeInput({}));
    expect(result.data_width).toBe(32);
    expect(result.reg_width).toBe(4);
  });

  it('derives data_width from WDATA port in bus definition', () => {
    const result = addressingResolver.resolve(
      makeInput(
        {
          busInterfaces: [{ name: 'S_AXI', type: 'ipcraft.busif.axi4_lite.1.0', mode: 'slave' }],
        },
        [],
        { AXI4_LITE: { ports: [{ name: 'WDATA', width: 32 }] } }
      )
    );
    expect(result.data_width).toBe(32);
    expect(result.reg_width).toBe(4);
  });

  it('computes addr_width from number of registers', () => {
    // 18 registers × 4 bytes = 72 bytes → ceil(log2(72)) = 7
    const registers = Array.from({ length: 18 }, (_, i) => ({ offset: i * 4 }));
    const result = addressingResolver.resolve(makeInput({}, registers));
    expect(result.addr_width).toBe(7);
  });

  it('minimum addr_width is 3', () => {
    const result = addressingResolver.resolve(makeInput({}));
    expect(result.addr_width).toBeGreaterThanOrEqual(3);
  });

  it('respects addrWidth override from IP core YAML', () => {
    const result = addressingResolver.resolve(makeInput({ addrWidth: 12 }));
    expect(result.addr_width).toBe(12);
  });
});
