import { updateFileSets, type FileSetEntry } from '../../../services/FileSetUpdater';

describe('FileSetUpdater', () => {
  it('creates expected file sets from generated files', () => {
    const inputFiles = [
      'rtl/core.vhd',
      'rtl/core_regs.vhd',
      'sim/core_tb.vhd',
      'sim/test.py',
      'sim/Makefile',
      'integration/core.tcl',
      'integration/core.xml',
    ];

    const result = updateFileSets([], inputFiles);

    const rtl = result.find((set) => set.name === 'RTL_Sources');
    const sim = result.find((set) => set.name === 'Simulation_Resources');
    const integration = result.find((set) => set.name === 'Integration');

    expect(rtl?.files).toEqual([{ path: 'rtl/core.vhd', type: 'vhdl' }]);
    expect(sim?.files).toEqual(
      expect.arrayContaining([
        { path: 'sim/core_tb.vhd', type: 'vhdl' },
        { path: 'sim/test.py', type: 'python' },
        { path: 'sim/Makefile', type: 'unknown' },
      ])
    );
    expect(integration?.files).toEqual(
      expect.arrayContaining([
        { path: 'rtl/core_regs.vhd', type: 'vhdl' },
        { path: 'integration/core.tcl', type: 'tcl' },
        { path: 'integration/core.xml', type: 'unknown' },
      ])
    );
  });

  it('reuses existing set aliases and avoids duplicate files', () => {
    const existing: FileSetEntry[] = [
      {
        name: 'rtl',
        description: 'RTL Sources',
        files: [{ path: 'rtl/core.vhd', type: 'vhdl' }],
      },
    ];

    const result = updateFileSets(existing, ['rtl/core.vhd', 'rtl/new.vhd']);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('rtl');
    expect(result[0].files).toEqual([
      { path: 'rtl/core.vhd', type: 'vhdl' },
      { path: 'rtl/new.vhd', type: 'vhdl' },
    ]);
  });
});
