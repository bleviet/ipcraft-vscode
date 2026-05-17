/* eslint-disable */
import * as path from 'path';
import * as fs from 'fs/promises';
import { ManifestDrivenScaffolder } from '../../../generator/ManifestDrivenScaffolder';
import { ManifestLoader } from '../../../generator/ManifestLoader';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { Logger } from '../../../utils/Logger';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
});

const BUILTIN_PATH = path.resolve(__dirname, '../../../generator/templates');

const baseContext: Record<string, unknown> = {
  entity_name: 'test_core',
  bus_type: 'axil',
  has_memory_mapped_slave: true,
  registers: [],
  sw_registers: [],
  hw_registers: [],
  generics: [],
  user_ports: [],
  interrupt_ports: [],
  bus_ports: [],
  secondary_bus_ports: [],
  expanded_bus_interfaces: [],
  bus_prefix: 's_axi',
  data_width: 32,
  addr_width: 8,
  reg_width: 4,
  memory_maps: [],
  clock_port: 'clk',
  reset_port: 'rst',
  reset_active_high: true,
  clocks_with_period: [],
  memmap_relpath: '../test_core.mm.yml',
  vendor: 'test.com',
  library: 'unit',
  version: '1.0.0',
  description: 'Test',
  author: 'test.com',
  display_name: 'Test Core',
};

const ipCoreData = {
  vlnv: { vendor: 'test.com', library: 'unit', name: 'test_core', version: '1.0.0' },
  bus_interfaces: [],
} as any;

function writtenPaths(): string[] {
  return (fs.writeFile as unknown as jest.Mock).mock.calls.map((c) => c[0] as string);
}

describe('ManifestLoader', () => {
  it('returns null when no manifest file exists', async () => {
    const result = await ManifestLoader.find('/nonexistent/core.ip.yml', BUILTIN_PATH);
    expect(result).toBeNull();
  });

  it('resolves ipcraft://builtin sentinel to builtinTemplatesPath', () => {
    const resolved = ManifestLoader.resolve(
      { version: '1.0', templateDirs: ['ipcraft://builtin'], outputs: [] },
      '/project',
      BUILTIN_PATH
    );
    expect(resolved.templateDirs).toEqual([BUILTIN_PATH]);
  });

  it('resolves relative templateDirs relative to manifest directory', () => {
    const resolved = ManifestLoader.resolve(
      { version: '1.0', templateDirs: ['./templates', 'ipcraft://builtin'], outputs: [] },
      '/project/dir',
      BUILTIN_PATH
    );
    expect(resolved.templateDirs[0]).toBe('/project/dir/templates');
    expect(resolved.templateDirs[1]).toBe(BUILTIN_PATH);
  });

  it('defaults templateDirs to builtin when field is absent', () => {
    const resolved = ManifestLoader.resolve(
      { version: '1.0', outputs: [] },
      '/project',
      BUILTIN_PATH
    );
    expect(resolved.templateDirs).toEqual([BUILTIN_PATH]);
  });

  it('defaults groups to empty object when field is absent', () => {
    const resolved = ManifestLoader.resolve(
      { version: '1.0', outputs: [] },
      '/project',
      BUILTIN_PATH
    );
    expect(resolved.groups).toEqual({});
  });
});

