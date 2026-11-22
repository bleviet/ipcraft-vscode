import {
  addressingResolver,
  resolveWordAddressing,
} from '../../../../generator/resolvers/addressing';
import { normalizeIpCoreData } from '../../../../generator/registerProcessor';
import { BUS_REGISTRY } from '../../../../generator/buses/builtin';
import type { ResolverInput } from '../../../../generator/resolvers/types';
import { normalizeBusLibrary } from '../../../../shared/busContracts';
import { builtinBusLibrary } from '../../../helpers/busLibrary';

function makeInput(
  raw: Record<string, unknown>,
  registers: Record<string, unknown>[] = [],
  busDefinitions: ResolverInput['busDefinitions'] = {},
  busLibrary: ResolverInput['busLibrary'] = normalizeBusLibrary([])
): ResolverInput {
  return {
    ipCore: normalizeIpCoreData(raw),
    registers,
    busDefinitions,
    busLibrary,
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
          busInterfaces: [{ name: 'S_AXI', type: 'ipcraft:busif:axi4_lite:1.0', mode: 'slave' }],
        },
        [],
        { AXI4_LITE: { ports: [{ name: 'WDATA', width: 32 }] } }
      )
    );
    expect(result.data_width).toBe(32);
    expect(result.reg_width).toBe(4);
  });

  it('uses the effective root width override for a memory-mapped consumer', () => {
    const result = addressingResolver.resolve(
      makeInput(
        {
          busInterfaces: [
            {
              name: 'S_AXI',
              type: 'AXI4L',
              mode: 'slave',
              portWidthOverrides: { WDATA: 64, RDATA: 64 },
            },
          ],
        },
        [{ offset: 0 }],
        {},
        builtinBusLibrary()
      )
    );

    expect(result.data_width).toBe(64);
    expect(result.reg_width).toBe(8);
    expect(result.addr_map_size).toBe(8);
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

describe('resolveWordAddressing', () => {
  const port = (width: number) => [{ logical_name: 'address', width }];
  const resolve = (busPorts: Record<string, unknown>[], addrWidth: number, regWidth: number) =>
    resolveWordAddressing({ busPorts, expandedBusInterfaces: [], addrWidth, regWidth });

  it('is word-addressed with the byte-lane shift when the port is narrower than addr_width', () => {
    expect(resolve(port(2), 3, 4)).toMatchObject({
      address_word_addressed: true,
      address_shift: 2,
    });
    expect(resolve(port(1), 3, 4)).toMatchObject({
      address_word_addressed: true,
      address_shift: 2,
    });
    expect(resolve(port(2), 4, 4)).toMatchObject({
      address_word_addressed: true,
      address_shift: 2,
    });
    expect(resolve(port(5), 8, 8)).toMatchObject({
      address_word_addressed: true,
      address_shift: 3,
    });
  });

  it('is byte-addressed (shift 0) for a full-width address port', () => {
    expect(resolve(port(32), 3, 4)).toMatchObject({
      address_word_addressed: false,
      address_shift: 0,
    });
    expect(resolve(port(3), 3, 4)).toMatchObject({
      address_word_addressed: false,
      address_shift: 0,
    });
  });

  it('is byte-addressed without an address port (AXI names its ports AWADDR/ARADDR)', () => {
    expect(resolve([], 3, 4)).toMatchObject({ address_word_addressed: false, address_shift: 0 });
    expect(resolve([{ logical_name: 'AWADDR', width: 2 }], 3, 4)).toMatchObject({
      address_word_addressed: false,
      address_shift: 0,
    });
  });

  it('flags every expanded interface by its own address port', () => {
    const result = resolveWordAddressing({
      busPorts: port(32),
      expandedBusInterfaces: [
        { name: 'S_WORD', ports: port(2) },
        { name: 'S_BYTE', ports: port(32) },
        { name: 'S_NONE', ports: [] },
      ],
      addrWidth: 4,
      regWidth: 4,
    });
    expect(result.expanded_bus_interfaces.map((i) => i.address_word_addressed)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.expanded_bus_interfaces[0].name).toBe('S_WORD');
  });
});
