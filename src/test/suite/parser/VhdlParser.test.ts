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

  it('splits two Avalon-ST sinks sharing one physicalPrefix into separate instances', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'asi_sink.vhd');
    const vhdl = `
      entity asi_sink is
        port (
          clk           : in  std_logic;
          reset         : in  std_logic;
          asi_valid_0_i : in  std_logic;
          asi_data_0_i  : in  std_logic_vector(31 downto 0);
          asi_valid_1_i : in  std_logic;
          asi_data_1_i  : in  std_logic_vector(31 downto 0)
        );
      end entity asi_sink;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    const ifaces = parsed.busInterfaces as Array<Record<string, unknown>>;
    expect(ifaces).toHaveLength(2);

    const byName = Object.fromEntries(ifaces.map((i) => [i.name, i]));
    expect(byName.asi_0).toBeDefined();
    expect(byName.asi_1).toBeDefined();

    expect(byName.asi_0.physicalPrefix).toBe('asi_');
    expect(byName.asi_1.physicalPrefix).toBe('asi_');
    expect(byName.asi_0.mode).toBe('slave');

    // Lossless, canonically lowercase (Avalon-ST) suffix overrides — this is the fix:
    // physicalPrefix + suffix reconstructs each instance's exact physical port names.
    expect(byName.asi_0.portNameOverrides).toEqual({ valid: 'valid_0_i', data: 'data_0_i' });
    expect(byName.asi_1.portNameOverrides).toEqual({ valid: 'valid_1_i', data: 'data_1_i' });

    // No user ports left over — both instances' ports were fully claimed.
    expect(parsed.ports).toBeUndefined();
  });

  it('groups a signal appearing with a different direction tag (_o) into the same instance as _i signals', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'asi_sink_ready.vhd');
    const vhdl = `
      entity asi_sink_ready is
        port (
          clk           : in  std_logic;
          reset         : in  std_logic;
          asi_valid_0_i : in  std_logic;
          asi_data_0_i  : in  std_logic_vector(31 downto 0);
          asi_ready_0_o : out std_logic;
          asi_valid_1_i : in  std_logic;
          asi_data_1_i  : in  std_logic_vector(31 downto 0);
          asi_ready_1_o : out std_logic
        );
      end entity asi_sink_ready;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    const ifaces = parsed.busInterfaces as Array<Record<string, unknown>>;
    expect(ifaces).toHaveLength(2);
    const byName = Object.fromEntries(ifaces.map((i) => [i.name, i]));

    // "ready" groups with "valid"/"data" under the same index despite the _o vs _i
    // direction tag, and is emitted as a selected optional port (not dropped).
    expect(byName.asi_0.portNameOverrides).toEqual({
      valid: 'valid_0_i',
      data: 'data_0_i',
      ready: 'ready_0_o',
    });
    expect(byName.asi_0.useOptionalPorts).toEqual(['ready']);
    expect(byName.asi_1.useOptionalPorts).toEqual(['ready']);
  });

  it('does not misdetect a plain register-bank interface as Avalon-ST', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'reg_bank.vhd');
    const vhdl = `
      entity reg_bank is
        port (
          clk      : in  std_logic;
          rd_en    : in  std_logic;
          rd_addr  : in  std_logic_vector(7 downto 0);
          rd_data  : out std_logic_vector(31 downto 0);
          rd_valid : out std_logic
        );
      end entity reg_bank;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    expect((parsed.busInterfaces as unknown[] | undefined) ?? []).toHaveLength(0);
    const ports = (parsed.ports as Array<Record<string, unknown>>) ?? [];
    expect(ports.map((p) => p.name)).toEqual(
      expect.arrayContaining(['rd_en', 'rd_addr', 'rd_data', 'rd_valid'])
    );
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
    expect(params[0]).toMatchObject({ name: 'AxiAddrWidth_g', value: 8, dataType: 'integer' });
    expect(params[1]).toMatchObject({ name: 'AxiDataWidth_g', value: 32, dataType: 'integer' });
    expect(params[2]).toMatchObject({
      name: 'ReadTimeoutClks_g',
      value: 100,
      dataType: 'integer',
    });
  });

  it('strips range constraints from generic dataType', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'ranged.vhd');
    const vhdl = `
      entity ranged is
        generic (
          AddrWidth_g : natural range 12 to 64  := 32;
          DataWidth_g : natural range 8 to 1024 := 32;
          MaxBeats_g  : natural range 1 to 256  := 256;
          Plain_g     : natural                 := 8
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

    expect(params).toHaveLength(4);
    // Range constraints must be stripped — only the base type survives
    expect(params[0]).toMatchObject({ name: 'AddrWidth_g', value: 32, dataType: 'integer' });
    expect(params[1]).toMatchObject({ name: 'DataWidth_g', value: 32, dataType: 'integer' });
    expect(params[2]).toMatchObject({ name: 'MaxBeats_g', value: 256, dataType: 'integer' });
    expect(params[3]).toMatchObject({ name: 'Plain_g', value: 8, dataType: 'integer' });
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

  it('collapses the canonical clog2 expansion back to clog2(PARAM)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'clog2.vhd');
    const vhdl = `
      entity fifo is
        generic (
          DEPTH : positive := 1024
        );
        port (
          rd_ptr : out std_logic_vector((integer(ceil(log2(real(DEPTH)))))-1 downto 0)
        );
      end entity;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath);
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
    const ports = (parsed.ports as Array<Record<string, unknown>>) ?? [];

    const rdPtr = ports.find((p) => p.name === 'rd_ptr');
    expect(rdPtr).toBeDefined();
    expect(rdPtr!.width).toBe('clog2(DEPTH)');
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

  it('emits portWidthOverrides for parametric AXI-Lite bus ports', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'axil_slave.vhd');
    const vhdl = `
      entity axil_slave is
        generic (
          AddrWidth_g : positive := 8;
          DataWidth_g : positive := 32
        );
        port (
          Clk              : in  std_logic;
          Rst              : in  std_logic;
          s_axil_awaddr    : in  std_logic_vector(AddrWidth_g - 1 downto 0);
          s_axil_awprot    : in  std_logic_vector(2 downto 0);
          s_axil_awvalid   : in  std_logic;
          s_axil_awready   : out std_logic;
          s_axil_wdata     : in  std_logic_vector(DataWidth_g - 1 downto 0);
          s_axil_wstrb     : in  std_logic_vector((DataWidth_g/8) - 1 downto 0);
          s_axil_wvalid    : in  std_logic;
          s_axil_wready    : out std_logic;
          s_axil_bresp     : out std_logic_vector(1 downto 0);
          s_axil_bvalid    : out std_logic;
          s_axil_bready    : in  std_logic;
          s_axil_araddr    : in  std_logic_vector(AddrWidth_g - 1 downto 0);
          s_axil_arprot    : in  std_logic_vector(2 downto 0);
          s_axil_arvalid   : in  std_logic;
          s_axil_arready   : out std_logic;
          s_axil_rdata     : out std_logic_vector(DataWidth_g - 1 downto 0);
          s_axil_rresp     : out std_logic_vector(1 downto 0);
          s_axil_rvalid    : out std_logic;
          s_axil_rready    : in  std_logic
        );
      end entity axil_slave;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    const ifaces = parsed.busInterfaces as Array<Record<string, unknown>>;
    expect(ifaces).toHaveLength(1);

    const overrides = ifaces[0].portWidthOverrides as Record<string, string>;
    expect(overrides).toBeDefined();
    expect(overrides.AWADDR).toBe('AddrWidth_g');
    expect(overrides.ARADDR).toBe('AddrWidth_g');
    expect(overrides.WDATA).toBe('DataWidth_g');
    expect(overrides.RDATA).toBe('DataWidth_g');
    // WSTRB: generator applies /8 automatically, so override must be data-width param
    expect(overrides.WSTRB).toBe('DataWidth_g');
    // All-lowercase ports → no portNameOverrides needed
    expect(ifaces[0].portNameOverrides).toBeUndefined();
  });

  it('emits portNameOverrides and preserves physicalPrefix casing for mixed-case bus ports', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'axil_mixed.vhd');
    // Port names match the olo_axi_lite_slave pattern: PascalCase prefix + PascalCase suffix
    const vhdl = `
      entity axil_mixed is
        generic (
          AxiAddrWidth_g : positive := 8;
          AxiDataWidth_g : positive := 32
        );
        port (
          Clk                 : in  std_logic;
          Rst                 : in  std_logic;
          S_AxiLite_AwAddr    : in  std_logic_vector(AxiAddrWidth_g - 1 downto 0);
          S_AxiLite_AwProt    : in  std_logic_vector(2 downto 0);
          S_AxiLite_AwValid   : in  std_logic;
          S_AxiLite_AwReady   : out std_logic;
          S_AxiLite_WData     : in  std_logic_vector(AxiDataWidth_g - 1 downto 0);
          S_AxiLite_WStrb     : in  std_logic_vector((AxiDataWidth_g/8) - 1 downto 0);
          S_AxiLite_WValid    : in  std_logic;
          S_AxiLite_WReady    : out std_logic;
          S_AxiLite_BResp     : out std_logic_vector(1 downto 0);
          S_AxiLite_BValid    : out std_logic;
          S_AxiLite_BReady    : in  std_logic;
          S_AxiLite_ArAddr    : in  std_logic_vector(AxiAddrWidth_g - 1 downto 0);
          S_AxiLite_ArProt    : in  std_logic_vector(2 downto 0);
          S_AxiLite_ArValid   : in  std_logic;
          S_AxiLite_ArReady   : out std_logic;
          S_AxiLite_RData     : out std_logic_vector(AxiDataWidth_g - 1 downto 0);
          S_AxiLite_RResp     : out std_logic_vector(1 downto 0);
          S_AxiLite_RValid    : out std_logic;
          S_AxiLite_RReady    : in  std_logic
        );
      end entity axil_mixed;
    `;

    await fs.writeFile(filePath, vhdl, 'utf8');
    const result = await parseVhdlFile(filePath, { detectBus: true });
    const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

    const ifaces = parsed.busInterfaces as Array<Record<string, unknown>>;
    expect(ifaces).toHaveLength(1);

    // Original-case prefix must be preserved
    expect(ifaces[0].physicalPrefix).toBe('S_AxiLite_');

    // portNameOverrides maps uppercase logical name → actual physical suffix
    const nameOverrides = ifaces[0].portNameOverrides as Record<string, string>;
    expect(nameOverrides).toBeDefined();
    expect(nameOverrides.AWADDR).toBe('AwAddr');
    expect(nameOverrides.AWPROT).toBe('AwProt');
    expect(nameOverrides.AWVALID).toBe('AwValid');
    expect(nameOverrides.AWREADY).toBe('AwReady');
    expect(nameOverrides.WDATA).toBe('WData');
    expect(nameOverrides.WSTRB).toBe('WStrb');
    expect(nameOverrides.ARADDR).toBe('ArAddr');
    expect(nameOverrides.RDATA).toBe('RData');
  });

  it('warns when vector-type generics (std_logic_vector, bit_vector) are parsed and maps them to integer', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vhdl-'));
    const filePath = path.join(tempDir, 'vector_generic.vhd');
    const vhdl = `
      entity vector_generic is
        generic (
          VectorParam_g : std_logic_vector(7 downto 0) := x"FF";
          BitVectorParam_g : bit_vector(3 downto 0) := "1010"
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

    expect(params).toHaveLength(2);
    expect(params[0]).toMatchObject({ name: 'VectorParam_g', value: 'x"FF"', dataType: 'integer' });
    expect(params[1]).toMatchObject({
      name: 'BitVectorParam_g',
      value: '"1010"',
      dataType: 'integer',
    });
    expect(result.warnings).toBeDefined();
    expect(result.warnings).toContain(
      "Warning: std_logic_vector generic detected on generic 'VectorParam_g'. Convert to integer for cross-vendor GUI compatibility."
    );
    expect(result.warnings).toContain(
      "Warning: std_logic_vector generic detected on generic 'BitVectorParam_g'. Convert to integer for cross-vendor GUI compatibility."
    );
  });
});
