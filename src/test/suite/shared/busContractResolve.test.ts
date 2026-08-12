import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import type { BusInterface, Parameter } from '../../../domain/ipcore.types';
import { blocksGeneration, checkBusConformance } from '../../../shared/busConformance';
import { normalizeBusLibrary, resolveBusInterface } from '../../../shared/busContracts';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const library = builtinBusLibrary();

function resolve(
  busInterface: Partial<BusInterface> & Pick<BusInterface, 'name' | 'type' | 'mode'>,
  parameters: Parameter[] = []
) {
  return resolveBusInterface({
    busInterface,
    busIndex: 0,
    parameters,
    library,
  });
}

describe('resolveBusInterface width states', () => {
  it('resolves a positive integer width as concrete', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      portWidthOverrides: { TDATA: 64 },
    });

    expect(result.portWidths.TDATA).toMatchObject({ state: 'concrete', value: 64 });
  });

  it('retains an unresolved but structurally valid declared parameter as symbolic', () => {
    const result = resolve(
      {
        name: 'stream',
        type: 'AXIS',
        mode: 'master',
        useOptionalPorts: ['TKEEP'],
        portWidthOverrides: { TDATA: 'DATA_WIDTH', TKEEP: 'DATA_WIDTH / 8' },
      },
      [{ name: 'DATA_WIDTH', dataType: 'integer' }]
    );

    expect(result.portWidths.TDATA.state).toBe('symbolic');
    expect(result.portWidths.TKEEP.state).toBe('symbolic');
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'BUS_DERIVED_WIDTH_OVERRIDE' })
    );
  });

  it('reports an expression referencing an undeclared parameter as unresolved', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      portWidthOverrides: { TDATA: 'MISSING_WIDTH' },
    });

    expect(result.portWidths.TDATA).toMatchObject({ state: 'unresolved' });
  });

  it.each(['DATA_WIDTH +', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'reports illegal width %p as invalid',
    (width) => {
      const result = resolve({
        name: 'stream',
        type: 'AXIS',
        mode: 'master',
        portWidthOverrides: { TDATA: width },
      });

      expect(result.portWidths.TDATA.state).toBe('invalid');
    }
  );
});

