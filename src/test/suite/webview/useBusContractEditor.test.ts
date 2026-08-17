import { act, renderHook } from '@testing-library/react';
import { resolveBusInterface } from '../../../shared/busContracts';
import {
  buildBusContractEditModel,
  buildRootWidthMutations,
  useBusContractEditor,
} from '../../../webview/ipcore/hooks/useBusContractEditor';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import type { BusInterface } from '../../../domain/ipcore.types';
import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import { normalizeBusLibrary } from '../../../shared/busContracts';

describe('bus contract editor model', () => {
  const resolution = resolveBusInterface({
    busInterface: {
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      useOptionalPorts: ['TKEEP', 'TSTRB'],
      portWidthOverrides: { TDATA: 64, TKEEP: 8, TSTRB: 8 },
    },
    busIndex: 0,
    parameters: [],
    library: builtinBusLibrary(),
  });

  it('exposes root widths separately from read-only derived widths', () => {
    const model = buildBusContractEditModel(0, resolution);
    expect(model.rootWidths).toContainEqual(expect.objectContaining({ name: 'TDATA', value: 64 }));
    expect(model.derivedWidths).toContainEqual({
      name: 'TKEEP',
      formula: 'TDATA / 8',
      resolvedValue: 8,
      state: 'concrete',
    });
  });

  it('preserves a parameter expression in an editable root-width field', () => {
    const parameterized = resolveBusInterface({
      busInterface: {
        name: 'stream',
        type: 'AXIS',
        mode: 'master',
        portWidthOverrides: { TDATA: 'DATA_WIDTH' },
      },
      busIndex: 0,
      parameters: [{ name: 'DATA_WIDTH', dataType: 'integer' }],
      library: builtinBusLibrary(),
    });

    expect(buildBusContractEditModel(0, parameterized).rootWidths).toContainEqual(
      expect.objectContaining({ name: 'TDATA', value: 'DATA_WIDTH' })
    );
  });

  it('clears affected explicit derived overrides atomically on a root edit', () => {
    expect(buildRootWidthMutations(0, 'TDATA', 64, resolution)).toEqual([
      [['busInterfaces', 0, 'portWidthOverrides', 'TDATA'], 64],
      [['busInterfaces', 0, 'portWidthOverrides', 'TSTRB'], undefined],
      [['busInterfaces', 0, 'portWidthOverrides', 'TKEEP'], undefined],
    ]);
  });

  it('does not create cleanup mutations merely by loading matching overrides', () => {
    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.portWidths.TKEEP.value).toBe(8);
  });

  it('derives configurable polarity fields from contract metadata for active and inactive ports', () => {
    const polarityResolution = resolveBusInterface({
      busInterface: {
        name: 'control',
        type: 'AVMM',
        mode: 'master',
        useOptionalPorts: ['read'],
        portPolarityOverrides: { write: 'activeLow' },
      },
      busIndex: 0,
      parameters: [],
      library: builtinBusLibrary(),
    });

    const fields = buildBusContractEditModel(0, polarityResolution).polarities;

    expect(fields).toEqual(
      expect.arrayContaining([
        {
          name: 'read',
          value: 'default',
          defaultValue: 'activeHigh',
          active: true,
          error: undefined,
        },
        {
          name: 'write',
          value: 'activeLow',
          defaultValue: 'activeHigh',
          active: false,
          error: undefined,
        },
      ])
    );
    expect(fields.some((field) => field.name === 'address')).toBe(false);
  });

  it('distinguishes an explicit default-equal override from inherited contract default', () => {
    const explicitDefault = resolveBusInterface({
      busInterface: {
        name: 'control',
        type: 'AVMM',
        mode: 'master',
        portPolarityOverrides: { read: 'activeHigh' },
      },
      busIndex: 0,
      parameters: [],
      library: builtinBusLibrary(),
    });

    expect(
      buildBusContractEditModel(0, explicitDefault).polarities.find(
        (field) => field.name === 'read'
      )
    ).toMatchObject({
      value: 'activeHigh',
      defaultValue: 'activeHigh',
    });
  });

  it('represents inheritance independently for a contract whose default is active low', () => {
    const definitions: BusDefinitionFile = {
      ACTIVE_LOW_DEFAULT: {
        busType: { vendor: 'acme', library: 'busif', name: 'low_default', version: '1.0' },
        contract: {
          version: 1,
          interfaceKind: 'streaming',
          modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
          interfaceProperties: {},
          constraints: [],
        },
        ports: [
          {
            name: 'request',
            width: 1,
            direction: 'out',
            presence: 'required',
            role: 'control',
            widthPolicy: 'fixed',
            polarity: {
              default: 'activeLow',
              roles: { activeHigh: 'request', activeLow: 'request_n' },
            },
          },
        ],
      },
    };
    const library = normalizeBusLibrary([
      { sourceFile: '/workspace/low-default.yml', sourceKind: 'workspace', definitions },
    ]);
    const inherited = resolveBusInterface({
      busInterface: {
        name: 'control',
        type: 'acme:busif:low_default:1.0',
        mode: 'source',
      },
      busIndex: 0,
      parameters: [],
      library,
    });
    const explicit = resolveBusInterface({
      busInterface: {
        name: 'control',
        type: 'acme:busif:low_default:1.0',
        mode: 'source',
        portPolarityOverrides: { request: 'activeLow' },
      },
      busIndex: 0,
      parameters: [],
      library,
    });

    expect(buildBusContractEditModel(0, inherited).polarities[0]).toMatchObject({
      value: 'default',
      defaultValue: 'activeLow',
    });
    expect(inherited.activePorts[0].effectivePolarity).toBe('activeLow');
    expect(buildBusContractEditModel(0, explicit).polarities[0]).toMatchObject({
      value: 'activeLow',
      defaultValue: 'activeLow',
    });
  });

  it('writes explicit polarity choices and removes the empty map through Default', () => {
    const batchUpdate = jest.fn();
    const bus: BusInterface = {
      name: 'control',
      type: 'AVMM',
      mode: 'master',
      useOptionalPorts: ['read'],
    };
    const { result, rerender } = renderHook(
      ({ currentBus }) =>
        useBusContractEditor({
          bus: currentBus,
          busIndex: 1,
          parameters: [],
          busLibrary: builtinBusLibrary(),
          batchUpdate,
        }),
      { initialProps: { currentBus: bus } }
    );

    act(() => result.current.updatePolarity('read', 'activeLow'));
    expect(batchUpdate).toHaveBeenLastCalledWith([
      [['busInterfaces', 1, 'portPolarityOverrides'], { read: 'activeLow' }],
    ]);

    // 'read' defaults to activeHigh, so choosing it explicitly is the contract
    // default and must not leave a redundant override entry behind.
    act(() => result.current.updatePolarity('read', 'activeHigh'));
    expect(batchUpdate).toHaveBeenLastCalledWith([
      [['busInterfaces', 1, 'portPolarityOverrides'], undefined],
    ]);

    rerender({
      currentBus: {
        ...bus,
        portPolarityOverrides: { read: 'activeLow' as const },
      },
    });
    act(() => result.current.updatePolarity('read', 'default'));
    expect(batchUpdate).toHaveBeenLastCalledWith([
      [['busInterfaces', 1, 'portPolarityOverrides'], undefined],
    ]);
  });

  it('removes every matching case variant while preserving unrelated overrides', () => {
    const batchUpdate = jest.fn();
    const bus: BusInterface = {
      name: 'control',
      type: 'AVMM',
      mode: 'master',
      portPolarityOverrides: {
        READ: 'activeHigh',
        write: 'activeLow',
        read: 'activeLow',
      },
    };
    const { result } = renderHook(() =>
      useBusContractEditor({
        bus,
        busIndex: 0,
        parameters: [],
        busLibrary: builtinBusLibrary(),
        batchUpdate,
      })
    );

    act(() => result.current.updatePolarity('read', 'default'));

    expect(batchUpdate).toHaveBeenCalledWith([
      [['busInterfaces', 0, 'portPolarityOverrides'], { write: 'activeLow' }],
    ]);
  });

  it('drops a redundant override when the contract default is chosen explicitly', () => {
    const batchUpdate = jest.fn();
    const bus: BusInterface = {
      name: 'control',
      type: 'AVMM',
      mode: 'master',
      portPolarityOverrides: { read: 'activeLow', write: 'activeLow' },
    };
    const { result } = renderHook(() =>
      useBusContractEditor({
        bus,
        busIndex: 0,
        parameters: [],
        busLibrary: builtinBusLibrary(),
        batchUpdate,
      })
    );

    act(() => result.current.updatePolarity('read', 'activeHigh'));

    expect(batchUpdate).toHaveBeenCalledWith([
      [['busInterfaces', 0, 'portPolarityOverrides'], { write: 'activeLow' }],
    ]);
  });
});
