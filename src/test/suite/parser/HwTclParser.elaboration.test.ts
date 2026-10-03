import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseHwTclContent } from '../../../parser/HwTclParser';

interface Doc {
  ports?: Array<{ name: string; width?: number | string }>;
  busInterfaces?: Array<{ name: string; portWidthOverrides?: Record<string, number | string> }>;
}

function run(tcl: string): { doc: Doc; warnings: string[] } {
  const r = parseHwTclContent(tcl, '/project/core_hw.tcl');
  return { doc: yaml.load(r.yamlText) as Doc, warnings: r.warnings };
}

const portNames = (doc: Doc): string[] => (doc.ports ?? []).map((p) => p.name);

const CONDUIT = `
  add_interface ctl conduit end
`;

describe('HwTclParser elaboration effects', () => {
  it('static termination removes the port', () => {
    const { doc } = run(`${CONDUIT}
      add_interface_port ctl a a Input 1
      add_interface_port ctl b b Input 1
      set_port_property b termination true
    `);
    expect(portNames(doc)).toEqual(['a']);
  });

  it('elaboration termination false under a true condition restores the port', () => {
    const { doc, warnings } = run(`
      add_parameter EMPTY_WIDTH INTEGER 2
      ${CONDUIT}
      add_interface_port ctl e e Input 1
      set_port_property e termination true
      proc elaborate {} {
        set w [get_parameter_value EMPTY_WIDTH]
        if {$w > 0} {
          set_port_property e WIDTH_EXPR $w
          set_port_property e TERMINATION false
        }
      }
    `);
    expect(doc.ports).toEqual([{ name: 'e', direction: 'in', width: 'EMPTY_WIDTH' }]);
    expect(warnings).toEqual([]);
  });

  it('keeps a terminated port terminated when the condition is false by default', () => {
    const { doc } = run(`
      add_parameter EMPTY_WIDTH INTEGER 0
      ${CONDUIT}
      add_interface_port ctl a a Input 1
      add_interface_port ctl e e Input 1
      set_port_property e termination true
      proc elaborate {} {
        if {[get_parameter_value EMPTY_WIDTH] > 0} {
          set_port_property e TERMINATION false
        }
      }
    `);
    expect(portNames(doc)).toEqual(['a']);
  });

  it('replaces a -1 placeholder with an unconditional WIDTH_EXPR', () => {
    const { doc, warnings } = run(`
      add_parameter ADDRESS_WIDTH INTEGER 32
      ${CONDUIT}
      add_interface_port ctl addr addr Output -1
      proc elaborate {} {
        set_port_property addr WIDTH_EXPR [get_parameter_value ADDRESS_WIDTH]
      }
    `);
    expect(doc.ports).toEqual([{ name: 'addr', direction: 'out', width: 'ADDRESS_WIDTH' }]);
    expect(warnings).toEqual([]);
  });

  it('leaves out a -1 width with a warning when nothing overrides it', () => {
    const { doc, warnings } = run(`${CONDUIT}
      add_interface_port ctl addr addr Output -1
    `);
    expect(doc.ports).toEqual([{ name: 'addr', direction: 'out' }]);
    expect(warnings.some((w) => w.includes('"addr"') && w.includes('-1'))).toBe(true);
  });

  it('resolves a width held in a variable as [ expr $a * $b ]', () => {
    const { doc } = run(`${CONDUIT}
      add_interface_port ctl d d Input 1
      proc elaborate {} {
        set a 4
        set b 8
        set w [ expr $a * $b ]
        set_port_property d WIDTH_EXPR $w
      }
    `);
    expect(doc.ports).toEqual([{ name: 'd', direction: 'in', width: 32 }]);
  });

  it('keeps the static width with a warning when WIDTH_EXPR is unresolvable', () => {
    const { doc, warnings } = run(`${CONDUIT}
      add_interface_port ctl d d Input 4
      proc elaborate {} {
        set_port_property d WIDTH_EXPR [some_proc 3]
      }
    `);
    expect(doc.ports).toEqual([{ name: 'd', direction: 'in', width: 4 }]);
    expect(warnings.some((w) => w.includes('"d"') && w.includes('static width was kept'))).toBe(
      true
    );
  });

  it('drops a port whose width is a parameter defaulting to 0', () => {
    const { doc, warnings } = run(`
      add_parameter CHANNEL_WIDTH INTEGER 0
      ${CONDUIT}
      add_interface_port ctl a a Input 1
      add_interface_port ctl ch ch Input CHANNEL_WIDTH
    `);
    expect(portNames(doc)).toEqual(['a']);
    expect(warnings.some((w) => w.includes('"ch"') && w.includes('CHANNEL_WIDTH'))).toBe(true);
  });

  it('skips a port added under a condition that is false by default', () => {
    const { doc } = run(
      `
      add_parameter W INTEGER 0
      ${CONDUIT}
      add_interface_port ctl a a Input 1
      if { [get_parameter_value W] > 0 } {
        add_interface_port ctl b b Input $W
      }
    `.replace('$W > 0', '[get_parameter_value W] > 0')
    );
    expect(portNames(doc)).toEqual(['a']);
  });

  it('substitutes variables inside conditions', () => {
    const { doc } = run(`
      add_parameter W INTEGER 0
      ${CONDUIT}
      set w [get_parameter_value W]
      if { $w > 0 } {
        add_interface_port ctl b b Input 1
      } else {
        add_interface_port ctl c c Input 1
      }
    `);
    expect(portNames(doc)).toEqual(['c']);
  });

  it('keeps the static declaration and warns for an unevaluable condition', () => {
    const { doc, warnings } = run(`
      add_parameter MODE STRING Full
      ${CONDUIT}
      add_interface_port ctl a a Input 1
      add_interface_port ctl b b Input 1
      set_port_property b TERMINATION true
      proc elaborate {} {
        if { [get_parameter_value MODE] == "Aligned Accesses" } {
          set_port_property b TERMINATION false
        }
      }
    `);
    expect(portNames(doc)).toEqual(['a']);
    expect(warnings.some((w) => w.includes('"b"') && w.includes('could not be evaluated'))).toBe(
      true
    );
  });

  it('warns only for read interface properties whose value stays static', () => {
    const { warnings } = run(`
      add_interface clk clock end
      add_interface_port clk clk clk Input 1
      add_interface sink avalon_streaming end
      add_interface_port sink s_data data Input 8
      set_interface_property sink associatedClock clk
      set_interface_property sink associatedClock [pick_clock]
      set_interface_property sink maxChannel [ expr {2**3} ]
    `);
    expect(warnings.filter((w) => w.includes('associatedClock'))).toHaveLength(1);
    expect(warnings.some((w) => w.includes('maxChannel'))).toBe(false);
  });

  it('applies a proc declared before the static ports', () => {
    const { doc } = run(`
      proc elaborate {} {
        set_port_property b TERMINATION true
      }
      ${CONDUIT}
      add_interface_port ctl a a Input 1
      add_interface_port ctl b b Input 1
    `);
    expect(portNames(doc)).toEqual(['a']);
  });

  it('drops an interface left with no ports', () => {
    const { doc } = run(`
      add_interface ctl conduit end
      add_interface_port ctl a a Input 1
      add_interface keep conduit end
      add_interface_port keep k k Input 1
      set_port_property a TERMINATION true
    `);
    expect(portNames(doc)).toEqual(['k']);
  });

  it('evaluates a dynamic TERMINATION value against parameter defaults', () => {
    const { doc } = run(`
      add_parameter USE_IRQ BOOLEAN false
      add_interface ctl conduit end
      add_interface_port ctl a a Input 1
      add_interface irq conduit end
      add_interface_port irq irq irq Output 1
      proc elaborate {} {
        set_port_property irq TERMINATION [expr ![get_parameter_value USE_IRQ]]
      }
    `);
    expect(portNames(doc)).toEqual(['a']);
  });

  it('keeps the current termination and warns when the value is unresolvable', () => {
    const { doc, warnings } = run(`${CONDUIT}
      add_interface_port ctl a a Input 1
      add_interface_port ctl t t Input 1
      set_port_property t TERMINATION true
      proc elaborate {} {
        set_port_property t TERMINATION $dyn
      }
    `);
    expect(portNames(doc)).toEqual(['a']);
    expect(warnings.some((w) => w.includes('"t"') && w.includes('static termination'))).toBe(true);
  });

  it.each([
    [
      `add_fileset QUARTUS_SYNTH QUARTUS_SYNTH generate_synth
proc generate_synth {n} { add_fileset_file a.v VERILOG PATH a.v }
add_fileset SIM_VERILOG SIM_VERILOG generate_sim
proc generate_sim {n} { add_fileset_file a_tb.v VERILOG PATH a_tb.v }`,
    ],
    [
      `add_fileset QUARTUS_SYNTH QUARTUS_SYNTH generate_synth
proc generate_synth {n} {
  add_fileset_file a.v VERILOG PATH a.v
}
add_fileset SIM_VERILOG SIM_VERILOG generate_sim
proc generate_sim {n} {
  add_fileset_file a_tb.v VERILOG PATH a_tb.v
}`,
    ],
  ])('attaches fileset callback files to the file set current at the proc', (tcl) => {
    const r = parseHwTclContent(tcl, '/project/core_hw.tcl');
    const doc = yaml.load(r.yamlText) as {
      fileSets: Array<{ name: string; files: Array<{ path: string }> }>;
    };
    expect(doc.fileSets.map((f) => [f.name, f.files.map((x) => path.basename(x.path))])).toEqual([
      ['RTL_Sources', ['a.v']],
      ['Simulation_Resources', ['a_tb.v']],
    ]);
  });
});
