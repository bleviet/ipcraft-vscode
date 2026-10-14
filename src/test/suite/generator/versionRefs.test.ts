/* eslint-disable */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { Logger } from '../../../utils/Logger';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import type { GenerateResult } from '../../../generator/types';
import { deduplicateAndOrderIssues } from '../../../webview/ipcore/types/issues';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/BusLibraryService', () => ({ BusLibraryService: jest.fn() }));

function installBusLibraryMock(): void {
  const emptySources = { sources: [], diagnostics: [] };
  (BusLibraryService as jest.Mock).mockImplementation(() => ({
    loadDefaultSources: jest.fn().mockResolvedValue(emptySources),
    loadFromDirectories: jest.fn().mockResolvedValue(emptySources),
    normalizeSources: jest.fn(() => builtinBusLibrary()),
    clearCache: jest.fn(),
  }));
}

const repoRoot = path.resolve(__dirname, '../../../..');
const templatesPath = path.join(repoRoot, 'src/generator/templates');

// ---------------------------------------------------------------------------
// Fixtures: one design per case (a core may hold only one version register)
// ---------------------------------------------------------------------------

const PLAIN_REGISTER = `
    - name: CTRL
      offset: 0x10
      fields:
      - { name: EN, bits: '[0:0]', access: read-write }
`;

/** (a) only constant fields */
const CASE_A = `
    - name: VERSION
      offset: 0x00
      fields:
      - { name: MAJOR, bits: '[23:16]', resetValue: $version.major }
      - { name: MINOR, bits: '[15:8]', resetValue: $version.minor }
      - { name: PATCH, bits: '[7:0]', resetValue: $version.patch }
${PLAIN_REGISTER}`;

/** (b) fieldless register-level $version */
const CASE_B = `
    - { name: VERSION, offset: 0x00, resetValue: $version }
${PLAIN_REGISTER}`;

/** (c) constant + read-write field */
const CASE_C = `
    - name: IDENT
      offset: 0x00
      fields:
      - { name: REV, bits: '[31:24]', resetValue: $version.major }
      - { name: ENABLE, bits: '[0:0]', access: read-write, resetValue: 1 }
`;

/** (d) constant + hardware read-only field, and no other hardware register in the design */
const CASE_D = `
    - name: IDENT
      offset: 0x00
      fields:
      - { name: REV, bits: '[31:24]', resetValue: $version.minor }
      - { name: BUSY, bits: '[3:0]', access: read-only }
`;

/** (e) the version register is the only register */
const CASE_E_FIELDS = `
    - name: VERSION
      offset: 0x00
      fields:
      - { name: MAJOR, bits: '[23:16]', resetValue: $version.major }
      - { name: MINOR, bits: '[15:8]', resetValue: $version.minor }
      - { name: PATCH, bits: '[7:0]', resetValue: $version.patch }
`;
const CASE_E_REGISTER = `
    - { name: VERSION, offset: 0x00, resetValue: $version }
`;

/** (f) a constant under a non-zero register-level reset word */
const CASE_F = `
    - name: LOCKED
      offset: 0x00
      resetValue: 0xffffffff
      fields:
      - { name: REV, bits: '[7:0]', resetValue: $version.minor }
      - { name: REST, bits: '[31:8]', access: read-write }
`;

/** (g) the version CRCs beside a component */
const CASE_CRC = `
    - name: VERSION
      offset: 0x00
      fields:
      - { name: MAJOR, bits: '[31:24]', resetValue: $version.major }
      - { name: CRC8, bits: '[23:16]', resetValue: $version.crc8 }
      - { name: CRC16, bits: '[15:0]', resetValue: $version.crc16 }
${PLAIN_REGISTER}`;

/** (h) only CRC fields: the only references a free-text version supports */
const CASE_CRC_ONLY = `
    - name: VERSION
      offset: 0x00
      fields:
      - { name: CRC8, bits: '[23:16]', resetValue: $version.crc8 }
      - { name: CRC16, bits: '[15:0]', resetValue: $version.crc16 }
${PLAIN_REGISTER}`;

interface Design {
  registers: string;
  version?: string;
  scheme?: string | null;
  extraMap?: string;
  targets?: string[];
  /** Adds a user (register-bank) port pair to the core. */
  userPorts?: boolean;
  bus?: 'axil' | 'avmm';
}

const AVMM_INTERFACE = [
  '- name: S_AVMM',
  '  type: ipcraft:busif:avalon_mm:1.0',
  '  mode: slave',
  '  physicalPrefix: s_avmm_',
  '  associatedClock: clk',
  '  associatedReset: reset_n',
  '  memoryMapRef: CSR_MAP',
  '  useOptionalPorts: [address, read, readdata, write, writedata, waitrequest, readdatavalid]',
];

