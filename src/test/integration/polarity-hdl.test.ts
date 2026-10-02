import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { IpCoreScaffolder, collectRtlAbsPaths } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { loadIpCoreData } from '../../generator/loadIpCore';
import { devResourceRoots } from '../../services/ResourceRoots';
import { Logger } from '../../utils/Logger';
import { guardTier1, toolOnPath } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src/generator/templates');
const ENTITY_NAME = 'polarity_test_ip';

const IP_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: ${ENTITY_NAME}
  version: 1.0.0
scaffold_pack: builtin-ipcraft
parameters:
- name: DATA_WIDTH
  dataType: integer
  value: 32
busInterfaces:
- name: slave_avmm
  type: ipcraft:busif:avalon_mm:1.0
  mode: slave
  physicalPrefix: avs_
  endianness: big
  useOptionalPorts: [read, writedata, byteenable, readdata, readdatavalid]
  portWidthOverrides: { writedata: DATA_WIDTH, readdata: DATA_WIDTH }
  portPolarityOverrides:
    read: activeLow
    byteenable: activeLow
    readdatavalid: activeLow
- name: master_avmm
  type: ipcraft:busif:avalon_mm:1.0
  mode: master
  physicalPrefix: mav_
  endianness: big
  useOptionalPorts: [read, writedata, byteenable, readdata, readdatavalid]
  portWidthOverrides: { writedata: DATA_WIDTH, readdata: DATA_WIDTH }
  portPolarityOverrides:
    read: activeLow
    byteenable: activeLow
    readdatavalid: activeLow
`;

const POLARITY_ONLY_ENTITY = 'polarity_only_ip';
const POLARITY_ONLY_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: ${POLARITY_ONLY_ENTITY}
  version: 1.0.0
scaffold_pack: builtin-ipcraft
parameters:
- name: MAV_READ_N_INV
  dataType: integer
  value: 1
busInterfaces:
- name: master_avmm
  type: ipcraft:busif:avalon_mm:1.0
  mode: master
  physicalPrefix: mav_
  endianness: little
  useOptionalPorts: [read, readdatavalid]
  portPolarityOverrides:
    read: activeLow
    readdatavalid: activeLow
`;

const CONDUIT_ENDIAN_ENTITY = 'conduit_endian_ip';
const CONDUIT_ENDIAN_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: ${CONDUIT_ENDIAN_ENTITY}
  version: 1.0.0
scaffold_pack: builtin-ipcraft
busInterfaces:
- name: custom_conduit
  type: acme:interface:conduit:1.0
  mode: conduit
  physicalPrefix: c_
  endianness: big
  conduitPorts:
  - { name: payload, direction: in, width: 32, role: data }
  - { name: qualifier, direction: out, width: 4, role: byteQualifier }
  - { name: bidir, direction: inout, width: 32, role: data }
