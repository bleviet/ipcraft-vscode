import { buildBoundaryTransforms } from '../../../../generator/resolvers/boundaryTransforms';
import type { ProjectedBusPort } from '../../../../generator/types';

function projectedPort(
  overrides: Partial<ProjectedBusPort> & Pick<ProjectedBusPort, 'name' | 'direction'>
): ProjectedBusPort {
  const { name, direction, ...rest } = overrides;
  const width = overrides.width ?? 1;
  return {
    canonicalName: name,
    name,
    interfaceRole: name,
    physicalSuffix: name,
    direction,
    svDirection: direction === 'in' ? 'input' : 'output',
    type: width === 1 ? 'std_logic' : `std_logic_vector(${Number(width) - 1} downto 0)`,
    svType: width === 1 ? 'logic' : `logic [${Number(width) - 1}:0]`,
    width,
    widthExpr: null,
    isParameterized: false,
    tclWidth: String(width),
    endianness: 'little',
    needsSwap: false,
    needsPolarityInversion: false,
    ...rest,
  };
}

describe('buildBoundaryTransforms', () => {
  it.each([
    ['input', 'in' as const],
    ['output', 'out' as const],
  ])('plans scalar %s inversion at the external boundary', (_label, direction) => {
    const result = buildBoundaryTransforms(
      [
        projectedPort({
          name: `ready_${direction}_n`,
          direction,
          effectivePolarity: 'activeLow',
          needsPolarityInversion: true,
        }),
      ],
      new Set()
    );

    expect(result.ports).toEqual([
      {
        name: `ready_${direction}_n`,
        internalName: `ready_${direction}_n_inv`,
        direction,
        type: 'std_logic',
        svType: 'logic',
        width: 1,
        widthExpr: null,
        isParameterized: false,
        invert: true,
      },
    ]);
    expect([...result.internalNames]).toEqual([`ready_${direction}_n_inv`]);
  });

  it('preserves vector types so templates apply bitwise inversion to every bit', () => {
    const result = buildBoundaryTransforms(
      [
        projectedPort({
          name: 'status_n',
          direction: 'out',
          type: 'std_logic_vector(3 downto 0)',
          svType: 'logic [3:0]',
          width: 4,
          swapKind: 'bit',
          laneWidth: 1,
          laneKind: 'byte',
          needsPolarityInversion: true,
        }),
      ],
      new Set()
    );

    expect(result.ports[0]).toEqual(
      expect.objectContaining({
        internalName: 'status_n_inv',
        type: 'std_logic_vector(3 downto 0)',
        svType: 'logic [3:0]',
        width: 4,
        invert: true,
      })
    );
    expect(result.ports[0]).not.toHaveProperty('swapKind');
    expect(result.ports[0]).not.toHaveProperty('laneWidth');
    expect(result.ports[0]).not.toHaveProperty('laneKind');
  });

  it('preserves parameterized width metadata for inversion', () => {
    const result = buildBoundaryTransforms(
      [
        projectedPort({
          name: 'qualifier_n',
          direction: 'in',
          type: 'std_logic_vector(DATA_WIDTH - 1 downto 0)',
          svType: 'logic [DATA_WIDTH - 1:0]',
          width: 32,
          widthExpr: 'DATA_WIDTH',
          isParameterized: true,
          needsPolarityInversion: true,
        }),
      ],
      new Set()
    );

    expect(result.ports[0]).toEqual(
      expect.objectContaining({
        width: 32,
        widthExpr: 'DATA_WIDTH',
        isParameterized: true,
        invert: true,
      })
    );
  });

  it('resolves preferred internal-name collisions deterministically and case-insensitively', () => {
    const result = buildBoundaryTransforms(
      [
        projectedPort({
          name: 'valid_n',
          direction: 'in',
          needsPolarityInversion: true,
        }),
      ],
      new Set(['VALID_N_INV', 'valid_n_inv_2'])
    );

    expect(result.ports[0].internalName).toBe('valid_n_inv_3');
    expect([...result.internalNames]).toEqual(['valid_n_inv_3']);
  });

  it('plans endian swap without inversion using the existing _be name', () => {
    const result = buildBoundaryTransforms(
      [
        projectedPort({
          name: 'payload',
          direction: 'in',
          width: 32,
          type: 'std_logic_vector(31 downto 0)',
          svType: 'logic [31:0]',
          needsSwap: true,
          swapKind: 'lane',
          laneWidth: 8,
          laneKind: 'byte',
        }),
      ],
      new Set()
    );

    expect(result.ports).toEqual([
      expect.objectContaining({
        name: 'payload',
        internalName: 'payload_be',
        invert: false,
        swapKind: 'lane',
        laneWidth: 8,
        laneKind: 'byte',
      }),
    ]);
  });

  it('composes swap and inversion through exactly one _be intermediate', () => {
    const result = buildBoundaryTransforms(
      [
        projectedPort({
          name: 'byteenable_n',
          direction: 'out',
          width: 4,
          type: 'std_logic_vector(3 downto 0)',
          svType: 'logic [3:0]',
          needsSwap: true,
          swapKind: 'bit',
          laneWidth: 1,
          laneKind: 'byte',
          needsPolarityInversion: true,
        }),
        projectedPort({ name: 'plain', direction: 'in' }),
      ],
      new Set()
    );

    expect(result.ports).toHaveLength(1);
    expect(result.ports[0]).toEqual(
      expect.objectContaining({
        name: 'byteenable_n',
        internalName: 'byteenable_n_be',
        invert: true,
        swapKind: 'bit',
      })
    );
    expect([...result.internalNames]).toEqual(['byteenable_n_be']);
  });
});