describe('resolveBusInterface policies and properties', () => {
  it('accepts a compatible derived override and rejects an incompatible one', () => {
    const compatible = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      useOptionalPorts: ['TKEEP'],
      portWidthOverrides: { TDATA: 64, TKEEP: 8 },
    });
    const incompatible = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      useOptionalPorts: ['TKEEP'],
      portWidthOverrides: { TDATA: 64, TKEEP: 4 },
    });

    expect(compatible.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'BUS_DERIVED_WIDTH_OVERRIDE' })
    );
    expect(incompatible.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DERIVED_WIDTH_OVERRIDE',
        state: 'invalid',
        suggestedValue: 8,
      })
    );
  });

  it('rejects an incompatible fixed override', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      portWidthOverrides: { TVALID: 2 },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_FIXED_WIDTH_OVERRIDE',
        path: ['busInterfaces', 0, 'portWidthOverrides', 'TVALID'],
        suggestedValue: 1,
      })
    );
  });

  it('rejects unknown properties only for a recognized contract', () => {
    const known = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      interfaceProperties: { unknownProperty: 1 },
    });
    const unknown = resolve({
      name: 'custom',
      type: 'user:busif:custom:1.0',
      mode: 'source',
      interfaceProperties: { unknownProperty: 1 },
    });

    expect(known.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_UNKNOWN_INTERFACE_PROPERTY',
        path: ['busInterfaces', 0, 'interfaceProperties', 'unknownProperty'],
      })
    );
    expect(unknown.diagnostics).toEqual([]);
  });

  it('rejects an authored interface property whose type violates its contract', () => {
    const definitions: BusDefinitionFile = {
      CUSTOM: {
        busType: { vendor: 'acme', library: 'busif', name: 'custom', version: '1.0' },
        contract: {
          version: 1,
          interfaceKind: 'streaming',
          modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
          interfaceProperties: { lanes: { type: 'integer', minimum: 1 } },
          constraints: [],
        },
        ports: [
          {
            name: 'data',
            width: 8,
            direction: 'out',
            presence: 'required',
            role: 'data',
            widthPolicy: 'root',
          },
        ],
      },
    };
    const customLibrary = normalizeBusLibrary([
      { sourceFile: '/workspace/custom.yml', sourceKind: 'workspace', definitions },
    ]);
    const busInterface = {
      name: 'stream',
      type: 'acme:busif:custom:1.0',
      mode: 'source',
      interfaceProperties: { lanes: true },
    } as unknown as BusInterface;

    const result = resolveBusInterface({
      busInterface,
      busIndex: 0,
      parameters: [],
      library: customLibrary,
    });
    const report = checkBusConformance({ busInterfaces: [busInterface] }, customLibrary);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_INTERFACE_PROPERTY_VALUE',
        state: 'invalid',
        path: ['busInterfaces', 0, 'interfaceProperties', 'lanes'],
      })
    );
    expect(report.hasKnownErrors).toBe(true);
    expect(blocksGeneration(report)).toBe(true);
  });

  it('blocks generation when an authored interface property remains symbolic', () => {
    const definitions: BusDefinitionFile = {
      CUSTOM: {
        busType: { vendor: 'acme', library: 'busif', name: 'custom', version: '1.0' },
        contract: {
          version: 1,
          interfaceKind: 'streaming',
          modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
          interfaceProperties: { lanes: { type: 'integer', minimum: 1 } },
          constraints: [],
        },
        ports: [
          {
            name: 'data',
            width: 8,
            direction: 'out',
            presence: 'required',
            role: 'data',
            widthPolicy: 'root',
          },
        ],
      },
    };
    const customLibrary = normalizeBusLibrary([
      { sourceFile: '/workspace/custom.yml', sourceKind: 'workspace', definitions },
    ]);
    const busInterface = {
      name: 'stream',
      type: 'acme:busif:custom:1.0',
      mode: 'source',
      interfaceProperties: { lanes: 'LANES' },
    } as BusInterface;
    const parameters = [{ name: 'LANES', dataType: 'integer' }] as Parameter[];

    const result = resolveBusInterface({
      busInterface,
      busIndex: 0,
      parameters,
      library: customLibrary,
    });
    const report = checkBusConformance(
      { busInterfaces: [busInterface], parameters },
      customLibrary
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_INTERFACE_PROPERTY_VALUE',
        state: 'symbolic',
        path: ['busInterfaces', 0, 'interfaceProperties', 'lanes'],
      })
    );
    expect(report.hasUnresolved).toBe(true);
    expect(blocksGeneration(report)).toBe(true);
  });

  it('normalizes Avalon-ST legacy modes before reversing directions', () => {
    const result = resolve({ name: 'stream', type: 'AVST', mode: 'slave' });
    const data = result.activePorts.find((port) => port.name === 'data');

    expect(result.normalizedMode).toBe('sink');
    expect(data?.effectiveDirection).toBe('in');
  });

  it('leaves an unknown VLNV unmatched without a protocol error', () => {
    const result = resolve({ name: 'custom', type: 'user:busif:custom:1.0', mode: 'master' });

    expect(result.match).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it('derives Avalon-ST legacy symbol and channel properties', () => {
    const result = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      useOptionalPorts: ['channel'],
      portWidthOverrides: { data: 32, channel: 3 },
    });

    expect(result.properties.dataBitsPerSymbol).toMatchObject({ state: 'concrete', value: 8 });
    expect(result.properties.symbolsPerBeat).toMatchObject({ state: 'concrete', value: 4 });
    expect(result.properties.maxChannel).toMatchObject({ state: 'concrete', value: 7 });
  });
});