const AXIL_INTERFACE = [
  '- name: S_AXI_LITE',
  '  type: ipcraft:busif:axi4_lite:1.0',
  '  mode: slave',
  '  physicalPrefix: s_axil_',
  '  associatedClock: clk',
  '  associatedReset: reset_n',
  '  memoryMapRef: CSR_MAP',
  '  portWidthOverrides: { AWADDR: 8, ARADDR: 8, WDATA: 32, RDATA: 32, WSTRB: 4 }',
];

function ipYaml(design: Design): string {
  const scheme = design.scheme === undefined ? 'major.minor.patch' : design.scheme;
  return [
    "apiVersion: '1.2'",
    'vlnv:',
    '  vendor: acme',
    '  library: test',
    '  name: ver_core',
    `  version: ${JSON.stringify(design.version ?? '1.4.2')}`,
    ...(scheme ? [`  versionScheme: ${scheme}`] : []),
    'description: $version fixture',
    'clocks:',
    '- name: clk',
    '  logicalName: CLK',
    '  direction: in',
    '  associatedReset: reset_n',
    'resets:',
    '- name: reset_n',
    '  logicalName: RESET_N',
    '  direction: in',
    '  polarity: activeLow',
    '  associatedClock: clk',
    ...(design.userPorts
      ? [
          'ports:',
          '- { name: user_ctrl, direction: out, width: 8 }',
          '- { name: user_status, direction: in, width: 8 }',
        ]
      : []),
    'busInterfaces:',
    ...(design.bus === 'avmm' ? AVMM_INTERFACE : AXIL_INTERFACE),
    'memoryMaps:',
    '  import: ver_core.mm.yml',
  ].join('\n');
}

function mmYaml(design: Design): string {
  return [
    '- name: CSR_MAP',
    '  addressBlocks:',
    '  - name: REGS',
    '    baseAddress: 0',
    '    usage: register',
    '    registers:',
    design.registers,
    design.extraMap ?? '',
  ].join('\n');
}

/** The text of `text` between the last `start` before `end`, and `end`. */
function between(text: string, start: string, end: string): string {
  const stop = text.indexOf(end, text.indexOf(start));
  return text.slice(text.lastIndexOf(start, stop), stop);
}

/** The text from the first `start` to the first `end` after it. */
function pkgSection(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  return from < 0 ? '' : text.slice(from, text.indexOf(end, from));
}

