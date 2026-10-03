import * as fsPromises from 'fs/promises';
import * as yaml from 'js-yaml';
import { parseHwTclContent, parseHwTclFile } from '../../../parser/HwTclParser';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof fsPromises>('fs/promises');
  return { ...actual, readFile: jest.fn() };
});

const mockReadFile = fsPromises.readFile as jest.Mock;

interface Doc {
  ports?: Array<{ name: string; direction: string; width?: number | string }>;
  clocks?: Array<{ name: string }>;
  resets?: Array<{ name: string }>;
  busInterfaces?: Array<{
    name: string;
    mode: string;
    portWidthOverrides?: Record<string, number | string>;
  }>;
}

function run(tcl: string): { doc: Doc; warnings: string[] } {
  const r = parseHwTclContent(tcl, '/project/core_hw.tcl');
  return { doc: yaml.load(r.yamlText) as Doc, warnings: r.warnings };
}

const widthOf = (doc: Doc, bus: string, logical: string): number | string | undefined =>
  doc.busInterfaces?.find((b) => b.name === bus)?.portWidthOverrides?.[logical];

describe('HwTclParser proc argument defaults', () => {
  const HEADER = `
    add_interface mgmt avalon end
    add_interface mif avalon end
  `;

  it('binds proc defaults when the proc is called without arguments', () => {
    const { doc, warnings } = run(`${HEADER}
      proc xreconf_mgmt_interface { {addr_width 7} } {
        add_interface_port mgmt reconfig_mgmt_address address Input $addr_width
      }
      proc xreconf_mif_interface { {addr_width 24} } {
        add_interface_port mif reconfig_mif_address address Input $addr_width
      }
      xreconf_mgmt_interface
      xreconf_mif_interface
    `);
    expect(widthOf(doc, 'mgmt', 'address')).toBe(7);
    expect(widthOf(doc, 'mif', 'address')).toBe(24);
    expect(warnings).toEqual([]);
  });

  it('does not leak a default into a later proc', () => {
    const { doc, warnings } = run(`${HEADER}
      proc first { {addr_width 7} } {
        add_interface_port mgmt a address Input $addr_width
      }
      proc second {} {
        add_interface_port mif b address Input $addr_width
      }
    `);
    expect(widthOf(doc, 'mgmt', 'address')).toBe(7);
    expect(warnings).toContain(
      'Port "b" on interface "mif": width "$addr_width" could not be resolved and was left out.'
    );
  });

  it('restores a global variable shadowed by a proc default', () => {
    const { doc } = run(`${HEADER}
      set addr_width 5
      proc first { {addr_width 7} } {
        add_interface_port mgmt a address Input $addr_width
      }
      proc second {} {
        add_interface_port mif b address Input $addr_width
      }
    `);
    expect(widthOf(doc, 'mgmt', 'address')).toBe(7);
    expect(widthOf(doc, 'mif', 'address')).toBe(5);
  });

  it('keeps the unresolved warning when the argument is passed at a call site', () => {
    const { warnings } = run(`${HEADER}
      proc add_splitter { {n 4} } {
        add_interface_port mgmt s address Input $n
      }
      add_splitter 8
      add_splitter
    `);
    expect(warnings).toContain(
      'Port "s" on interface "mgmt": width "$n" could not be resolved and was left out.'
    );
  });
});

describe('HwTclParser quoted parameter widths', () => {
  it('imports a quoted get_parameter_value width without quotes', () => {
    const { doc, warnings } = run(`
      add_parameter DATA_WIDTH INTEGER 32
      add_interface in avalon_streaming end
      proc elaborate {} {
        set dw_value [get_parameter_value "DATA_WIDTH"]
        add_interface_port in in_data data Input $dw_value
      }
    `);
    expect(widthOf(doc, 'in', 'data')).toBe('DATA_WIDTH');
    expect(warnings).toEqual([]);
  });
});

