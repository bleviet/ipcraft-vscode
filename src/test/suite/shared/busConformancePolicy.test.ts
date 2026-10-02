import {
  blocksGeneration,
  blocksImportWrite,
  checkBusConformance,
} from '../../../shared/busConformance';
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
});