`;

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

async function generate(hdlLanguage: 'vhdl' | 'systemverilog', yaml = IP_YAML) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-polarity-'));
  const yamlPath = path.join(outputDir, 'src.ip.yml');
  fs.writeFileSync(yamlPath, yaml);

  const resourceRoots = devResourceRoots(REPO_ROOT);
  const scaffolder = new IpCoreScaffolder(
    logger,
    new TemplateLoader(logger, GENERATOR_TEMPLATES),
    resourceRoots
  );
  const result = await scaffolder.generateAll(yamlPath, outputDir, {
    includeRegs: true,
    hdlLanguage,
  });
  if (!result.success) {
    throw new Error(`Generation failed: ${result.error}`);
  }

  const ipCoreData = await loadIpCoreData(yamlPath, resourceRoots);
  const rtlOrder = (
    await collectRtlAbsPaths(result.generatedContents ?? {}, ipCoreData, yamlPath, outputDir)
  ).map((absolutePath) => path.relative(outputDir, absolutePath).replace(/\\/g, '/'));

  return { outputDir, rtlOrder };
}

describe('HDL boundary polarity transforms', () => {
  it('reflows explicit big-endian conduit data and qualifiers through a generated core', async () => {
    const vhdl = await generate('vhdl', CONDUIT_ENDIAN_YAML);
    const vhdlFiles = vhdl.rtlOrder.filter((file) => file.endsWith('.vhd'));
    expect(vhdlFiles).toEqual(
      expect.arrayContaining([
        `rtl/${CONDUIT_ENDIAN_ENTITY}_pkg.vhd`,
        `rtl/${CONDUIT_ENDIAN_ENTITY}_core.vhd`,
        `rtl/${CONDUIT_ENDIAN_ENTITY}.vhd`,
      ])
    );
    const vhdlTop = fs.readFileSync(
      path.join(vhdl.outputDir, 'rtl', `${CONDUIT_ENDIAN_ENTITY}.vhd`),
      'utf8'
    );
    expect(vhdlTop).toContain('c_payload_be');
    expect(vhdlTop).toContain('swap_bytes_32(c_payload)');
    expect(vhdlTop).toContain('gen_swap_c_qualifier');
    expect(vhdlTop).not.toContain('c_bidir_be');
    expect(vhdlTop).not.toContain('not c_payload');
    if (!guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-conduit-endian-'));
      try {
        const result = spawnSync('ghdl', ['-a', '--std=08', `--workdir=${workDir}`, ...vhdlFiles], {
          cwd: vhdl.outputDir,
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
          status: 0,
          output: result.stderr || result.stdout,
        });
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }

    const systemVerilog = await generate('systemverilog', CONDUIT_ENDIAN_YAML);
    const svFiles = systemVerilog.rtlOrder.filter((file) => file.endsWith('.sv'));
    expect(svFiles).toEqual(
      expect.arrayContaining([
        `rtl/${CONDUIT_ENDIAN_ENTITY}_pkg.sv`,
        `rtl/${CONDUIT_ENDIAN_ENTITY}_core.sv`,
        `rtl/${CONDUIT_ENDIAN_ENTITY}.sv`,
      ])
    );
    const svTop = fs.readFileSync(
      path.join(systemVerilog.outputDir, 'rtl', `${CONDUIT_ENDIAN_ENTITY}.sv`),
      'utf8'
    );
    expect(svTop).toContain('c_payload_be');
    expect(svTop).toContain('swap_bytes_32(c_payload)');
    expect(svTop).toContain('gen_swap_c_qualifier');
    expect(svTop).not.toContain('c_bidir_be');
    expect(svTop).not.toContain('~c_payload');
    if (!guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      const outputPath = path.join(
        os.tmpdir(),
        `ipcraft-iverilog-conduit-endian-${process.pid}.vvp`
      );
      const result = spawnSync('iverilog', ['-g2012', '-o', outputPath, ...svFiles], {
        cwd: systemVerilog.outputDir,
        encoding: 'utf8',
        timeout: 120_000,
      });
      fs.rmSync(outputPath, { force: true });
      expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
        status: 0,
        output: result.stderr || result.stdout,
      });
    }
  }, 60_000);

  it('emits and compiles support files for a polarity-only master interface', async () => {
    const vhdl = await generate('vhdl', POLARITY_ONLY_YAML);
    const vhdlFiles = vhdl.rtlOrder.filter((file) => file.endsWith('.vhd'));
    expect(vhdlFiles).toEqual(
      expect.arrayContaining([
        `rtl/${POLARITY_ONLY_ENTITY}_pkg.vhd`,
        `rtl/${POLARITY_ONLY_ENTITY}_core.vhd`,
        `rtl/${POLARITY_ONLY_ENTITY}.vhd`,
      ])
    );
    const vhdlTop = fs.readFileSync(
      path.join(vhdl.outputDir, 'rtl', `${POLARITY_ONLY_ENTITY}.vhd`),
      'utf8'
    );
    expect(vhdlTop).toContain('signal mav_read_n_inv_2 : std_logic;');
    expect(vhdlTop).toContain('mav_read_n <= not mav_read_n_inv_2;');
    if (!guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-polarity-only-'));
      try {
        const result = spawnSync('ghdl', ['-a', '--std=08', `--workdir=${workDir}`, ...vhdlFiles], {
          cwd: vhdl.outputDir,
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
          status: 0,
          output: result.stderr || result.stdout,
        });
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }

    const systemVerilog = await generate('systemverilog', POLARITY_ONLY_YAML);
    const svFiles = systemVerilog.rtlOrder.filter((file) => file.endsWith('.sv'));
    expect(svFiles).toEqual(
      expect.arrayContaining([
        `rtl/${POLARITY_ONLY_ENTITY}_pkg.sv`,
        `rtl/${POLARITY_ONLY_ENTITY}_core.sv`,
        `rtl/${POLARITY_ONLY_ENTITY}.sv`,
      ])
    );
    const svTop = fs.readFileSync(
      path.join(systemVerilog.outputDir, 'rtl', `${POLARITY_ONLY_ENTITY}.sv`),
      'utf8'
    );
    expect(svTop).toContain('logic mav_read_n_inv_2;');
    expect(svTop).toContain('assign mav_read_n = ~mav_read_n_inv_2;');
    if (!guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      const outputPath = path.join(
        os.tmpdir(),
        `ipcraft-iverilog-polarity-only-${process.pid}.vvp`
      );
      const result = spawnSync('iverilog', ['-g2012', '-o', outputPath, ...svFiles], {
        cwd: systemVerilog.outputDir,
        encoding: 'utf8',
        timeout: 120_000,
      });
      fs.rmSync(outputPath, { force: true });
      expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
        status: 0,
        output: result.stderr || result.stdout,
      });
    }
  }, 60_000);

  it('renders VHDL scalar and parameterized-vector inversion in both directions', async () => {
    const { outputDir } = await generate('vhdl');
    const top = fs.readFileSync(path.join(outputDir, 'rtl', `${ENTITY_NAME}.vhd`), 'utf8');

    expect(top).toContain('avs_read_n');
    expect(top).toContain('mav_read_n');
    expect(top).toContain('signal avs_read_n_inv : std_logic;');
    expect(top).toContain('avs_read_n_inv <= not avs_read_n;');
    expect(top).toContain('avs_readdatavalid_n <= not avs_readdatavalid_n_inv;');
    expect(top).toContain('signal avs_byteenable_n_be');
    expect(top).toContain(
      "avs_byteenable_n_be(bit_idx) <= not avs_byteenable_n(avs_byteenable_n'length - 1 - bit_idx);"
    );
    expect(top).toContain(
      "mav_byteenable_n(bit_idx) <= not mav_byteenable_n_be(mav_byteenable_n'length - 1 - bit_idx);"
    );
    expect(top.match(/signal avs_byteenable_n_be/g)).toHaveLength(1);
    expect(top).toMatch(/avs_read_n\s+=> avs_read_n_inv/);
  });

  it('renders SystemVerilog bitwise inversion in both directions', async () => {
    const { outputDir } = await generate('systemverilog');
    const top = fs.readFileSync(path.join(outputDir, 'rtl', `${ENTITY_NAME}.sv`), 'utf8');

    expect(top).toContain('logic avs_read_n_inv;');
    expect(top).toContain('assign avs_read_n_inv = ~avs_read_n;');
    expect(top).toContain('assign avs_readdatavalid_n = ~avs_readdatavalid_n_inv;');
    expect(top).toContain('logic [(DATA_WIDTH/8)-1:0] avs_byteenable_n_be;');
    expect(top).toContain(
      'assign avs_byteenable_n_be[bit_idx_avs_byteenable_n] = ~avs_byteenable_n[$bits(avs_byteenable_n) - 1 - bit_idx_avs_byteenable_n];'
    );
    expect(top).toContain(
      'assign mav_byteenable_n[bit_idx_mav_byteenable_n] = ~mav_byteenable_n_be[$bits(mav_byteenable_n) - 1 - bit_idx_mav_byteenable_n];'
    );
    expect(top).not.toContain('!avs_');
    expect(top).not.toContain('!mav_');
    expect(top.match(/logic \[\(DATA_WIDTH\/8\)-1:0\] avs_byteenable_n_be;/g)).toHaveLength(1);
  });

  it('compiles and elaborates the generated VHDL', async () => {
    if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      return;
    }

    const { outputDir, rtlOrder } = await generate('vhdl');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-polarity-'));
    try {
      for (const args of [
        [
          '-a',
          '--std=08',
          `--workdir=${workDir}`,
          ...rtlOrder.filter((file) => file.endsWith('.vhd')),
        ],
        ['-e', '--std=08', `--workdir=${workDir}`, ENTITY_NAME],
      ]) {
        const result = spawnSync('ghdl', args, {
          cwd: outputDir,
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
          status: 0,
          output: result.stderr || result.stdout,
        });
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('compiles the generated SystemVerilog', async () => {
    if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      return;
    }

    const { outputDir, rtlOrder } = await generate('systemverilog');
    const outputPath = path.join(os.tmpdir(), `ipcraft-iverilog-polarity-${process.pid}.vvp`);
    const result = spawnSync(
      'iverilog',
      ['-g2012', '-o', outputPath, ...rtlOrder.filter((file) => file.endsWith('.sv'))],
      { cwd: outputDir, encoding: 'utf8', timeout: 120_000 }
    );
    fs.rmSync(outputPath, { force: true });
    expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
      status: 0,
      output: result.stderr || result.stdout,
    });
  }, 60_000);
});