describe('ManifestDrivenScaffolder', () => {
  // Created at describe scope so the Logger mock implementation is still in place
  // (resetMocks: true resets mocks before each test, so beforeEach is too late).
  const logger = new Logger('test') as any;
  const templateLoader = new TemplateLoader(logger, BUILTIN_PATH);

  function makeScaffolder(outputs: any[], groups?: Record<string, { enabled: boolean }>) {
    const manifest = ManifestLoader.resolve(
      { version: '1.0', outputs, groups },
      '/project',
      BUILTIN_PATH
    );
    return new ManifestDrivenScaffolder(logger, templateLoader, manifest, {});
  }

  async function run(
    scaffolder: ManifestDrivenScaffolder,
    options: any = {},
    context = baseContext,
    protectedPaths = new Set<string>()
  ) {
    return scaffolder.generate(
      ipCoreData,
      context,
      options,
      '/output',
      '/project/core.ip.yml',
      protectedPaths
    );
  }

  it('generates a file listed in the manifest', async () => {
    const s = makeScaffolder(
      [{ template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' }],
      { rtl: { enabled: true } }
    );
    const result = await run(s, { includeVhdl: true });

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('rtl/test_core.vhd'))).toBe(true);
  });

  it('skips outputs whose group is inactive via manifest default', async () => {
    const s = makeScaffolder(
      [{ template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' }],
      { rtl: { enabled: false } } // disabled in manifest
    );
    const result = await run(s, {}); // no option override

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('rtl/test_core.vhd'))).toBe(false);
  });

  it('GenerateOptions override manifest group defaults', async () => {
    const s = makeScaffolder(
      [
        { template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' },
        { template: 'cocotb_makefile.j2', path: 'tb/Makefile', group: 'testbench' },
      ],
      { rtl: { enabled: true }, testbench: { enabled: true } }
    );
    // Explicitly disable testbench via option
    const result = await run(s, { includeVhdl: true, includeTestbench: false });

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('rtl/test_core.vhd'))).toBe(true);
    expect(writtenPaths().some((f) => f.includes('tb/Makefile'))).toBe(false);
  });

  it('vendor option activates altera and xilinx groups', async () => {
    const s = makeScaffolder(
      [{ template: 'altera_hw_tcl.j2', path: 'altera/{{ entity_name }}_hw.tcl', group: 'altera' }],
      { altera: { enabled: false } }
    );
    const result = await run(s, { vendor: 'altera' });

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('altera/test_core_hw.tcl'))).toBe(true);
  });

  it('skips an output when "when" evaluates to false', async () => {
    const s = makeScaffolder(
      [
        {
          template: 'package.vhdl.j2',
          path: 'rtl/{{ entity_name }}_pkg.vhd',
          group: 'rtl',
          when: '{{ has_memory_mapped_slave }}',
        },
      ],
      { rtl: { enabled: true } }
    );
    const ctx = { ...baseContext, has_memory_mapped_slave: false };
    const result = await run(s, { includeVhdl: true }, ctx);

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('_pkg.vhd'))).toBe(false);
  });

  it('includes an output when "when" evaluates to true', async () => {
    const s = makeScaffolder(
      [
        {
          template: 'package.vhdl.j2',
          path: 'rtl/{{ entity_name }}_pkg.vhd',
          group: 'rtl',
          when: '{{ has_memory_mapped_slave }}',
        },
      ],
      { rtl: { enabled: true } }
    );
    const result = await run(s, { includeVhdl: true });

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('_pkg.vhd'))).toBe(true);
  });

  it('resolves a dynamic template name from a Jinja2 expression', async () => {
    const s = makeScaffolder(
      [
        {
          template: 'bus_{{ bus_type }}.vhdl.j2',
          path: 'rtl/{{ entity_name }}_{{ bus_type }}.vhd',
          group: 'rtl',
          when: '{{ has_memory_mapped_slave }}',
        },
      ],
      { rtl: { enabled: true } }
    );
    const result = await run(s, { includeVhdl: true });

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('rtl/test_core_axil.vhd'))).toBe(true);
  });

  it('skips files in the protected paths set', async () => {
    const s = makeScaffolder(
      [
        { template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' },
        { template: 'core.vhdl.j2', path: 'rtl/{{ entity_name }}_core.vhd', group: 'rtl' },
      ],
      { rtl: { enabled: true } }
    );
    const result = await run(
      s,
      { includeVhdl: true },
      baseContext,
      new Set(['rtl/test_core_core.vhd'])
    );

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('test_core.vhd'))).toBe(true);
    expect(writtenPaths().some((f) => f.includes('test_core_core.vhd'))).toBe(false);
  });

  it('outputs with no group are always included', async () => {
    const s = makeScaffolder(
      [{ template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd' }], // no group
      {}
    );
    const result = await run(s, {}); // no options at all

    expect(result.success).toBe(true);
    expect(writtenPaths().some((f) => f.includes('rtl/test_core.vhd'))).toBe(true);
  });

  it('returns success:false and an error message on render failure', async () => {
    const s = makeScaffolder(
      [{ template: 'nonexistent_template.j2', path: 'rtl/out.vhd', group: 'rtl' }],
      { rtl: { enabled: true } }
    );
    const result = await run(s, { includeVhdl: true });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns count and busType in successful result', async () => {
    const s = makeScaffolder(
      [{ template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' }],
      { rtl: { enabled: true } }
    );
    const result = await run(s, { includeVhdl: true });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.busType).toBe('axil');
  });
});