describe('HwTclParser log2ceil widths (altera_eth_loopback)', () => {
  const LOG2CEIL = `
    proc log2ceil {num} {

        set val 0
        set i 1
        while {$i < $num} {
            set val [expr $val + 1]
            set i [expr 1 << $val]
        }

        return $val;
    }
  `;
  const BODY = `
    add_parameter SYMBOLS_PER_BEAT INTEGER 8
    add_parameter NUM_OF_INPUT INTEGER 2
    add_parameter EMPTY_WIDTH INTEGER 3
    add_interface ctl avalon end
    add_interface sink avalon_streaming end
    proc elaborate {} {
      set SYMBOLS_PER_BEAT [get_parameter_value SYMBOLS_PER_BEAT]
      set NUM_OF_INPUT [get_parameter_value NUM_OF_INPUT]
      set EMPTY_WIDTH [log2ceil $SYMBOLS_PER_BEAT]
      add_interface_port ctl control_address address Input [log2ceil $NUM_OF_INPUT]
      if { [expr $EMPTY_WIDTH > 0] } {
        add_interface_port sink in_empty_0 empty Input $EMPTY_WIDTH
      }
    }
  `;

  it('rewrites log2ceil to clog2 when the file proc has ceil(log2) semantics', () => {
    const { doc, warnings } = run(BODY + LOG2CEIL);
    expect(widthOf(doc, 'ctl', 'address')).toBe('clog2(NUM_OF_INPUT)');
    expect(widthOf(doc, 'sink', 'empty')).toBe('clog2(SYMBOLS_PER_BEAT)');
    expect(warnings).toEqual([]);
  });

  it('unquotes a quoted log2ceil argument', () => {
    const { doc } = run(
      BODY.replace('[log2ceil $NUM_OF_INPUT]', '[log2ceil "NUM_OF_INPUT"]') + LOG2CEIL
    );
    expect(widthOf(doc, 'ctl', 'address')).toBe('clog2(NUM_OF_INPUT)');
  });

  it('keeps log2ceil unresolved when the file proc differs', () => {
    const { doc, warnings } = run(BODY + LOG2CEIL.replace('set val 0', 'set val 1'));
    expect(widthOf(doc, 'ctl', 'address')).toBeUndefined();
    expect(warnings.some((w) => w.includes('control_address'))).toBe(true);
  });
});

describe('HwTclParser legacy add_port_to_interface', () => {
  const TCL_PATH = '/project/spi/spiphyslave_hw.tcl';
  const TCL = `
    set_source_file "spiphyslave.v"
    set_module "SPIPhy"
    add_interface "clock_sink" "clock" "sink" "asynchronous"
    add_port_to_interface "clock_sink" "sysclk" "clk"
    add_port_to_interface "clock_sink" "nreset" "reset_n"
    add_interface "export_0" "conduit" "start" "asynchronous"
    add_port_to_interface "export_0" "mosi" "export"
    add_port_to_interface "export_0" "miso" "export"
    add_interface "src" "avalon_streaming" "source" "clock_sink"
    add_port_to_interface "src" "stsourcedata" "data"
    add_interface "snk" "avalon_streaming" "sink" "clock_sink"
    add_port_to_interface "snk" "stsinkdata" "data"
    add_port_to_interface "snk" "absent" "valid"
  `;
  const VERILOG = `
module other (input unrelated);
endmodule
module SPIPhy (
  input sysclk,
  input nreset,
  input mosi,
  output miso,
  output [7:0] stsourcedata,
  input [7:0] stsinkdata
);
endmodule
`;

  function mockFiles(files: Record<string, string>): void {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p in files) {
        return files[p];
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });
  }

  beforeEach(() => mockReadFile.mockReset());

  it('resolves directions, widths and modes from the HDL top module', async () => {
    mockFiles({ [TCL_PATH]: TCL, '/project/spi/spiphyslave.v': VERILOG });
    const r = await parseHwTclFile(TCL_PATH);
    const doc = yaml.load(r.yamlText) as Doc;

    expect(doc.clocks?.map((c) => c.name)).toEqual(['sysclk', 'nreset']);
    expect(widthOf(doc, 'src', 'data')).toBe(8);
    expect(widthOf(doc, 'snk', 'data')).toBe(8);
    expect(doc.ports).toEqual([
      { name: 'mosi', direction: 'in' },
      { name: 'miso', direction: 'out' },
    ]);
    const modes = Object.fromEntries((doc.busInterfaces ?? []).map((b) => [b.name, b.mode]));
    expect(modes).toEqual({ src: 'master', snk: 'slave' });
    expect(r.warnings).toEqual([
      'Port "absent" on interface "snk" was not imported: add_port_to_interface declares no direction or width and the port was not found in the HDL source.',
    ]);
  });

  it('warns once when the source file cannot be read', async () => {
    mockFiles({ [TCL_PATH]: TCL });
    const r = await parseHwTclFile(TCL_PATH);
    const unresolved = r.warnings.filter((w) => w.includes('could not be resolved'));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toContain('spiphyslave.v');
  });

  it('warns when set_source_file is missing or not Verilog', async () => {
    mockFiles({ [TCL_PATH]: TCL.replace('set_source_file "spiphyslave.v"', '') });
    const missing = await parseHwTclFile(TCL_PATH);
    expect(missing.warnings.some((w) => w.includes('no set_source_file'))).toBe(true);

    mockFiles({ [TCL_PATH]: TCL.replace('spiphyslave.v', 'spiphyslave.vhd') });
    const vhdl = await parseHwTclFile(TCL_PATH);
    expect(vhdl.warnings.some((w) => w.includes('not Verilog'))).toBe(true);
  });
});
