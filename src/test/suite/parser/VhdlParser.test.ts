import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseVhdlFile } from '../../../parser/VhdlParser';

describe('VhdlParser', () => {
  it('parses an entity with ports', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'my_module.vhd');
    const vhdl = `
      library IEEE;
      use IEEE.STD_LOGIC_1164.ALL;

      entity my_module is
        port (
          clk     : in  std_logic;
          reset_n : in  std_logic;
          data_o  : out std_logic_vector(7 downto 0)
        );
      end entity my_module;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    expect(result.entityName).toBe('my_module');
    expect((parsed.ports as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('detects AXI-like bus interface patterns', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'axi_slave.vhd');
    const vhdl = `
      entity axi_slave is
        port (
          S_AXI_ACLK    : in  std_logic;
          S_AXI_ARESETN : in  std_logic;
          S_AXI_AWADDR  : in  std_logic_vector(31 downto 0);
          S_AXI_AWVALID : in  std_logic;
          S_AXI_AWREADY : out std_logic;
          S_AXI_WDATA   : in  std_logic_vector(31 downto 0)
        );
      end entity axi_slave;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    expect((parsed.busInterfaces as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
  });

  it('parses generic default values', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'generics.vhd');
    const vhdl = `
      entity generics is
        generic (
          AxiAddrWidth_g    : positive := 8;
          AxiDataWidth_g    : positive := 32;
          ReadTimeoutClks_g : positive := 100
        );
        port (
          Clk : in std_logic
        );
      end entity;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
    const params = parsed.parameters as Array<Record<string, unknown>>;

    expect(params).toHaveLength(3);
    expect(params[0]).toMatchObject({ name: 'AxiAddrWidth_g', value: 8, dataType: 'positive' });
    expect(params[1]).toMatchObject({ name: 'AxiDataWidth_g', value: 32, dataType: 'positive' });
    expect(params[2]).toMatchObject({
      name: 'ReadTimeoutClks_g',
      value: 100,
      dataType: 'positive',
    });
  });

  it('detects width for ports with computed MSB expressions', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'computed_width.vhd');
    const vhdl = `
      entity computed_width is
        generic (
          AxiDataWidth_g : positive := 32
        );
        port (
          Clk        : in  std_logic;
          Rb_ByteEna : out std_logic_vector((AxiDataWidth_g/8) - 1 downto 0);
          Rb_WrData  : out std_logic_vector(AxiDataWidth_g - 1 downto 0)
        );
      end entity;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
    const ports = (parsed.ports as Array<Record<string, unknown>>) ?? [];

    const byteEna = ports.find((p) => p.name === 'Rb_ByteEna');
    expect(byteEna).toBeDefined();
    // Width is stored as the expression "AxiDataWidth_g/8" so it re-evaluates when the generic changes
    expect(byteEna!.width).toBe('AxiDataWidth_g/8');

    const wrData = ports.find((p) => p.name === 'Rb_WrData');
    expect(wrData).toBeDefined();
    expect(wrData!.width).toBe('AxiDataWidth_g');
  });

  it('extracts width from compound expressions and to-direction ranges', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'compound.vhd');
    const vhdl = `
      entity compound is
        generic (
          N_g : positive := 8
        );
        port (
          a_doubled : out std_logic_vector(N_g*2 - 1 downto 0);
          b_sum     : out std_logic_vector(N_g + N_g - 1 downto 0);
          c_to      : out std_logic_vector(0 to N_g - 1)
        );
      end entity;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
    const ports = (parsed.ports as Array<Record<string, unknown>>) ?? [];

    const doubled = ports.find((p) => p.name === 'a_doubled');
    expect(doubled).toBeDefined();
    expect(doubled!.width).toBe('N_g*2');

    const sum = ports.find((p) => p.name === 'b_sum');
    expect(sum).toBeDefined();
    expect(sum!.width).toBe('N_g + N_g');

    const toDir = ports.find((p) => p.name === 'c_to');
    expect(toDir).toBeDefined();
    expect(toDir!.width).toBe('N_g');
  });

  it('strips IO_ prefix only once for logical port names', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'io_prefix.vhd');
    const vhdl = `
      entity io_prefix is
        port (
          IO_I_DATA : in std_logic_vector(7 downto 0)
        );
      end entity io_prefix;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
    const ports = (parsed.ports as Array<Record<string, unknown>>) ?? [];

    expect(ports).toHaveLength(1);
    expect(ports[0].name).toBe('IO_I_DATA');
    expect(ports[0].logicalName).toBe('I_DATA');
  });
});
