import { resolveBusInterface } from '../../../shared/busContracts';
import {
  buildBusContractEditModel,
  buildRootWidthMutations,
} from '../../../webview/ipcore/hooks/useBusContractEditor';
import { builtinBusLibrary } from '../../helpers/busLibrary';

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
});