describe('$version references in generation', () => {
  const logger = new Logger('test') as any;
  let tmp: string;
  let scaffolder: IpCoreScaffolder;

  beforeEach(() => {
    installBusLibraryMock();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-version-refs-'));
    scaffolder = new IpCoreScaffolder(
      logger,
      new TemplateLoader(logger, templatesPath),
      devResourceRoots(repoRoot)
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeDesign(design: Design): string {
    const inputPath = path.join(tmp, 'ver_core.ip.yml');
    fs.writeFileSync(inputPath, ipYaml(design));
    fs.writeFileSync(path.join(tmp, 'ver_core.mm.yml'), mmYaml(design));
    return inputPath;
  }

  async function generate(
    design: Design,
    options: Record<string, unknown> = {}
  ): Promise<GenerateResult> {
    const inputPath = writeDesign(design);
    return scaffolder.generateAll(inputPath, path.join(tmp, 'out'), {
      dryRun: true,
      includeRegs: true,
      includeTestbench: false,
      scaffoldPack: 'builtin-ipcraft',
      targets: design.targets ?? [],
      ...options,
    });
  }

  async function rtl(design: Design, language: 'vhdl' | 'systemverilog') {
    const result = await generate(design, { hdlLanguage: language });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const ext = language === 'vhdl' ? 'vhd' : 'sv';
    const contents = result.generatedContents ?? {};
    return {
      pkg: contents[`rtl/ver_core_pkg.${ext}`],
      regs: contents[`rtl/ver_core_regs.${ext}`],
      files: contents,
    };
  }

  const count = (text: string, needle: string) => text.split(needle).length - 1;

  // -------------------------------------------------------------------------
  // Generation gate
  // -------------------------------------------------------------------------

  describe('generation gate', () => {
    it('blocks a free-text scheme and lists each issue as <map>.<block>.<register>.<field>: <message>', async () => {
      const result = await generate({ registers: CASE_A, scheme: null });
      expect(result.success).toBe(false);
      expect(result.error).toContain('$version');
      const messages = (result.issues ?? []).map((issue) => issue.message);
      expect(messages).toContain(
        'CSR_MAP.REGS.VERSION.MAJOR: Version references need a numeric version scheme (set vlnv.versionScheme in the owning .ip.yml); only $version.crc8 and $version.crc16 work with a free version'
      );
      expect(messages).toHaveLength(3);
      expect(result.issues?.every((issue) => issue.severity === 'error')).toBe(true);
    });

    it('accepts CRC references with a free-text version and resolves them over its UTF-8 bytes', async () => {
      const design: Design = { registers: CASE_CRC_ONLY, version: '1.0-rc1', scheme: 'free' };
      const result = await generate(design);
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.issues ?? []).toEqual([]);
      const { regs } = await rtl(design, 'vhdl');
      // CRC-8 0xF0, CRC-16 0x69CC of "1.0-rc1"
      expect(regs).toContain('rd_data_int <= "00000000111100000110100111001100";');
    });

    it('blocks a free-text core with an empty version when a CRC reference needs it', async () => {
      const result = await generate({ registers: CASE_CRC_ONLY, version: '', scheme: 'free' });
      expect(result.success).toBe(false);
      expect((result.issues ?? []).map((issue) => issue.code)).toEqual([
        'versionRef.invalidVersion',
      ]);
    });

    it('blocks a core version that is invalid for its numeric scheme', async () => {
      const result = await generate({ registers: CASE_A, version: 'rev A' });
      expect(result.success).toBe(false);
      expect((result.issues ?? []).map((issue) => issue.message)).toEqual([
        expect.stringContaining("CSR_MAP: vlnv.version 'rev A' is not valid for version scheme"),
      ]);
    });

    it('blocks a component the scheme does not have and a field of the wrong width', async () => {
      const result = await generate({
        registers: `
    - name: VERSION
      offset: 0
      fields:
      - { name: FEATURE, bits: '[7:0]', resetValue: $version.feature }
      - { name: MAJOR, bits: '[23:8]', resetValue: $version.major }
`,
        scheme: 'major.minor',
        version: '1.4',
      });
      expect(result.success).toBe(false);
      expect((result.issues ?? []).map((issue) => issue.message)).toEqual([
        expect.stringMatching(
          /^CSR_MAP\.REGS\.VERSION\.FEATURE: .*not available in version scheme/
        ),
        expect.stringMatching(/^CSR_MAP\.REGS\.VERSION\.MAJOR: .*needs 8 bits, field is 16/),
      ]);
    });

    it('blocks references inside register arrays and a second version register', async () => {
      const result = await generate({
        registers: `
    - { name: VERSION, offset: 0, resetValue: $version }
    - name: CH
      offset: 0x20
      count: 2
      stride: 8
      registers:
      - { name: VER, offset: 0, resetValue: $version }
`,
      });
      expect(result.success).toBe(false);
      const messages = (result.issues ?? []).map((issue) => issue.message);
      expect(messages).toContain(
        'CSR_MAP.REGS.CH.VER: Version references are not supported in register arrays'
      );
    });

    it('surfaces warnings through GenerateResult.warnings without blocking', async () => {
      const result = await generate({
        registers: `
    - name: VERSION
      offset: 0
      fields:
      - { name: MAJOR, bits: '[23:16]', resetValue: $version.major, access: read-write }
`,
      });
      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([
        'CSR_MAP.REGS.VERSION.MAJOR: Access is ignored: $version fields are generated as read-only constants',
      ]);
    });

    it('reports history stability warnings without blocking', async () => {
      const result = await generate({
        registers: CASE_A,
        extraMap: `
  versionHistory:
    registerSets:
      rs1-3f9a0c41d2b7e6a5:
        addressBlocks: []
    versions:
    - { version: 1.4.1, registerSet: rs1-3f9a0c41d2b7e6a5 }
`,
      });
      expect(result.success).toBe(true);
      expect(result.warnings?.join('\n')).toContain('Version 1.4.1 has no version register');
    });

    it('keeps every issue distinct in the Issues panel: map-root and same-field issues do not collapse', async () => {
      const result = await generate({
        version: 'rev A',
        registers: `
    - name: VERSION
      offset: 0
      fields:
      - { name: MAJOR, bits: '[3:0]', resetValue: $version.major, access: read-write }
`,
        extraMap: `
  versionHistory:
    registerSets:
      rs1-3f9a0c41d2b7e6a5:
        addressBlocks:
        - name: REGS
          baseAddress: 0
          registers:
          - name: OLD
            offset: 0
            fields:
            - { name: MINOR, bits: '[7:0]', resetValue: $version.minor }
    versions:
    - { version: 1.4.1, registerSet: rs1-3f9a0c41d2b7e6a5 }
`,
      });
      expect(result.success).toBe(false);
      const issues = result.issues ?? [];
      const kept = deduplicateAndOrderIssues(issues);
      expect(kept).toHaveLength(issues.length);
      expect(kept.map((issue) => [issue.code, issue.severity])).toEqual([
        ['versionRef.invalidVersion', 'error'],
        ['versionRef.width', 'error'],
        ['versionRef.access', 'warning'],
        ['versionRef.history.missing:1.4.1', 'warning'],
        ['versionRef.history.added:1.4.1', 'warning'],
      ]);
      // Two map-root issues share a path but not a code; both fields' issues share a path too.
      expect(kept[0].path).toEqual(kept[3].path);
      expect(kept[1].path).toEqual(kept[2].path);
    });

    it('stays silent for a design without references', async () => {
      const result = await generate({ registers: PLAIN_REGISTER, scheme: null });
      expect(result.success).toBe(true);
      expect(result.warnings ?? []).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // HDL: constants are literals, never regs / regs_in members
  // -------------------------------------------------------------------------

  describe('VHDL', () => {
    it('(a) a constant-only register reads as a literal and has no storage, port or write branch', async () => {
      const { pkg, regs } = await rtl({ registers: CASE_A }, 'vhdl');
      // 1.4.2 under major.minor.patch -> 0x010402
      expect(regs).toContain('"00000000000000010000010000000010"');
      expect(pkg).not.toMatch(/t_reg_version\b/);
      expect(pkg).not.toMatch(/\bversion\s*:/);
      expect(pkg).toContain('t_reg_ctrl');
      expect(regs).not.toMatch(/regs\.version/);
      expect(regs).not.toMatch(/regs_in\.version/);
      // Only the read process mentions the address: no write branch.
      expect(count(regs, 'when C_REG_VERSION_ADDR =>')).toBe(1);
      expect(regs).toContain('when C_REG_CTRL_ADDR =>');
    });

    it('(b) a fieldless register-level $version reads as a full-width literal', async () => {
      const { pkg, regs } = await rtl({ registers: CASE_B }, 'vhdl');
      expect(regs).toContain('rd_data_int <= "00000000000000010000010000000010";');
      expect(pkg).not.toMatch(/version\s*:\s*std_logic_vector/);
      expect(regs).not.toMatch(/regs(_in)?\.version/);
      expect(count(regs, 'when C_REG_VERSION_ADDR =>')).toBe(1);
    });

    it('(c) a constant beside a read-write field is a literal in the read composition only', async () => {
      const { pkg, regs } = await rtl({ registers: CASE_C }, 'vhdl');
      const record = pkgSection(pkg, 'type t_reg_ident is record', 'end record');
      expect(record).toContain('enable : std_logic;');
      expect(record).not.toContain('rev');
      expect(regs).toContain('v_rd_data(31 downto 24) := "00000001";');
      expect(regs).toContain('v_rd_data(0) := regs.ident.enable;');
      expect(regs).not.toMatch(/regs\.ident\.rev/);
      expect(regs).not.toMatch(/to_ident\(v_wdata\)\.rev/);
      expect(pkg).not.toMatch(/ident_val/);
    });

    it('(d) a constant beside a hardware read-only field keeps the _val port for the hardware field only', async () => {
      const { pkg, regs, files } = await rtl({ registers: CASE_D }, 'vhdl');
      const val = pkgSection(pkg, 'type t_reg_ident_val is record', 'end record');
      expect(val).toContain('busy : std_logic_vector(3 downto 0)');
      expect(val).not.toContain('rev');
      // The _val record is the only regs_in member, and the regs_in port exists without any
      // other hardware register in the design.
      const hw2sw = pkgSection(pkg, 'type t_regs_hw2sw is record', 'end record');
      expect(hw2sw).toContain('ident_val : t_reg_ident_val;');
      expect(hw2sw).not.toMatch(/\brev\b/);
      expect(regs).toContain('regs_in  : in  t_regs_hw2sw');
      expect(files['rtl/ver_core_axil.vhd']).toContain('regs_in  : in  t_regs_hw2sw');
      expect(files['rtl/ver_core_axil.vhd']).toContain('regs_in  => regs_in');
      expect(files['rtl/ver_core_core.vhd']).toContain('regs_out : out t_regs_hw2sw');
      expect(files['rtl/ver_core.vhd']).toContain('regs_in  => regs_hw2sw');
      expect(files['rtl/ver_core.vhd']).toContain('regs_out => regs_hw2sw');
      expect(regs).toContain('v_rd_data(31 downto 24) := "00000100";');
      expect(regs).toContain('regs_in.ident_val.busy');
      expect(regs).not.toMatch(/regs_in\.ident\.rev/);
      expect(regs).not.toMatch(/regs\.ident\b/);
      expect(count(regs, 'when C_REG_IDENT_ADDR =>')).toBe(1);
    });

    it('(g) CRC fields read as literals of the CRC over the version bytes', async () => {
      const { regs } = await rtl({ registers: CASE_CRC }, 'vhdl');
      // 1.4.2: CRC-8 0x64, CRC-16 0x172A
      expect(regs).toContain('rd_data_int <= "00000001011001000001011100101010";');
      expect(regs).not.toMatch(/regs\.version/);
    });

    it('resolves a four-component version', async () => {
      const { regs } = await rtl(
        { registers: CASE_B, version: '1.2.3.4', scheme: 'major.feature.minor.patch' },
        'vhdl'
      );
      expect(regs).toContain('rd_data_int <= "00000001000000100000001100000100";');
    });
  });

  describe('SystemVerilog', () => {
    it('(a) a constant-only register reads as a sized literal and has no storage, port or write branch', async () => {
      const { pkg, regs } = await rtl({ registers: CASE_A }, 'systemverilog');
      expect(regs).toContain("REG_VERSION_ADDR: rd_data_int <= 32'h10402;");
      expect(pkg).not.toMatch(/version_t\b/);
      expect(pkg).toContain('ctrl_t');
      expect(regs).not.toMatch(/regs\.version/);
      expect(regs).not.toMatch(/regs_in\.version/);
      expect(count(regs, 'REG_VERSION_ADDR')).toBe(1);
    });

    it('(b) a fieldless register-level $version reads as a sized literal', async () => {
      const { pkg, regs } = await rtl({ registers: CASE_B }, 'systemverilog');
      expect(regs).toContain("REG_VERSION_ADDR: rd_data_int <= 32'h10402;");
      expect(pkg).not.toMatch(/\bversion\s*;/);
      expect(count(regs, 'REG_VERSION_ADDR')).toBe(1);
    });

    it('(c) a constant beside a read-write field is a literal in the read composition only', async () => {
      const { pkg, regs } = await rtl({ registers: CASE_C }, 'systemverilog');
      const struct = between(pkg, 'typedef struct packed', '} ident_t;');
      expect(struct).toContain('enable;');
      expect(struct).not.toContain('rev');
      expect(regs).toContain("v[31:24] = 8'h1;");
      expect(regs).toContain('v[0] = regs.ident.enable;');
      expect(regs).not.toMatch(/regs\.ident\.rev/);
      // Reset assigns only the stored field.
      expect(regs).toContain('regs.ident.enable <= 1;');
    });

    it('(g) CRC fields read as sized literals of the CRC over the version bytes', async () => {
      const { regs } = await rtl({ registers: CASE_CRC }, 'systemverilog');
      expect(regs).toContain("REG_VERSION_ADDR: rd_data_int <= 32'h164172A;");
      expect(regs).not.toMatch(/regs\.version/);
    });

    it('(d) a constant beside a hardware read-only field keeps the _val port for the hardware field only', async () => {
      const { pkg, regs, files } = await rtl({ registers: CASE_D }, 'systemverilog');
      const val = between(pkg, 'typedef struct packed', '} ident_val_t;');
      expect(val).toContain('busy;');
      expect(val).not.toContain('rev');
      const hw2sw = between(pkg, 'typedef struct packed', '} regs_hw2sw_t;');
      expect(hw2sw).toContain('ident_val_t ident_val;');
      expect(hw2sw).not.toMatch(/\brev\b/);
      expect(regs).toMatch(/input\s+regs_hw2sw_t regs_in/);
      expect(files['rtl/ver_core_axil.sv']).toMatch(/input\s+regs_hw2sw_t regs_in/);
      expect(files['rtl/ver_core_axil.sv']).toContain('.regs_in  (regs_in)');
      expect(files['rtl/ver_core_core.sv']).toMatch(/output\s+regs_hw2sw_t regs_out/);
      expect(files['rtl/ver_core.sv']).toContain('.regs_in  (regs_hw2sw)');
      expect(files['rtl/ver_core.sv']).toContain('.regs_out (regs_hw2sw)');
      expect(regs).toContain("v[31:24] = 8'h4;");
      expect(regs).toContain('regs_in.ident_val.busy');
      expect(regs).not.toMatch(/regs_in\.ident\.rev/);
      expect(count(regs, 'REG_IDENT_ADDR')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // The version register is the only register: the register file must survive
  // -------------------------------------------------------------------------

  describe('a design whose only register is the version register', () => {
    const designs = [
      ['version fields', CASE_E_FIELDS],
      ['register-level $version', CASE_E_REGISTER],
    ] as const;
    const literalVhdl = '"00000000000000010000010000000010"';

    describe.each(designs)('%s', (_label, registers) => {
      it.each(['axil', 'avmm'] as const)(
        'VHDL / %s: _regs is instantiated, not a stub',
        async (bus) => {
          const { regs, files } = await rtl({ registers, bus, userPorts: true }, 'vhdl');
          expect(regs).toContain(`rd_data_int <= ${literalVhdl};`);
          expect(regs).not.toMatch(/regs_(in|out)\b/);
          const wrapper = files[`rtl/ver_core_${bus}.vhd`];
          expect(wrapper).toContain('u_regs : entity work.ver_core_regs');
          expect(wrapper).not.toContain('TODO: implement');
          expect(wrapper).not.toContain('user_ctrl');
          const top = files['rtl/ver_core.vhd'];
          expect(top).toContain(`u_${bus} : entity work.ver_core_${bus}`);
          expect(top).toContain('u_core : entity work.ver_core_core');
          // The user ports belong to the core, not to the bus wrapper.
          expect(count(top, 'user_ctrl =>')).toBe(1);
        }
      );

      it.each(['axil', 'avmm'] as const)(
        'SystemVerilog / %s: _regs is instantiated',
        async (bus) => {
          const { regs, files } = await rtl({ registers, bus, userPorts: true }, 'systemverilog');
          expect(regs).toContain("REG_VERSION_ADDR: rd_data_int <= 32'h10402;");
          expect(regs).not.toMatch(/regs_(in|out)\b/);
          expect(files[`rtl/ver_core_${bus}.sv`]).toContain('ver_core_regs u_regs (');
          const top = files['rtl/ver_core.sv'];
          expect(top).toContain(`ver_core_${bus} u_${bus} (`);
          expect(top).toContain('ver_core_core u_core (');
        }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Template contract
  // -------------------------------------------------------------------------

  describe('template context', () => {
    it('publishes version_scheme, version_history, version_file_suffix and constant flags', async () => {
      const inputPath = writeDesign({
        registers: CASE_C,
        extraMap: `
  versionHistory:
    registerSets:
      rs1-3f9a0c41d2b7e6a5:
        addressBlocks: []
    versions:
    - { version: 1.4.1, registerSet: rs1-3f9a0c41d2b7e6a5 }
    - { version: 1.4.2, registerSet: rs1-3f9a0c41d2b7e6a5, crc8: 100, crc16: 5930 }
`,
      });
      const context = await scaffolder.buildTemplateContextPublic(inputPath);
      expect(context.contract_version).toBe('1.7.0');
      expect(context.version_scheme).toBe('major.minor.patch');
      expect(context.version_file_suffix).toBe('1_4_2');
      expect(context.version_history).toEqual([
        { version: '1.4.1', register_set: 'rs1-3f9a0c41d2b7e6a5', crc8: null, crc16: null },
        { version: '1.4.2', register_set: 'rs1-3f9a0c41d2b7e6a5', crc8: 100, crc16: 5930 },
      ]);
      const ident = context.registers.find((register) => register.name === 'IDENT')!;
      expect(ident.is_constant).toBe(false);
      expect(
        ident.fields.map((f) => [f.name, f.is_constant, f.version_ref, f.reset_value])
      ).toEqual([
        ['REV', true, '$version.major', 1],
        ['ENABLE', false, null, 1],
      ]);
      expect(ident.fields[0].access).toBe('read-only');
    });

    it('marks register-level $version and all-constant registers as constant', async () => {
      const inputPath = writeDesign({ registers: CASE_B });
      const context = await scaffolder.buildTemplateContextPublic(inputPath);
      const version = context.registers.find((register) => register.name === 'VERSION')!;
      expect(version).toMatchObject({
        is_constant: true,
        read_source: 'constant',
        reset_value: 0x10402,
      });
      expect(context.registers.find((register) => register.name === 'CTRL')!.is_constant).toBe(
        false
      );
      expect(version.version_ref).toBe('$version');
      expect(
        context.registers.find((register) => register.name === 'CTRL')!.version_ref
      ).toBeNull();
    });

    it('splices a constant into a non-zero register reset word once, for every consumer', async () => {
      const inputPath = writeDesign({ registers: CASE_F });
      const context = await scaffolder.buildTemplateContextPublic(inputPath);
      const locked = context.registers.find((register) => register.name === 'LOCKED')!;
      // 1.4.2 -> minor 4 replaces the low byte of 0xffffffff
      expect(locked.reset_value).toBe(0xffffff04);
      expect(locked.fields.map((f) => [f.name, f.reset_value])).toEqual([
        ['REV', 4],
        ['REST', 0xffffff],
      ]);
      const result = await generate(
        { registers: CASE_F, targets: ['vivado'] },
        {
          includeTestbench: true,
        }
      );
      expect(result.success).toBe(true);
      const manifest = JSON.parse(result.generatedContents!['tb/verification_manifest.json']);
      expect(
        manifest.registers.find((register: any) => register.name === 'LOCKED').resetValue
      ).toBe(0xffffff04);
      const xml = result.generatedContents!['xilinx/component.xml'];
      const registerXml = xml.slice(xml.indexOf('<spirit:name>LOCKED</spirit:name>'));
      expect(registerXml.slice(0, registerXml.indexOf('<spirit:field>'))).toMatch(
        /<spirit:value spirit:format="long">0xffffff04<\/spirit:value>/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // Datasheet and pack documentation
  // -------------------------------------------------------------------------

  describe('documentation', () => {
    const history = `
  versionHistory:
    registerSets:
      rs1-3f9a0c41d2b7e6a5:
        addressBlocks: []
    versions:
    - { version: 1.4.1, registerSet: rs1-3f9a0c41d2b7e6a5 }
    - { version: 1.4.2, registerSet: rs1-3f9a0c41d2b7e6a5 }
`;

    it('datasheet shows constant resets and access and a Version section', async () => {
      const result = await generate(
        { registers: CASE_C, extraMap: history },
        { includeDocs: true }
      );
      expect(result.success).toBe(true);
      const sheet = result.generatedContents!['docs/ver_core_datasheet.md'];
      expect(sheet).toContain(
        '| `[31:24]` | `REV` | `read-only (constant)` | `$version.major (0x01)` | — |'
      );
      expect(sheet).toContain('| `[0:0]` | `ENABLE` | `read-write` | `0x1` | — |');
      expect(sheet).toContain('## Version\n\n**Version scheme:** `major.minor.patch`\n');
      // Entries recorded without CRCs show a dash.
      expect(sheet).toContain(
        '| Version | Register set | CRC-8 | CRC-16 |\n|---------|--------------|-------|--------|\n' +
          '| `1.4.1` | `rs1-3f9a0c41d2b7e6a5` | — | — |\n' +
          '| `1.4.2` | `rs1-3f9a0c41d2b7e6a5` | — | — |\n'
      );
    });

    it('datasheet lists the CRCs recorded with a version, in hex', async () => {
      const recorded = history.replace(
        '- { version: 1.4.2, registerSet: rs1-3f9a0c41d2b7e6a5 }',
        '- { version: 1.4.2, registerSet: rs1-3f9a0c41d2b7e6a5, crc8: 100, crc16: 5930 }'
      );
      const result = await generate(
        { registers: CASE_C, extraMap: recorded },
        { includeDocs: true }
      );
      const sheet = result.generatedContents!['docs/ver_core_datasheet.md'];
      expect(sheet).toContain('| `1.4.1` | `rs1-3f9a0c41d2b7e6a5` | — | — |');
      expect(sheet).toContain('| `1.4.2` | `rs1-3f9a0c41d2b7e6a5` | `0x64` | `0x172A` |');
    });

    it('datasheet and pack docs show a CRC field like any other $version field', async () => {
      const sheet = (await generate({ registers: CASE_CRC }, { includeDocs: true }))
        .generatedContents!['docs/ver_core_datasheet.md'];
      expect(sheet).toContain(
        '| `[23:16]` | `CRC8` | `read-only (constant)` | `$version.crc8 (0x64)` | — |'
      );
      expect(sheet).toContain(
        '| `[15:0]` | `CRC16` | `read-only (constant)` | `$version.crc16 (0x172A)` | — |'
      );
      const doc = (await generate({ registers: CASE_CRC }, { scaffoldPack: 'example-with-docs' }))
        .generatedContents!['docs/ver_core_registers.md'];
      expect(doc).toContain(
        '| `[23:16]` | `CRC8` | `read-only (constant)` | `$version.crc8 (0x64)` | — |'
      );
    });

    it('datasheet shows a register-level $version', async () => {
      const result = await generate({ registers: CASE_B }, { includeDocs: true });
      const sheet = result.generatedContents!['docs/ver_core_datasheet.md'];
      expect(sheet).toContain('Constant: `$version (0x00010402)`');
      expect(sheet).toContain('## Version');
      expect(sheet).not.toContain('Register set |');
    });

    it('datasheet and pack docs show the actual token of a fieldless register-level $version.minor', async () => {
      const registers = '    - { name: VERSION, offset: 0, resetValue: $version.minor }\n';
      const sheet = (await generate({ registers }, { includeDocs: true })).generatedContents![
        'docs/ver_core_datasheet.md'
      ];
      expect(sheet).toContain('Constant: `$version.minor (0x00000004)`');
      expect(sheet).not.toContain('`$version (');
      const doc = (await generate({ registers }, { scaffoldPack: 'example-with-docs' }))
        .generatedContents!['docs/ver_core_registers.md'];
      expect(doc).toContain('Constant: `$version.minor (0x00000004)`');
    });

    it('datasheet shows the field reset of a constant under a register-level reset word', async () => {
      const result = await generate({ registers: CASE_F }, { includeDocs: true });
      const sheet = result.generatedContents!['docs/ver_core_datasheet.md'];
      expect(sheet).toContain(
        '| `[7:0]` | `REV` | `read-only (constant)` | `$version.minor (0x04)` | — |'
      );
      expect(sheet).toContain('| `[31:8]` | `REST` | `read-write` | `0xFFFFFF` | — |');
    });

    it('datasheet of a core without a version scheme or history has no Version section', async () => {
      const result = await generate(
        { registers: PLAIN_REGISTER, scheme: null },
        { includeDocs: true }
      );
      const sheet = result.generatedContents!['docs/ver_core_datasheet.md'];
      expect(sheet).toContain('| `[0:0]` | `EN` | `read-write` | `0x0` | — |');
      expect(sheet).not.toContain('## Version');
    });

    it('example-with-docs memmap_doc shows constant fields the same way', async () => {
      const result = await generate({ registers: CASE_C }, { scaffoldPack: 'example-with-docs' });
      expect(result.success).toBe(true);
      const doc = result.generatedContents!['docs/ver_core_registers.md'];
      expect(doc).toContain(
        '| `[31:24]` | `REV` | `read-only (constant)` | `$version.major (0x01)` | — |'
      );
      expect(doc).toContain('| `[0:0]` | `ENABLE` | `read-write` | `0x1` | — |');
    });
  });

  // -------------------------------------------------------------------------
  // Verification manifest (cocotb scoreboard data)
  // -------------------------------------------------------------------------

  describe('verification manifest', () => {
    it('carries constants as readable, non-writable fields with the resolved reset', async () => {
      const result = await generate({ registers: CASE_C }, { includeTestbench: true });
      expect(result.success).toBe(true);
      const manifest = JSON.parse(result.generatedContents!['tb/verification_manifest.json']);
      const ident = manifest.registers.find((register: any) => register.name === 'IDENT');
      expect(ident).toMatchObject({
        resetValue: 0x01000001,
        readableMask: 0xff000001,
        writableMask: 1,
      });
      expect(ident.fields[0]).toMatchObject({
        name: 'REV',
        readable: true,
        writable: false,
        writeEffect: 'none',
        resetValue: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Vendor packaging
  // -------------------------------------------------------------------------

  describe('vendor packaging', () => {
    it('Vivado component.xml declares constants read-only with the resolved reset', async () => {
      const result = await generate({ registers: CASE_C, targets: ['vivado'] });
      expect(result.success).toBe(true);
      const xml = result.generatedContents!['xilinx/component.xml'];
      const ident = xml.slice(xml.indexOf('<spirit:name>IDENT</spirit:name>'));
      const rev = ident.slice(ident.indexOf('<spirit:name>REV</spirit:name>'));
      expect(rev.slice(0, rev.indexOf('</spirit:field>'))).toContain(
        '<spirit:access>read-only</spirit:access>'
      );
      // REV (8 bits at 24) = 1, ENABLE reset 1 -> register reset 0x1000001
      expect(ident.slice(0, ident.indexOf('<spirit:field>'))).toContain(
        '<spirit:value spirit:format="long">0x1000001</spirit:value>'
      );
    });

    it('names the XGUI script from the numeric version as before', async () => {
      const result = await generate({ registers: CASE_C, targets: ['vivado'] });
      expect(Object.keys(result.generatedContents!)).toContain('xilinx/xgui/ver_core_v1_4_2.tcl');
      expect(result.generatedContents!['xilinx/component.xml']).toContain(
        '<spirit:name>xgui/ver_core_v1_4_2.tcl</spirit:name>'
      );
    });

    it('sanitizes a free-text version in the XGUI file name', async () => {
      const result = await generate({
        registers: PLAIN_REGISTER,
        version: 'rev A/1',
        scheme: null,
        targets: ['vivado'],
      });
      expect(result.success).toBe(true);
      expect(Object.keys(result.generatedContents!)).toContain('xilinx/xgui/ver_core_vrev_A_1.tcl');
      expect(result.generatedContents!['xilinx/component.xml']).toContain(
        '<spirit:name>xgui/ver_core_vrev_A_1.tcl</spirit:name>'
      );
    });

    it.each([
      ['vivado', 'Vivado'],
      ['quartus', 'Quartus'],
    ])('warns for a non-numeric version on the %s target', async (target, tool) => {
      const result = await generate({
        registers: PLAIN_REGISTER,
        version: 'rev A',
        scheme: null,
        targets: [target],
      });
      expect(result.success).toBe(true);
      expect(result.warnings).toContain(
        `${tool} expects a numeric IP version; 'rev A' may be rejected`
      );
    });

    it('does not warn for a dotted-numeric version or without a vendor target', async () => {
      const numeric = await generate({ registers: PLAIN_REGISTER, targets: ['vivado', 'quartus'] });
      expect(numeric.warnings ?? []).toEqual([]);
      const none = await generate({ registers: PLAIN_REGISTER, version: 'rev A', scheme: null });
      expect(none.warnings ?? []).toEqual([]);
    });
  });
});
