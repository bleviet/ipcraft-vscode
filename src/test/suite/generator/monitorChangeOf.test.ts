/* eslint-disable */
import * as path from 'path';
import * as fs from 'fs/promises';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { Logger } from '../../../utils/Logger';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { devResourceRoots } from '../../../services/ResourceRoots';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/BusLibraryService', () => ({
  BusLibraryService: jest.fn().mockImplementation(() => ({
    loadDefaultLibrary: jest.fn().mockResolvedValue({
      AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
    }),
    clearCache: jest.fn(),
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

// ---------------------------------------------------------------------------
// Shared template context helpers
// ---------------------------------------------------------------------------

const FIELD_FIFO_OVERFLOW = {
  name: 'FIFO_OVERFLOW',
  offset: 0,
  width: 1,
  access: 'write-1-to-clear',
  reset_value: 0,
  is_cos: false,
};
const FIELD_TEMP_VALUE = {
  name: 'TEMP_VALUE',
  offset: 4,
  width: 12,
  access: 'read-only',
  reset_value: 0,
};
const FIELD_TEMP_UPDATED = {
  name: 'TEMP_UPDATED',
  offset: 16,
  width: 1,
  access: 'write-1-to-clear',
  reset_value: 0,
  is_cos: true,
  monitorChangeOf: 'TEMP_VALUE',
};

/** All-CoS register: every W1C field uses monitorChangeOf — no external pulse record generated. */
const FIELD_LEVEL_RO = { name: 'LEVEL', offset: 0, width: 8, access: 'read-only', reset_value: 0 };
const FIELD_LEVEL_CROSS = {
  name: 'CROSSED',
  offset: 8,
  width: 1,
  access: 'write-1-to-clear',
  reset_value: 0,
  is_cos: true,
  monitorChangeOf: 'LEVEL',
};

function buildMixedContext() {
  const cosField = { ...FIELD_TEMP_UPDATED, monitored_field: FIELD_TEMP_VALUE };
  return {
    entity_name: 'sensor_core',
    data_width: 32,
    addr_width: 8,
    reg_width: 4,
    clock_port: 'clk',
    reset_port: 'rst',
    reset_active_high: true,
    registers: [
      {
        name: 'SENSOR_STATUS',
        offset: 4,
        access: 'read-write-1-to-clear',
        has_cos_fields: true,
        fields: [FIELD_FIFO_OVERFLOW, FIELD_TEMP_VALUE, FIELD_TEMP_UPDATED],
      },
    ],
    sw_registers: [
      {
        name: 'SENSOR_STATUS',
        access: 'read-write-1-to-clear',
        fields: [
          { name: 'FIFO_OVERFLOW', offset: 0, width: 1, reset_value: 0 },
          { name: 'TEMP_VALUE', offset: 4, width: 12, reset_value: 0 },
          { name: 'TEMP_UPDATED', offset: 16, width: 1, reset_value: 0 },
        ],
      },
    ],
    hw_registers: [],
    w1c_registers: [
      {
        name: 'SENSOR_STATUS',
        fields: [
          { ...FIELD_FIFO_OVERFLOW },
          { ...FIELD_TEMP_VALUE, is_cos: false },
          { ...FIELD_TEMP_UPDATED },
        ],
      },
    ],
    cos_registers: [
      {
        name: 'SENSOR_STATUS',
        access: 'read-write-1-to-clear',
        fields: [FIELD_FIFO_OVERFLOW, FIELD_TEMP_VALUE, FIELD_TEMP_UPDATED],
        cos_fields: [cosField],
        val_fields: [FIELD_TEMP_VALUE],
      },
    ],
  };
}

/** Context where ALL W1C fields use monitorChangeOf — no _pulse record should be emitted. */
function buildAllCosContext() {
  const cosField = { ...FIELD_LEVEL_CROSS, monitored_field: FIELD_LEVEL_RO };
  return {
    entity_name: 'threshold_core',
    data_width: 32,
    addr_width: 8,
    reg_width: 4,
    clock_port: 'clk',
    reset_port: 'rst',
    reset_active_high: true,
    registers: [
      {
        name: 'THRESHOLD',
        offset: 0,
        access: 'read-write-1-to-clear',
        has_cos_fields: true,
        fields: [FIELD_LEVEL_RO, FIELD_LEVEL_CROSS],
      },
    ],
    sw_registers: [
      {
        name: 'THRESHOLD',
        access: 'read-write-1-to-clear',
        fields: [
          { name: 'LEVEL', offset: 0, width: 8, reset_value: 0 },
          { name: 'CROSSED', offset: 8, width: 1, reset_value: 0 },
        ],
      },
    ],
    hw_registers: [],
    w1c_registers: [
      {
        name: 'THRESHOLD',
        fields: [{ ...FIELD_LEVEL_RO, is_cos: false }, { ...FIELD_LEVEL_CROSS }],
      },
    ],
    cos_registers: [
      {
        name: 'THRESHOLD',
        fields: [FIELD_LEVEL_RO, FIELD_LEVEL_CROSS],
        cos_fields: [cosField],
        val_fields: [FIELD_LEVEL_RO],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Template-level tests
// ---------------------------------------------------------------------------

describe('monitorChangeOf — VHDL package template', () => {
  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  let loader: TemplateLoader;

  beforeEach(() => {
    loader = new TemplateLoader(logger, templatesPath);
  });

  describe('mixed register (external W1C + CoS W1C + RO)', () => {
    let output: string;
    beforeEach(() => {
      output = loader.render('package.vhdl.j2', buildMixedContext());
    });

    it('generates _pulse record containing only the external W1C field', () => {
      expect(output).toContain('t_reg_sensor_status_pulse');
      expect(output).toContain('fifo_overflow_pulse');
    });

    it('omits CoS field from _pulse record', () => {
      expect(output).not.toContain('temp_updated_pulse');
    });

    it('generates _val record type for monitored fields', () => {
      expect(output).toContain('t_reg_sensor_status_val');
      expect(output).toContain('temp_value : std_logic_vector(11 downto 0)');
    });

    it('generates _val reset constant', () => {
      expect(output).toContain('C_REG_SENSOR_STATUS_VAL_RESET');
    });

    it('adds _pulse port to t_regs_hw2sw', () => {
      expect(output).toContain('sensor_status_pulse : t_reg_sensor_status_pulse');
    });

    it('adds _val port to t_regs_hw2sw', () => {
      expect(output).toContain('sensor_status_val : t_reg_sensor_status_val');
    });
  });

  describe('all-CoS register (no external pulse fields)', () => {
    let output: string;
    beforeEach(() => {
      output = loader.render('package.vhdl.j2', buildAllCosContext());
    });

    it('omits _pulse record entirely', () => {
      expect(output).not.toContain('t_reg_threshold_pulse');
      expect(output).not.toContain('_pulse');
    });

    it('still generates _val record', () => {
      expect(output).toContain('t_reg_threshold_val');
      expect(output).toContain('level : std_logic_vector(7 downto 0)');
    });

    it('hw2sw record has no _pulse port', () => {
      expect(output).not.toContain('threshold_pulse');
    });

    it('hw2sw record has _val port', () => {
      expect(output).toContain('threshold_val : t_reg_threshold_val');
    });
  });
});

describe('monitorChangeOf — VHDL register file template', () => {
  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  let loader: TemplateLoader;
  let output: string;

  beforeEach(() => {
    loader = new TemplateLoader(logger, templatesPath);
    output = loader.render('register_file.vhdl.j2', buildMixedContext());
  });

  it('declares shadow signal for monitored field', () => {
    expect(output).toContain('sensor_status_temp_value_shadow');
  });

  it('declares CoS pulse signal', () => {
    expect(output).toContain('sensor_status_temp_updated_cos : std_logic');
  });

  it('generates concurrent CoS comparator statement', () => {
    expect(output).toContain("sensor_status_temp_updated_cos <= '1' when");
    expect(output).toContain(
      'regs_in.sensor_status_val.temp_value /= sensor_status_temp_value_shadow'
    );
  });

  it('updates shadow register every clock in p_write', () => {
    expect(output).toContain(
      'sensor_status_temp_value_shadow <= regs_in.sensor_status_val.temp_value'
    );
  });

  it('generates external pulse arbitration for FIFO_OVERFLOW', () => {
    expect(output).toContain('fifo_overflow_pulse');
    expect(output).toContain("regs_in.sensor_status_pulse.fifo_overflow_pulse = '1'");
  });

  it('does NOT generate pulse arbitration for CoS field TEMP_UPDATED', () => {
    expect(output).not.toContain('temp_updated_pulse');
  });

  it('generates CoS W1C arbitration for TEMP_UPDATED using internal cos signal', () => {
    expect(output).toContain("sensor_status_temp_updated_cos = '1'");
    expect(output).toContain("regs.sensor_status.temp_updated <= '1'");
  });

  it('CPU clear path uses wr_data bit at correct offset (bit 16)', () => {
    expect(output).toContain('wr_data(16)');
  });

  it('declares v_rd_data variable in p_read process', () => {
    expect(output).toContain('variable v_rd_data');
  });

  it('reads W1C sticky bit FIFO_OVERFLOW from regs in mixed read', () => {
    expect(output).toContain('v_rd_data(0) := regs.sensor_status.fifo_overflow');
  });

  it('reads RO field TEMP_VALUE from regs_in_val in mixed read', () => {
    expect(output).toContain('v_rd_data(15 downto 4) := regs_in.sensor_status_val.temp_value');
  });

  it('reads CoS sticky bit TEMP_UPDATED from regs in mixed read', () => {
    expect(output).toContain('v_rd_data(16) := regs.sensor_status.temp_updated');
  });

  it('excludes CoS register from standard read loop', () => {
    // Standard read loop would emit pack_xxx(regs.xxx) — CoS register must not appear there
    expect(output).not.toContain('pack_sensor_status(regs.sensor_status)');
    expect(output).not.toContain('pack_sensor_status(regs_in.sensor_status)');
  });

  it('generates regs_in port when only cos_registers present (no hw_registers)', () => {
    expect(output).toContain('regs_in  : in  t_regs_hw2sw');
  });
});

describe('monitorChangeOf — SV package template', () => {
  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  let loader: TemplateLoader;

  beforeEach(() => {
    loader = new TemplateLoader(logger, templatesPath);
  });

  describe('mixed register', () => {
    let output: string;
    beforeEach(() => {
      output = loader.render('pkg.sv.j2', buildMixedContext());
    });

    it('generates _pulse_t struct with only external W1C field', () => {
      expect(output).toContain('sensor_status_pulse_t');
      expect(output).toContain('fifo_overflow_pulse');
      expect(output).not.toContain('temp_updated_pulse');
    });

    it('generates _val_t struct for monitored fields', () => {
      expect(output).toContain('sensor_status_val_t');
      expect(output).toContain('temp_value');
    });

    it('hw2sw struct has _pulse member', () => {
      expect(output).toContain('sensor_status_pulse_t sensor_status_pulse');
    });

    it('hw2sw struct has _val member', () => {
      expect(output).toContain('sensor_status_val_t sensor_status_val');
    });
  });

  describe('all-CoS register', () => {
    let output: string;
    beforeEach(() => {
      output = loader.render('pkg.sv.j2', buildAllCosContext());
    });

    it('omits _pulse_t struct entirely', () => {
      expect(output).not.toContain('threshold_pulse_t');
    });

    it('generates _val_t struct', () => {
      expect(output).toContain('threshold_val_t');
    });
  });
});

describe('monitorChangeOf — SV register file template', () => {
  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  let loader: TemplateLoader;
  let output: string;

  beforeEach(() => {
    loader = new TemplateLoader(logger, templatesPath);
    output = loader.render('register_file.sv.j2', buildMixedContext());
  });

  it('declares shadow logic signal', () => {
    expect(output).toContain('sensor_status_temp_value_shadow');
  });

  it('declares CoS pulse logic signal', () => {
    expect(output).toContain('sensor_status_temp_updated_cos');
  });

  it('generates continuous CoS comparator assignment', () => {
    expect(output).toContain('assign sensor_status_temp_updated_cos');
    expect(output).toContain(
      'regs_in.sensor_status_val.temp_value !== sensor_status_temp_value_shadow'
    );
  });

  it('updates shadow every clock', () => {
    expect(output).toContain(
      'sensor_status_temp_value_shadow <= regs_in.sensor_status_val.temp_value'
    );
  });

  it('generates external pulse arbitration for FIFO_OVERFLOW unchanged', () => {
    expect(output).toContain('regs_in.sensor_status_pulse.fifo_overflow_pulse');
  });

  it('does NOT generate pulse arbitration for CoS field', () => {
    expect(output).not.toContain('temp_updated_pulse');
  });

  it('generates CoS arbitration using internal cos signal', () => {
    expect(output).toContain('sensor_status_temp_updated_cos');
    expect(output).toContain("regs.sensor_status.temp_updated <= 1'b1");
  });

  it('generates mixed read using named block with local variable', () => {
    expect(output).toContain('blk_rd_sensor_status');
    expect(output).toContain('logic [C_DATA_WIDTH-1:0] v;');
    expect(output).toContain("v = '0;");
  });

  it('mixes sticky bits and RO values in SV read path', () => {
    expect(output).toContain('v[0] = regs.sensor_status.fifo_overflow');
    expect(output).toContain('v[15:4] = regs_in.sensor_status_val.temp_value');
    expect(output).toContain('v[16] = regs.sensor_status.temp_updated');
  });

  it('excludes CoS register from standard SV read loop', () => {
    expect(output).not.toContain('pack_sensor_status(regs.sensor_status)');
    expect(output).not.toContain('pack_sensor_status(regs_in.sensor_status)');
  });
});

// ---------------------------------------------------------------------------
// Generator-level tests (end-to-end via IpCoreScaffolder)
// ---------------------------------------------------------------------------

describe('monitorChangeOf — IpCoreScaffolder end-to-end', () => {
  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  const loader = new TemplateLoader(logger, templatesPath);
  const repoRoot = path.resolve(__dirname, '../../../..');
  const resourceRoots = devResourceRoots(repoRoot);
  let scaffolder: any;

  beforeEach(() => {
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({
        AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
      }),
      clearCache: jest.fn(),
    }));
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);
    jest.clearAllMocks();
  });

  it('generates successfully with a valid monitorChangeOf field', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/cos-ipcore.yml');
    const result = await scaffolder.generateAll(inputPath, '/tmp/cos-test-out', {
      ipCraftMethodology: true,
      includeRegs: true,
    });
    expect(result.success).toBe(true);
  });

  it('generates VHDL package containing _val type and correct _pulse record', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/cos-ipcore.yml');
    await scaffolder.generateAll(inputPath, '/tmp/cos-pkg-out', {
      ipCraftMethodology: true,
      includeRegs: true,
    });

    const pkgContent: string = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('_pkg.vhd')
    )?.[1];

    expect(pkgContent).toBeDefined();
    expect(pkgContent).toContain('t_reg_sensor_status_val');
    expect(pkgContent).toContain('fifo_overflow_pulse');
    expect(pkgContent).not.toContain('temp_updated_pulse');
    expect(pkgContent).toContain('sensor_status_val : t_reg_sensor_status_val');
  });

  it('generates VHDL register file with shadow signals and CoS arbitration', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/cos-ipcore.yml');
    await scaffolder.generateAll(inputPath, '/tmp/cos-regs-out', {
      ipCraftMethodology: true,
      includeRegs: true,
    });

    const regsContent: string = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('_regs.vhd')
    )?.[1];

    expect(regsContent).toBeDefined();
    expect(regsContent).toContain('sensor_status_temp_value_shadow');
    expect(regsContent).toContain('sensor_status_temp_updated_cos');
    expect(regsContent).toContain('regs_in.sensor_status_val.temp_value');
    expect(regsContent).not.toContain('temp_updated_pulse');
  });

  it('throws when monitorChangeOf references a field that does not exist', async () => {
    const tmpPath = path.join(require('os').tmpdir(), `cos_bad_ref_${Date.now()}.ip.yml`);
    const memmapPath = path.join(require('os').tmpdir(), `cos_bad_ref_mm_${Date.now()}.mm.yml`);

    const realFs = jest.requireActual('fs/promises') as typeof import('fs/promises');

    await realFs.writeFile(
      memmapPath,
      [
        '- name: BAD_MAP',
        '  addressBlocks:',
        '  - name: REGS',
        '    baseAddress: 0',
        '    usage: register',
        '    registers:',
        '    - name: STATUS',
        '      offset: 0',
        '      fields:',
        '      - name: FLAG',
        "        bits: '[0:0]'",
        '        access: write-1-to-clear',
        '        monitorChangeOf: NONEXISTENT_FIELD',
      ].join('\n'),
      'utf-8'
    );

    await realFs.writeFile(
      tmpPath,
      [
        "apiVersion: '1.0'",
        'vlnv:',
        '  vendor: test.com',
        '  library: unit',
        '  name: bad_core',
        '  version: 1.0.0',
        'clocks:',
        '- name: clk',
        '  direction: in',
        'resets:',
        '- name: rst',
        '  direction: in',
        '  polarity: activeHigh',
        'busInterfaces:',
        '- name: S_AXI',
        '  type: AXI4L',
        '  mode: slave',
        '  physicalPrefix: s_axi_',
        '  associatedClock: clk',
        '  associatedReset: rst',
        '  memoryMapRef: BAD_MAP',
        `memoryMaps:`,
        `  import: ${memmapPath}`,
      ].join('\n'),
      'utf-8'
    );

    try {
      const result = await scaffolder.generateAll(tmpPath, '/tmp/bad-cos-out', {
        ipCraftMethodology: true,
        includeRegs: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('NONEXISTENT_FIELD');
    } finally {
      await realFs.unlink(tmpPath).catch(() => {});
      await realFs.unlink(memmapPath).catch(() => {});
    }
  });

  it('throws when monitorChangeOf is on a non-W1C field', async () => {
    const tmpPath = path.join(require('os').tmpdir(), `cos_bad_access_${Date.now()}.ip.yml`);
    const memmapPath = path.join(require('os').tmpdir(), `cos_bad_access_mm_${Date.now()}.mm.yml`);

    const realFs = jest.requireActual('fs/promises') as typeof import('fs/promises');

    await realFs.writeFile(
      memmapPath,
      [
        '- name: BAD_MAP',
        '  addressBlocks:',
        '  - name: REGS',
        '    baseAddress: 0',
        '    usage: register',
        '    registers:',
        '    - name: STATUS',
        '      offset: 0',
        '      fields:',
        '      - name: VALUE',
        "        bits: '[7:0]'",
        '        access: read-only',
        '      - name: FLAG',
        "        bits: '[8:8]'",
        '        access: read-write',
        '        monitorChangeOf: VALUE',
      ].join('\n'),
      'utf-8'
    );

    await realFs.writeFile(
      tmpPath,
      [
        "apiVersion: '1.0'",
        'vlnv:',
        '  vendor: test.com',
        '  library: unit',
        '  name: bad_access_core',
        '  version: 1.0.0',
        'clocks:',
        '- name: clk',
        '  direction: in',
        'resets:',
        '- name: rst',
        '  direction: in',
        '  polarity: activeHigh',
        'busInterfaces:',
        '- name: S_AXI',
        '  type: AXI4L',
        '  mode: slave',
        '  physicalPrefix: s_axi_',
        '  associatedClock: clk',
        '  associatedReset: rst',
        '  memoryMapRef: BAD_MAP',
        'memoryMaps:',
        `  import: ${memmapPath}`,
      ].join('\n'),
      'utf-8'
    );

    try {
      const result = await scaffolder.generateAll(tmpPath, '/tmp/bad-access-cos-out', {
        ipCraftMethodology: true,
        includeRegs: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not write-1-to-clear|read-write-1-to-clear/);
    } finally {
      await realFs.unlink(tmpPath).catch(() => {});
      await realFs.unlink(memmapPath).catch(() => {});
    }
  });

  it('external W1C field (FIFO_OVERFLOW) is unaffected alongside CoS field', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/cos-ipcore.yml');
    await scaffolder.generateAll(inputPath, '/tmp/cos-regression-out', {
      ipCraftMethodology: true,
      includeRegs: true,
    });

    const regsContent: string = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('_regs.vhd')
    )?.[1];

    expect(regsContent).toBeDefined();
    // External pulse path must still be generated for FIFO_OVERFLOW
    expect(regsContent).toContain('fifo_overflow_pulse');
    expect(regsContent).toContain("regs_in.sensor_status_pulse.fifo_overflow_pulse = '1'");
    expect(regsContent).toContain("regs.sensor_status.fifo_overflow <= '1'");
  });
});
