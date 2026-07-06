import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseVerilogFile, extractVerilogInterface } from '../../../parser/VerilogParser';

describe('VerilogParser', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-verilog-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeAndParse(
    filename: string,
    content: string,
    opts?: Parameters<typeof parseVerilogFile>[1]
  ) {
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, content, 'utf8');
    return parseVerilogFile(filePath, opts);
  }

  describe('module name extraction', () => {
    it('parses a simple module with ports', async () => {
      const result = await writeAndParse(
        'my_module.v',
        `
module my_module (
  input  wire       clk,
  input  wire       reset_n,
  output wire [7:0] data_o
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

      expect(result.moduleName).toBe('my_module');
      expect((parsed.ports as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it('throws when no module declaration is found', async () => {
      await expect(writeAndParse('empty.v', '// just a comment\nassign x = 1;')).rejects.toThrow(
        'No Verilog/SystemVerilog module declaration found'
      );
    });

    it('detects SystemVerilog file type from .sv extension', async () => {
      const result = await writeAndParse(
        'my_mod.sv',
        `
module my_mod (
  input logic clk
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const fileSets = parsed.fileSets as Array<Record<string, unknown>>;
      const files = fileSets[0].files as Array<Record<string, unknown>>;

      expect(files[0].type).toBe('systemverilog');
    });

    it('detects Verilog file type from .v extension', async () => {
      const result = await writeAndParse(
        'my_mod.v',
        `
module my_mod (
  input wire clk
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const fileSets = parsed.fileSets as Array<Record<string, unknown>>;
      const files = fileSets[0].files as Array<Record<string, unknown>>;

      expect(files[0].type).toBe('verilog');
    });
  });

  describe('parameter extraction', () => {
    it('parses hash-style parameters (Verilog 2001)', async () => {
      const result = await writeAndParse(
        'params.v',
        `
module params #(
  parameter int ADDR_WIDTH = 8,
  parameter int DATA_WIDTH = 32
) (
  input wire clk
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const params = parsed.parameters as Array<Record<string, unknown>>;

      expect(params).toHaveLength(2);
      expect(params[0]).toMatchObject({ name: 'ADDR_WIDTH', value: 8, dataType: 'integer' });
      expect(params[1]).toMatchObject({ name: 'DATA_WIDTH', value: 32, dataType: 'integer' });
    });

    it('parses localparam in hash-style block', async () => {
      const result = await writeAndParse(
        'localp.v',
        `
module localp #(
  parameter DEPTH = 16,
  localparam WIDTH = 8
) (
  input wire clk
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const params = parsed.parameters as Array<Record<string, unknown>>;

      expect(params).toHaveLength(2);
      expect(params[0]).toMatchObject({ name: 'DEPTH', value: 16 });
      expect(params[1]).toMatchObject({ name: 'WIDTH', value: 8 });
    });

    it('parses body-style parameters (Verilog-95)', async () => {
      const result = await writeAndParse(
        'v95.v',
        `
module v95 (clk, data);
  parameter int FIFO_DEPTH = 256;
  parameter MAX_BURST = 16;
  input wire clk;
  output wire [7:0] data;
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const params = parsed.parameters as Array<Record<string, unknown>>;

      expect(params).toHaveLength(2);
      expect(params[0]).toMatchObject({ name: 'FIFO_DEPTH', value: 256 });
      expect(params[1]).toMatchObject({ name: 'MAX_BURST', value: 16 });
    });

    it('warns on vector parameters', async () => {
      const result = await writeAndParse(
        'vecparam.v',
        `
module vecparam #(
  parameter [7:0] MASK = 8'hFF
) (
  input wire clk
);
endmodule
`
      );

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toContain('vector parameter detected');
    });

    it('deduplicates parameters with the same name', async () => {
      const result = await writeAndParse(
        'dedup.v',
        `
module dedup #(
  parameter WIDTH = 8,
  parameter WIDTH = 16
) (
  input wire clk
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const params = parsed.parameters as Array<Record<string, unknown>>;

      expect(params).toHaveLength(1);
      expect(params[0]).toMatchObject({ name: 'WIDTH', value: 8 });
    });
  });

  describe('port extraction', () => {
    it('parses input, output, and inout ports', async () => {
      const result = await writeAndParse(
        'ports.v',
        `
module ports (
  input  wire       enable,
  output reg  [7:0] data_o,
  inout  wire [3:0] bidir
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;

      expect(ports).toHaveLength(3);
      expect(ports[0]).toMatchObject({ name: 'enable', direction: 'in' });
      expect(ports[1]).toMatchObject({ name: 'data_o', direction: 'out', width: 8 });
      expect(ports[2]).toMatchObject({ name: 'bidir', direction: 'inout', width: 4 });
    });

    it('extracts width from parametric range [PARAM-1:0]', async () => {
      const result = await writeAndParse(
        'parametric.v',
        `
module parametric #(
  parameter WIDTH = 32
) (
  output wire [WIDTH-1:0] data
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;
      const data = ports.find((p) => p.name === 'data');

      expect(data).toBeDefined();
      expect(data!.width).toBe('WIDTH');
    });

    it('extracts a clog2 width from $clog2(PARAM)-1:0', async () => {
      const result = await writeAndParse(
        'clog2.v',
        `
module fifo #(
  parameter DEPTH = 1024
) (
  output wire [$clog2(DEPTH)-1:0] rd_ptr
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;
      const rdPtr = ports.find((p) => p.name === 'rd_ptr');

      expect(rdPtr).toBeDefined();
      expect(rdPtr!.width).toBe('clog2(DEPTH)');
    });

    it('extracts a clog2 width whose argument is an arithmetic expression', async () => {
      // Regression test for https://github.com/bleviet/ipcraft-vscode/issues/37:
      // the extraction regex used to require a bare parameter inside
      // $clog2(...), so an arithmetic argument (DW/2) matched no pattern at
      // all and the port silently lost its width entirely (fell back to a
      // fixed default instead of referencing the generic).
      const result = await writeAndParse(
        'clog2div.v',
        `
module half_core #(
  parameter DW = 32
) (
  output wire [$clog2(DW/2)-1:0] half_ptr
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;
      const halfPtr = ports.find((p) => p.name === 'half_ptr');

      expect(halfPtr).toBeDefined();
      expect(halfPtr!.width).toBe('clog2(DW/2)');
    });

    it('extracts a general arithmetic parameterized width with no predefined function', async () => {
      const result = await writeAndParse(
        'compound.v',
        `
module compound #(
  parameter DW = 32
) (
  output wire [DW/2-1:0] half_word
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;
      const halfWord = ports.find((p) => p.name === 'half_word');

      expect(halfWord).toBeDefined();
      expect(halfWord!.width).toBe('DW/2');
    });

    it('extracts width from [PARAM:0] range', async () => {
      const result = await writeAndParse(
        'param0.v',
        `
module param0 #(
  parameter N = 8
) (
  output wire [N:0] data
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;
      const data = ports.find((p) => p.name === 'data');

      expect(data).toBeDefined();
      expect(data!.width).toBe('N');
    });

    it('handles SystemVerilog logic type', async () => {
      const result = await writeAndParse(
        'sv_logic.sv',
        `
module sv_logic (
  input  logic        enable,
  output logic [15:0] data
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;

      expect(ports).toHaveLength(2);
      expect(ports[0]).toMatchObject({ name: 'enable', direction: 'in' });
      expect(ports[1]).toMatchObject({ name: 'data', direction: 'out', width: 16 });
    });
  });

  describe('clock and reset classification', () => {
    it('classifies clock and reset ports', async () => {
      const result = await writeAndParse(
        'clk_rst.v',
        `
module clk_rst (
  input wire clk,
  input wire reset_n,
  output wire [7:0] data
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

      expect(parsed.clocks).toBeDefined();
      const clocks = parsed.clocks as Array<Record<string, unknown>>;
      expect(clocks[0].name).toBe('clk');
      expect(clocks[0].associatedReset).toBe('reset_n');

      expect(parsed.resets).toBeDefined();
      const resets = parsed.resets as Array<Record<string, unknown>>;
      expect(resets[0].name).toBe('reset_n');
      expect(resets[0].associatedClock).toBe('clk');
    });
  });

  describe('bus interface detection', () => {
    it('detects AXI-Lite bus interface patterns', async () => {
      const result = await writeAndParse(
        'axi_slave.v',
        `
module axi_slave (
  input  wire        s_axi_awvalid,
  output wire        s_axi_awready,
  input  wire [31:0] s_axi_awaddr,
  input  wire        s_axi_wvalid,
  output wire        s_axi_wready,
  input  wire [31:0] s_axi_wdata,
  output wire        s_axi_bvalid,
  input  wire        s_axi_bready,
  output wire [1:0]  s_axi_bresp,
  input  wire        s_axi_arvalid,
  output wire        s_axi_arready,
  input  wire [31:0] s_axi_araddr,
  output wire        s_axi_rvalid,
  input  wire        s_axi_rready,
  output wire [31:0] s_axi_rdata,
  output wire [1:0]  s_axi_rresp,
  input  wire        clk,
  input  wire        reset_n
);
endmodule
`,
        { detectBus: true }
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ifaces = parsed.busInterfaces as Array<Record<string, unknown>>;

      expect(ifaces).toBeDefined();
      expect(ifaces.length).toBeGreaterThan(0);
    });

    it('skips bus detection when detectBus is false', async () => {
      const result = await writeAndParse(
        'no_bus.v',
        `
module no_bus (
  input  wire        s_axi_awvalid,
  output wire        s_axi_awready,
  input  wire [31:0] s_axi_awaddr,
  input  wire        clk
);
endmodule
`,
        { detectBus: false }
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;

      expect(parsed.busInterfaces).toBeUndefined();
    });
  });

  describe('comment stripping', () => {
    it('strips line comments before parsing', async () => {
      const result = await writeAndParse(
        'comments.v',
        `
module comments (
  input wire enable, // this is the enable
  output wire data // output data
);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;

      expect(ports).toHaveLength(2);
      expect(ports[0].name).toBe('enable');
      expect(ports[1].name).toBe('data');
    });

    it('strips block comments before parsing', async () => {
      const result = await writeAndParse(
        'block_comment.v',
        `
/* This is a
   block comment */
module block_comment (
  input wire enable /* inline block */,
  output wire data
);
endmodule
`
      );

      expect(result.moduleName).toBe('block_comment');
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const ports = parsed.ports as Array<Record<string, unknown>>;

      expect(ports).toHaveLength(2);
      expect(ports[0].name).toBe('enable');
      expect(ports[1].name).toBe('data');
    });
  });

  describe('extractVerilogInterface', () => {
    it('returns module name, parameters, and ports from raw content', () => {
      const content = `
module my_ip #(
  parameter WIDTH = 16
) (
  input  wire        clk,
  output wire [15:0] data
);
endmodule
`;
      const result = extractVerilogInterface(content);

      expect(result.moduleName).toBe('my_ip');
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0]).toMatchObject({ name: 'WIDTH', value: '16' });
      expect(result.ports).toHaveLength(2);
    });

    it('returns null module name for content without module declaration', () => {
      const result = extractVerilogInterface('assign x = 1;');

      expect(result.moduleName).toBeNull();
      expect(result.parameters).toHaveLength(0);
      expect(result.ports).toHaveLength(0);
    });
  });

  describe('VLNV and fileSets', () => {
    it('uses default VLNV values when options not provided', async () => {
      const result = await writeAndParse(
        'defaults.v',
        `
module defaults (input wire clk);
endmodule
`
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const vlnv = parsed.vlnv as Record<string, unknown>;

      expect(vlnv.vendor).toBe('user');
      expect(vlnv.library).toBe('ip');
      expect(vlnv.name).toBe('defaults');
      expect(vlnv.version).toBe('1.0.0');
    });

    it('uses custom VLNV values from options', async () => {
      const result = await writeAndParse(
        'custom.v',
        `
module custom (input wire clk);
endmodule
`,
        { vendor: 'acme', library: 'peripherals', version: '2.1.0' }
      );
      const parsed = yaml.load(result.yamlText) as Record<string, unknown>;
      const vlnv = parsed.vlnv as Record<string, unknown>;

      expect(vlnv.vendor).toBe('acme');
      expect(vlnv.library).toBe('peripherals');
      expect(vlnv.name).toBe('custom');
      expect(vlnv.version).toBe('2.1.0');
    });
  });
});
