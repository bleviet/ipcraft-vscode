import {
  blocksGeneration,
  blocksImportWrite,
  checkBusConformance,
} from '../../../shared/busConformance';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { builtinBusLibrary } from '../../helpers/busLibrary';

describe('bus conformance enforcement policy', () => {
  const library = builtinBusLibrary();

  it('blocks known errors at import and generation boundaries', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'stream',
            type: 'AXIS',
            mode: 'master',
            portWidthOverrides: { TDATA: 20 },
          },
        ],
      },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'AXIS_DATA_BYTE_ALIGNED', source: 'protocol' })
    );
    expect(report.hasKnownErrors).toBe(true);
    expect(blocksImportWrite(report)).toBe(true);
    expect(blocksGeneration(report)).toBe(true);
  });

  it('blocks concrete contract failures even when every width resolves numerically', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'memory',
            type: 'AXI4',
            mode: 'slave',
            portWidthOverrides: { WDATA: 48, RDATA: 48 },
          },
        ],
      },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'AXI4_DATA_WIDTH', severity: 'error' })
    );
    expect(report.hasKnownErrors).toBe(true);
    expect(blocksImportWrite(report)).toBe(true);
    expect(blocksGeneration(report)).toBe(true);
  });

  it('allows unresolved imports with a warning but blocks generation', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [{ name: 'custom', type: 'acme:busif:future:1.0', mode: 'master' }],
      },
      library
    );

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'BUS_TYPE_UNRESOLVED',
        severity: 'warning',
        path: ['busInterfaces', 0, 'type'],
      }),
    ]);
    expect(report.hasUnresolved).toBe(true);
    expect(blocksImportWrite(report)).toBe(false);
    expect(blocksGeneration(report)).toBe(true);
  });

  it('treats warnings as reportable but non-blocking', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'stream',
            type: 'AXIS',
            mode: 'master',
            portWidthOverrides: { TDATA: 24 },
          },
        ],
      },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'AXIS_PREFERRED_DATA_WIDTH', severity: 'warning' })
    );
    expect(report.hasKnownErrors).toBe(false);
    expect(report.hasUnresolved).toBe(false);
    expect(blocksImportWrite(report)).toBe(false);
    expect(blocksGeneration(report)).toBe(false);
  });

  it('reports unsupported memory maps on unknown aliases as known errors', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'unknown',
            type: 'futureBus',
            mode: 'slave',
            memoryMapRef: 'regs',
          },
        ],
      },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'BUS_MEMORY_MAP_UNSUPPORTED',
        path: ['busInterfaces', 0, 'memoryMapRef'],
      })
    );
    expect(report.hasKnownErrors).toBe(true);
    expect(report.hasUnresolved).toBe(true);
  });

  it('does not block generation when a conforming default has a non-exhaustive domain', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'stream',
            type: 'AXIS',
            mode: 'master',
            portWidthOverrides: { TDATA: 'BYTES*LANES*8' },
          },
        ],
        parameters: [
          { name: 'BYTES', value: 4, dataType: 'integer', allowedValues: values },
          { name: 'LANES', value: 1, dataType: 'integer', allowedValues: values },
        ],
      },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE', severity: 'warning' })
    );
    expect(blocksGeneration(report)).toBe(false);
  });

  it('reports an imported vendor interface with raw port maps without blocking generation', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'BRAM_PORTA',
            type: 'xilinx.com:interface:bram:1.0',
            mode: 'master',
            rawPortMaps: [{ logical: 'CLK', physical: 'bram_clk', direction: 'out', width: 1 }],
          },
        ],
      },
      library
    );

    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'BUS_TYPE_UNRESOLVED', severity: 'warning' }),
    ]);
    expect(blocksGeneration(report)).toBe(false);
  });

  it('accepts a conduit that has no ports yet', () => {
    const report = checkBusConformance(
      { busInterfaces: [{ name: 'leds', type: 'CONDUIT', mode: 'conduit' }] },
      library
    );

    expect(report.issues).toEqual([]);
    expect(blocksGeneration(report)).toBe(false);
  });

  it('accepts the generic conduit placeholder VLNV with no ports', () => {
    const report = checkBusConformance(
      { busInterfaces: [{ name: 'leds', type: BUS_VLNV.CONDUIT, mode: 'conduit' }] },
      library
    );

    expect(report.issues).toEqual([]);
    expect(blocksGeneration(report)).toBe(false);
  });

  it('blocks an unresolved VLNV conduit that has no conduitPorts', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          { name: 'fifo_write', type: 'xilinx.com:interface:fifo_write:1.0', mode: 'conduit' },
        ],
      },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'BUS_TYPE_UNRESOLVED', severity: 'warning' })
    );
    expect(blocksGeneration(report)).toBe(true);
  });

  it('accepts an unresolved VLNV conduit that carries conduitPorts', () => {
    const report = checkBusConformance(
      {
        busInterfaces: [
          {
            name: 'fifo_write',
            type: 'xilinx.com:interface:fifo_write:1.0',
            mode: 'conduit',
            conduitPorts: [{ name: 'fifo_wr_en', direction: 'out', width: 1 }],
          },
        ],
      },
      library
    );

    expect(report.issues).toEqual([]);
    expect(blocksGeneration(report)).toBe(false);
  });

  it('reports a missing mode instead of throwing', () => {
    const report = checkBusConformance(
      { busInterfaces: [{ name: 'S_AXI', type: 'ipcraft:busif:axi4_lite:1.0' }] },
      library
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'BUS_INTERFACE_MODE',
        path: ['busInterfaces', 0, 'mode'],
        message: 'Mode is required by ipcraft:busif:axi4_lite:1.0.',
      })
    );
  });
});
