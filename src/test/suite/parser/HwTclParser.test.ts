import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fsPromises from 'fs/promises';
import {
  parseHwTclContent,
  parseHwTclFile as parseHwTclFileImpl,
  extractSourcePath,
} from '../../../parser/HwTclParser';
import { builtinBusLibrary } from '../../helpers/busLibrary';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof fsPromises>('fs/promises');
  return { ...actual, readFile: jest.fn() };
});

const mockReadFile = fsPromises.readFile as jest.Mock;

const FAKE_PATH = '/project/intel/my_core_hw.tcl';

function parse(content: string, opts?: { library?: string; outputDir?: string }) {
  return parseHwTclContent(content, FAKE_PATH, {
    ...opts,
    busLibrary: builtinBusLibrary(),
  });
}

const parseHwTclFile = (filePath: string, options: { library?: string } = {}) =>
  parseHwTclFileImpl(filePath, { ...options, busLibrary: builtinBusLibrary() });

function parseYaml(content: string) {
  return yaml.load(content) as Record<string, unknown>;
}

describe('HwTclParser', () => {
  describe('module properties', () => {
    it('extracts NAME, VERSION, AUTHOR, DESCRIPTION', () => {
      const tcl = `
        set_module_property NAME my_core
        set_module_property VERSION 2.0.0
        set_module_property AUTHOR "acme.com"
        set_module_property DESCRIPTION "My component"
      `;
      const { componentName, yamlText } = parse(tcl);
      const doc = parseYaml(yamlText) as { vlnv: Record<string, unknown>; description: string };

      expect(componentName).toBe('my_core');
      expect(doc.vlnv.name).toBe('my_core');
      expect(doc.vlnv.version).toBe('2.0.0');
      expect(doc.vlnv.vendor).toBe('acme.com');
      expect(doc.description).toBe('My component');
    });

    it('falls back to filename when NAME is absent', () => {
      const { componentName } = parse('');
      expect(componentName).toBe('my_core');
    });

    it('falls back to resolveVendor when AUTHOR is an empty string', () => {
      const tcl = `
        set_module_property AUTHOR ""
      `;
      // By default parse calls with options={}. resolveVendor(undefined) will return the git domain or 'ipcraft'.
      // We can just check that it does not return ''
      const doc = parseYaml(parse(tcl).yamlText) as { vlnv: Record<string, unknown> };
      expect(doc.vlnv.vendor).not.toBe('');
      expect(doc.vlnv.vendor).toBeTruthy();
    });

    it('uses library option', () => {
      const tcl = 'set_module_property NAME core';
      const doc = parseYaml(parse(tcl, { library: 'my_lib' }).yamlText) as {
        vlnv: Record<string, unknown>;
      };
      expect(doc.vlnv.library).toBe('my_lib');
    });
  });

  describe('clock and reset interfaces', () => {
    it('emits clock with direction:in', () => {
      const tcl = `
        add_interface clk clock end
        add_interface_port clk s_axi_aclk clk Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        clocks: Array<Record<string, unknown>>;
      };
      expect(doc.clocks).toHaveLength(1);
      expect(doc.clocks[0].name).toBe('s_axi_aclk');
      expect(doc.clocks[0].direction).toBe('in');
    });

    it('detects active-low reset via synchronousEdges DEASSERT', () => {
      const tcl = `
        add_interface reset reset end
        set_interface_property reset synchronousEdges DEASSERT
        add_interface_port reset s_axi_aresetn reset Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        resets: Array<Record<string, unknown>>;
      };
      expect(doc.resets[0].polarity).toBe('activeLow');
    });

    it('detects active-low reset via port name ending in n', () => {
      const tcl = `
        add_interface rst reset end
        add_interface_port rst rst_n reset Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        resets: Array<Record<string, unknown>>;
      };
      expect(doc.resets[0].polarity).toBe('activeLow');
    });

    it('detects active-high reset', () => {
      const tcl = `
        add_interface rst reset end
        add_interface_port rst rst reset Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        resets: Array<Record<string, unknown>>;
      };
      expect(doc.resets[0].polarity).toBe('activeHigh');
    });
  });

  describe('bus interfaces', () => {
    it('maps axi4lite to VLNV type and slave mode', () => {
      const tcl = `
        add_interface s_axi axi4lite end
        add_interface_port s_axi s_axi_awaddr awaddr Input 4
        add_interface_port s_axi s_axi_awvalid awvalid Input 1
        add_interface_port s_axi s_axi_wdata wdata Input 32
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      const bi = doc.busInterfaces[0];
      expect(bi.type).toBe('ipcraft:busif:axi4_lite:1.0');
      expect(bi.mode).toBe('slave');
      expect(bi.physicalPrefix).toBe('s_axi_');
    });

    it('maps avalon to VLNV type', () => {
      const tcl = `
        add_interface avl avalon end
        add_interface_port avl avl_address address Input 8
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      expect(doc.busInterfaces[0].type).toBe('ipcraft:busif:avalon_mm:1.0');
    });

    it.each([
      ['true', 'big'],
      ['false', 'little'],
    ])('maps Avalon-ST firstSymbolInHighOrderBits %s to %s endianness', (value, expected) => {
      const tcl = `
        add_interface stream_out avalon_streaming start
        set_interface_property stream_out firstSymbolInHighOrderBits ${value}
        add_interface_port stream_out data data Output 32
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };

      expect(doc.busInterfaces[0].endianness).toBe(expected);
    });

    it('emits portNameOverrides for two Avalon-ST sinks sharing one physicalPrefix (multi-instance)', () => {
      const tcl = `
        add_interface asi_0 avalon_streaming end
        add_interface_port asi_0 asi_valid_0_i valid Input 1
        add_interface_port asi_0 asi_data_0_i data Input 32
        add_interface asi_1 avalon_streaming end
        add_interface_port asi_1 asi_valid_1_i valid Input 1
        add_interface_port asi_1 asi_data_1_i data Input 32
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };

      expect(doc.busInterfaces).toHaveLength(2);
      const [sink0, sink1] = doc.busInterfaces;

      expect(sink0.type).toBe('ipcraft:busif:avalon_st:1.0');
      expect(sink0.physicalPrefix).toBe('asi_');
      expect(sink1.physicalPrefix).toBe('asi_');

      // Lossless suffix overrides let physicalPrefix + suffix reconstruct the exact
      // physical port name, keyed in Avalon-ST's canonical lowercase casing.
      expect(sink0.portNameOverrides).toEqual({ valid: 'valid_0_i', data: 'data_0_i' });
      expect(sink1.portNameOverrides).toEqual({ valid: 'valid_1_i', data: 'data_1_i' });
    });

    it('preserves logical polarity and literal physical suffix independently', () => {
      const tcl = `
        add_interface avs avalon end
        add_interface_port avs avs_byteenable byteenable_n Input 2
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };

      expect(doc.busInterfaces[0]).toMatchObject({
        physicalPrefix: 'avs_',
        useOptionalPorts: ['byteenable'],
        portWidthOverrides: { byteenable: 2 },
        portNameOverrides: { byteenable: 'byteenable' },
        portPolarityOverrides: { byteenable: 'activeLow' },
      });
    });

    it('maps start mode to master', () => {
      const tcl = `
        add_interface m_axi axi4lite start
        add_interface_port m_axi m_axi_awaddr awaddr Output 32
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      expect(doc.busInterfaces[0].mode).toBe('master');
    });

    it('resolves associatedClock and associatedReset to RTL port names', () => {
      const tcl = `
        add_interface clk clock end
        add_interface_port clk s_axi_aclk clk Input 1
        add_interface reset reset end
        add_interface_port reset s_axi_aresetn reset Input 1
        add_interface s_axi axi4lite end
        set_interface_property s_axi associatedClock clk
        set_interface_property s_axi associatedReset reset
        add_interface_port s_axi s_axi_awaddr awaddr Input 4
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      expect(doc.busInterfaces[0].associatedClock).toBe('s_axi_aclk');
      expect(doc.busInterfaces[0].associatedReset).toBe('s_axi_aresetn');
    });

    it('uses slave/master mode for streaming interfaces', () => {
      const tcl = `
        add_interface axis_in axi4stream end
        add_interface_port axis_in in_tdata tdata Input 8
        add_interface axis_out axi4stream start
        add_interface_port axis_out out_tdata tdata Output 8
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      expect(doc.busInterfaces[0].mode).toBe('slave');
      expect(doc.busInterfaces[1].mode).toBe('master');
    });

    it('emits useOptionalPorts for optional ports present in hw.tcl', () => {
      const tcl = `
        add_interface s_axi axi4 end
        add_interface_port s_axi s_axi_awaddr awaddr Input 32
        add_interface_port s_axi s_axi_awvalid awvalid Input 1
        add_interface_port s_axi s_axi_awready awready Output 1
        add_interface_port s_axi s_axi_awprot awprot Input 3
        add_interface_port s_axi s_axi_awlen awlen Input 8
        add_interface_port s_axi s_axi_wdata wdata Input 32
        add_interface_port s_axi s_axi_wstrb wstrb Input 4
        add_interface_port s_axi s_axi_wvalid wvalid Input 1
        add_interface_port s_axi s_axi_wready wready Output 1
        add_interface_port s_axi s_axi_bresp bresp Output 2
        add_interface_port s_axi s_axi_bvalid bvalid Output 1
        add_interface_port s_axi s_axi_bready bready Input 1
        add_interface_port s_axi s_axi_araddr araddr Input 32
        add_interface_port s_axi s_axi_arvalid arvalid Input 1
        add_interface_port s_axi s_axi_arready arready Output 1
        add_interface_port s_axi s_axi_arprot arprot Input 3
        add_interface_port s_axi s_axi_rdata rdata Output 32
        add_interface_port s_axi s_axi_rresp rresp Output 2
        add_interface_port s_axi s_axi_rvalid rvalid Output 1
        add_interface_port s_axi s_axi_rready rready Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      const bi = doc.busInterfaces[0];
      expect(bi.useOptionalPorts).toEqual(['AWLEN']);
    });

    it('does not emit useOptionalPorts when only required ports are present', () => {
      const tcl = `
        add_interface s_axi axi4lite end
        add_interface_port s_axi s_axi_awaddr awaddr Input 32
        add_interface_port s_axi s_axi_awvalid awvalid Input 1
        add_interface_port s_axi s_axi_awready awready Output 1
        add_interface_port s_axi s_axi_wdata wdata Input 32
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      expect(doc.busInterfaces[0].useOptionalPorts).toBeUndefined();
    });

    it('emits useOptionalPorts for AXI-Stream optional ports', () => {
      const tcl = `
        add_interface m_axis axi4stream start
        add_interface_port m_axis m_axis_tdata tdata Output 32
        add_interface_port m_axis m_axis_tvalid tvalid Output 1
        add_interface_port m_axis m_axis_tready tready Input 1
        add_interface_port m_axis m_axis_tlast tlast Output 1
        add_interface_port m_axis m_axis_tkeep tkeep Output 4
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      const bi = doc.busInterfaces[0];
      const optPorts = bi.useOptionalPorts as string[];
      expect(optPorts).toContain('TLAST');
      expect(optPorts).toContain('TKEEP');
    });

    it('omits write and writedata from useOptionalPorts for a read-only Avalon MM slave', () => {
      // All Avalon MM ports are optional per spec; the parser must only include
      // ports that are actually present in the hw.tcl in useOptionalPorts.
      const tcl = `
        add_interface avl avalon end
        add_interface_port avl avl_address  address  Input  8
        add_interface_port avl avl_read     read     Input  1
        add_interface_port avl avl_rdata    readdata Output 32
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      const bi = doc.busInterfaces[0];
      const useOptionalPorts = bi.useOptionalPorts as string[];
      expect(useOptionalPorts).toContain('address');
      expect(useOptionalPorts).toContain('read');
      expect(useOptionalPorts).toContain('readdata');
      expect(useOptionalPorts).not.toContain('write');
      expect(useOptionalPorts).not.toContain('writedata');
      expect(bi.absentPorts).toBeUndefined();
    });
  });

  describe('conduit (user ports)', () => {
    it('emits ports from conduit interface with correct direction and width', () => {
      const tcl = `
        add_interface conduit conduit end
        add_interface_port conduit out_port out_port Output 8
        add_interface_port conduit enable enable Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        ports: Array<Record<string, unknown>>;
      };
      expect(doc.ports).toHaveLength(2);
      expect(doc.ports[0]).toMatchObject({ name: 'out_port', direction: 'out', width: 8 });
      expect(doc.ports[1]).toMatchObject({ name: 'enable', direction: 'in' });
      expect(doc.ports[1].width).toBeUndefined();
    });

    it('maps Bidir direction to inout', () => {
      const tcl = `
        add_interface conduit conduit end
        add_interface_port conduit data data Bidir 8
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        ports: Array<Record<string, unknown>>;
      };
      expect(doc.ports[0].direction).toBe('inout');
    });

    it('parses a parameter-dependent width declared via [get_parameter_value PARAM]', () => {
      // Quartus (and our own generator) place parameter-width ports inside the
      // elaborate callback: `add_interface_port iface port logical Input [get_parameter_value W]`.
      const tcl = `
        add_interface data conduit end
        add_parameter DATA_WIDTH INTEGER 32
        proc elaborate {} {
            add_interface_port data data data Input [get_parameter_value DATA_WIDTH]
        }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        ports: Array<Record<string, unknown>>;
      };
      expect(doc.ports).toHaveLength(1);
      expect(doc.ports[0]).toMatchObject({
        name: 'data',
        direction: 'in',
        width: 'DATA_WIDTH',
      });
    });

    it('resolves a parameter value assigned to a Tcl variable', () => {
      const tcl = `
        add_interface data conduit end
        add_parameter DATA_WIDTH INTEGER 32
        proc elaborate {} {
            set dataWidth [get_parameter_value DATA_WIDTH]
            add_interface_port data data data Input $dataWidth
        }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        ports: Array<Record<string, unknown>>;
      };

      expect(doc.ports).toHaveLength(1);
      expect(doc.ports[0]).toMatchObject({
        name: 'data',
        direction: 'in',
        width: 'DATA_WIDTH',
      });
    });

    it('resolves braced and embedded Tcl variable references', () => {
      const tcl = `
        add_interface data conduit end
        add_parameter DATA_WIDTH INTEGER 32
        proc elaborate {} {
            set dataWidth [get_parameter_value DATA_WIDTH]
            add_interface_port data data data Input "\${dataWidth} * 2"
            add_interface_port data strobe strobe Input $dataWidth/8
        }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        ports: Array<Record<string, unknown>>;
      };

      expect(doc.ports).toHaveLength(2);
      expect(doc.ports[0].width).toBe('DATA_WIDTH * 2');
      expect(doc.ports[1].width).toBe('DATA_WIDTH/8');
    });

    it('does not substitute braced, escaped, or unknown Tcl variable references', () => {
      const tcl = `
        add_interface data conduit end
        set dataWidth [get_parameter_value DATA_WIDTH]
        add_interface_port data braced braced Input {$dataWidth}
        add_interface_port data escaped escaped Input "\\$dataWidth"
        add_interface_port data unknown unknown Input $missingWidth
      `;
      const result = parse(tcl);
      const doc = parseYaml(result.yamlText) as {
        ports: Array<Record<string, unknown>>;
      };

      // No substitution happened, and unresolved widths are never written (#212).
      expect(doc.ports).toHaveLength(3);
      expect(doc.ports.every((port) => !('width' in port))).toBe(true);
      expect(result.warnings).toHaveLength(3);
      expect(result.warnings[0]).toContain('"$dataWidth"');
      expect(result.warnings[1]).toContain('"$dataWidth"');
      expect(result.warnings[2]).toContain('"$missingWidth"');
    });
  });

  describe('interrupts', () => {
    it('interrupt sender (end + Output port) emits direction:out', () => {
      const tcl = `
        add_interface interrupt interrupt end
        add_interface_port interrupt AvIrq_o irq Output 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        interrupts: Array<Record<string, unknown>>;
      };
      expect(doc.interrupts).toHaveLength(1);
      expect(doc.interrupts[0]).toMatchObject({ name: 'AvIrq_o', direction: 'out' });
    });

    it('interrupt receiver (start + Input port) emits direction:in', () => {
      const tcl = `
        add_interface irq_in interrupt start
        add_interface_port irq_in irq_in irq Input 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        interrupts: Array<Record<string, unknown>>;
      };
      expect(doc.interrupts).toHaveLength(1);
      expect(doc.interrupts[0]).toMatchObject({ name: 'irq_in', direction: 'in' });
    });

    it('handles sender and receiver in the same component', () => {
      const tcl = `
        add_interface irq_in interrupt start
        add_interface_port irq_in irq_in irq Input 1
        add_interface irq interrupt end
        add_interface_port irq irq irq Output 1
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        interrupts: Array<Record<string, unknown>>;
      };
      expect(doc.interrupts).toHaveLength(2);
      expect(doc.interrupts[0]).toMatchObject({ name: 'irq_in', direction: 'in' });
      expect(doc.interrupts[1]).toMatchObject({ name: 'irq', direction: 'out' });
    });
  });

  describe('file sets', () => {
    it('maps QUARTUS_SYNTH to RTL_Sources with correct relative paths', () => {
      const tcl = `
        add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
        add_fileset_file core.vhd VHDL PATH ../rtl/core.vhd TOP_LEVEL_FILE
      `;
      // outputDir defaults to same dir as hw.tcl (/project/intel/)
      const doc = parseYaml(parse(tcl).yamlText) as {
        fileSets: Array<Record<string, unknown>>;
      };
      expect(doc.fileSets[0].name).toBe('RTL_Sources');
      const files = doc.fileSets[0].files as Array<{ path: string; type: string }>;
      expect(files[0].path).toBe(path.join('..', 'rtl', 'core.vhd'));
      expect(files[0].type).toBe('vhdl');
    });

    it('maps SIM_VHDL to Simulation_Resources and deduplicates with SIM_VERILOG', () => {
      const tcl = `
        add_fileset SIM_VHDL SIM_VHDL "" ""
        add_fileset_file tb.vhd VHDL PATH ../tb/tb.vhd
        add_fileset SIM_VERILOG SIM_VERILOG "" ""
        add_fileset_file tb.v VERILOG PATH ../tb/tb.v
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        fileSets: Array<Record<string, unknown>>;
      };
      const simSets = (doc.fileSets ?? []).filter(
        (fs: Record<string, unknown>) => fs.name === 'Simulation_Resources'
      );
      expect(simSets).toHaveLength(1);
    });

    it('recomputes paths relative to a custom outputDir', () => {
      const tcl = `
        add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
        add_fileset_file core.vhd VHDL PATH ../rtl/core.vhd
      `;
      // outputDir = parent of intel/ → /project/
      const doc = parseYaml(parse(tcl, { outputDir: '/project' }).yamlText) as {
        fileSets: Array<Record<string, unknown>>;
      };
      const files = doc.fileSets[0].files as Array<{ path: string }>;
      expect(files[0].path).toBe(path.join('rtl', 'core.vhd'));
    });
  });

  describe('parameters', () => {
    it('emits parameters with parsed numeric defaults', () => {
      const tcl = `
        add_parameter C_DATA_WIDTH INTEGER 32
        add_parameter C_ADDR_WIDTH INTEGER 4
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters).toHaveLength(2);
      expect(doc.parameters[0]).toMatchObject({
        name: 'C_DATA_WIDTH',
        value: 32,
        dataType: 'integer',
      });
    });

    it('respects set_parameter_property DEFAULT_VALUE override', () => {
      const tcl = `
        add_parameter C_WIDTH INTEGER 8
        set_parameter_property C_WIDTH DEFAULT_VALUE 16
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0].value).toBe(16);
    });

    it('parses DESCRIPTION property', () => {
      const tcl = `
        add_parameter C_WIDTH INTEGER 8
        set_parameter_property C_WIDTH DESCRIPTION "The width of the data bus"
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0].description).toBe('The width of the data bus');
    });

    it('normalizes non-canonical numeric parameter types to schema-allowed dataTypes', () => {
      const tcl = `
        add_parameter CLOCK_DIV INTEGER 2
        add_parameter ADDR_WIDTH POSITIVE 8
        add_parameter DATA_WIDTH NATURAL 16
        add_parameter ENABLE BOOLEAN true
        add_parameter NAME STRING foo
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      // POSITIVE/NATURAL collapse to the non-negative canonical type `natural`;
      // the schema's ParameterType enum has no `positive`.
      expect(doc.parameters.map((p) => p.dataType)).toEqual([
        'integer',
        'natural',
        'natural',
        'boolean',
        'string',
      ]);
    });

    it('recovers uiPage and uiGroup from nested display items', () => {
      const tcl = `
        add_parameter DATA_WIDTH INTEGER 32
        add_parameter MODE STRING "fast"
        add_display_item "" "Configuration" GROUP
        add_display_item "Configuration" "MODE" PARAMETER
        add_display_item "Configuration" "Widths" GROUP
        add_display_item "Widths" "DATA_WIDTH" PARAMETER
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0]).toMatchObject({ uiPage: 'Configuration', uiGroup: 'Widths' });
      expect(doc.parameters[1]).toMatchObject({ uiPage: 'Configuration' });
      expect(doc.parameters[1].uiGroup).toBeUndefined();
    });

    it('recovers authored labels from synthetic display-item ids', () => {
      const tcl = `
        add_parameter A INTEGER 1
        add_parameter B INTEGER 2
        add_display_item "" "ipcraft_page_0" GROUP tab
        set_display_item_property "ipcraft_page_0" DISPLAY_NAME "Config"
        add_display_item "ipcraft_page_0" "ipcraft_group_0_0" GROUP ""
        set_display_item_property "ipcraft_group_0_0" DISPLAY_NAME "Advanced"
        add_display_item "ipcraft_group_0_0" "A" PARAMETER
        add_display_item "" "ipcraft_page_1" GROUP tab
        set_display_item_property "ipcraft_page_1" DISPLAY_NAME "Timing"
        add_display_item "ipcraft_page_1" "ipcraft_group_1_0" GROUP ""
        set_display_item_property "ipcraft_group_1_0" DISPLAY_NAME "Advanced"
        add_display_item "ipcraft_group_1_0" "B" PARAMETER
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0]).toMatchObject({ uiPage: 'Config', uiGroup: 'Advanced' });
      expect(doc.parameters[1]).toMatchObject({ uiPage: 'Timing', uiGroup: 'Advanced' });
    });

    it('leaves a root-level display item unplaced', () => {
      const tcl = `
        add_parameter DATA_WIDTH INTEGER 32
        add_display_item "" "DATA_WIDTH" PARAMETER
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0].uiPage).toBeUndefined();
      expect(doc.parameters[0].uiGroup).toBeUndefined();
    });

    it('splits the legacy slash-joined GROUP property when there are no display items', () => {
      const tcl = `
        add_parameter DATA_WIDTH INTEGER 32
        add_parameter MODE STRING "fast"
        set_parameter_property DATA_WIDTH GROUP "Configuration/Widths"
        set_parameter_property MODE GROUP "Advanced"
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0]).toMatchObject({ uiPage: 'Configuration', uiGroup: 'Widths' });
      expect(doc.parameters[1]).toMatchObject({ uiPage: 'Advanced' });
    });

    it('parses ALLOWED_RANGES as min/max or discrete choices', () => {
      const tcl = `
        add_parameter ADDR_WIDTH INTEGER 32
        add_parameter DATA_WIDTH INTEGER 32
        add_parameter VENDOR STRING "ALTERA"
        set_parameter_property ADDR_WIDTH ALLOWED_RANGES 16:64
        set_parameter_property DATA_WIDTH ALLOWED_RANGES { 8 16 32 }
        set_parameter_property VENDOR ALLOWED_RANGES { "ALTERA" "XILINX" }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0]).toMatchObject({ min: 16, max: 64 });
      expect(doc.parameters[1]).toMatchObject({ allowedValues: [8, 16, 32] });
      expect(doc.parameters[2]).toMatchObject({ allowedValues: ['ALTERA', 'XILINX'] });
    });

    it('keeps a quoted ALLOWED_RANGES choice containing spaces as one value', () => {
      const tcl = `
        add_parameter MODE STRING "Fast Mode"
        set_parameter_property MODE ALLOWED_RANGES { "Fast Mode" "Low Power" }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0]).toMatchObject({ allowedValues: ['Fast Mode', 'Low Power'] });
    });

    it('parses [list ...] ALLOWED_RANGES and warns on other command substitutions', () => {
      const tcl = `
        add_parameter W INTEGER 8
        add_parameter S STRING "01"
        add_parameter X INTEGER 8
        set_parameter_property W ALLOWED_RANGES [list 8 16 32]
        set_parameter_property S ALLOWED_RANGES [list "01" "1"]
        set_parameter_property X ALLOWED_RANGES [get_choices]
      `;
      const result = parse(tcl);
      const doc = parseYaml(result.yamlText) as { parameters: Array<Record<string, unknown>> };
      expect(doc.parameters[0].allowedValues).toEqual([8, 16, 32]);
      expect(doc.parameters[1].allowedValues).toEqual(['01', '1']);
      expect(doc.parameters[2].allowedValues).toBeUndefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Parameter "X"');
    });

    it('resolves [file join ...] fileset paths and drops unresolved ones with a warning', () => {
      const tcl = `
        add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" "Quartus Synthesis"
        add_fileset_file a.vhd VHDL PATH [file join .. ../rtl/a.vhd]
        add_fileset_file b.vhd VHDL PATH [file join .. ../rtl/b.vhd] TOP_LEVEL_FILE
        add_fileset_file c.vhd VHDL PATH [get_path c]
      `;
      const result = parse(tcl);
      const doc = parseYaml(result.yamlText) as {
        fileSets: Array<{ files: Array<{ path: string }> }>;
      };
      expect(doc.fileSets[0].files.map((f) => f.path)).toEqual([
        path.relative(
          path.dirname(FAKE_PATH),
          path.resolve(path.dirname(FAKE_PATH), '../../rtl/a.vhd')
        ),
        path.relative(
          path.dirname(FAKE_PATH),
          path.resolve(path.dirname(FAKE_PATH), '../../rtl/b.vhd')
        ),
      ]);
      expect(result.warnings).toEqual([
        'File "[get_path c]" in file set "QUARTUS_SYNTH" was not imported: its path uses Tcl that could not be resolved.',
      ]);
    });

    it('unescapes quotes and braces in string ALLOWED_RANGES choices', () => {
      const tcl = `
        add_parameter MODE STRING "Fast Mode"
        set_parameter_property MODE ALLOWED_RANGES { "He said \\"yes\\"" "A\\}B" }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0]).toMatchObject({ allowedValues: ['He said "yes"', 'A}B'] });
    });

    it('keeps numeric-looking ALLOWED_RANGES choices as strings for a STRING parameter', () => {
      const tcl = `
        add_parameter CODE STRING "01"
        set_parameter_property CODE ALLOWED_RANGES { "01" "1" }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0].dataType).toBe('string');
      expect(doc.parameters[0].value).toBe('01');
      expect(doc.parameters[0].allowedValues).toEqual(['01', '1']);
    });

    it('still coerces numeric-looking ALLOWED_RANGES choices for a non-STRING parameter', () => {
      const tcl = `
        add_parameter DATA_WIDTH INTEGER 32
        set_parameter_property DATA_WIDTH ALLOWED_RANGES { 8 16 32 }
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0].allowedValues).toEqual([8, 16, 32]);
    });

    it('keeps an authored DISPLAY_NAME but drops a generated title-cased one', () => {
      const tcl = `
        add_parameter DATA_WIDTH INTEGER 32
        add_parameter ADDR_WIDTH INTEGER 8
        set_parameter_property DATA_WIDTH DISPLAY_NAME "Data Bus Width"
        set_parameter_property ADDR_WIDTH DISPLAY_NAME "Addr Width"
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        parameters: Array<Record<string, unknown>>;
      };
      expect(doc.parameters[0].displayName).toBe('Data Bus Width');
      expect(doc.parameters[1].displayName).toBeUndefined();
    });
  });

  describe('full pio_core_axil example', () => {
    it('produces the expected structure from a representative hw.tcl', () => {
      const tcl = `
        set_module_property NAME pio_core_axil
        set_module_property VERSION 1.0.0
        set_module_property AUTHOR "ipcraft"
        set_module_property DESCRIPTION "AXI4-Lite PIO Core"

        add_interface clk clock end
        add_interface_port clk clk clk Input 1

        add_interface reset reset end
        set_interface_property reset synchronousEdges DEASSERT
        add_interface_port reset s_axi_aresetn reset Input 1

        add_interface s_axi axi4lite end
        set_interface_property s_axi associatedClock clk
        set_interface_property s_axi associatedReset reset
        add_interface_port s_axi s_axi_awaddr awaddr Input 4
        add_interface_port s_axi s_axi_awvalid awvalid Input 1
        add_interface_port s_axi s_axi_awready awready Output 1
        add_interface_port s_axi s_axi_wdata wdata Input 32
        add_interface_port s_axi s_axi_wstrb wstrb Input 4
        add_interface_port s_axi s_axi_wvalid wvalid Input 1
        add_interface_port s_axi s_axi_wready wready Output 1

        add_interface conduit conduit end
        add_interface_port conduit out_port out_port Output 8

        add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
        add_fileset_file pio_core_axil.vhd VHDL PATH ../rtl/pio_core_axil.vhd TOP_LEVEL_FILE
      `;

      const doc = parseYaml(parse(tcl).yamlText);
      const vlnv = doc.vlnv as Record<string, unknown>;

      expect(vlnv.vendor).toBe('ipcraft');
      expect(vlnv.name).toBe('pio_core_axil');
      expect(vlnv.version).toBe('1.0.0');

      const clocks = doc.clocks as Array<Record<string, unknown>>;
      expect(clocks[0].name).toBe('clk');

      const resets = doc.resets as Array<Record<string, unknown>>;
      expect(resets[0].name).toBe('s_axi_aresetn');
      expect(resets[0].polarity).toBe('activeLow');

      const ports = doc.ports as Array<Record<string, unknown>>;
      expect(ports[0]).toMatchObject({ name: 'out_port', direction: 'out', width: 8 });

      const bi = (doc.busInterfaces as Array<Record<string, unknown>>)[0];
      expect(bi.type).toBe('ipcraft:busif:axi4_lite:1.0');
      expect(bi.mode).toBe('slave');
      expect(bi.physicalPrefix).toBe('s_axi_');
      expect(bi.associatedClock).toBe('clk');
      expect(bi.associatedReset).toBe('s_axi_aresetn');

      const fs = (doc.fileSets as Array<Record<string, unknown>>)[0];
      expect(fs.name).toBe('RTL_Sources');
    });
  });
});

// ── extractSourcePath ─────────────────────────────────────────────────────────

describe('extractSourcePath', () => {
  it('returns null for non-source lines', () => {
    expect(extractSourcePath('')).toBeNull();
    expect(extractSourcePath('set_module_property NAME core')).toBeNull();
    expect(extractSourcePath('add_fileset_file core.vhd VHDL PATH rtl/core.vhd')).toBeNull();
  });

  it('parses a double-quoted path', () => {
    expect(extractSourcePath('source "sub.tcl"')).toBe('sub.tcl');
    expect(extractSourcePath('  source "path/to/file.tcl"')).toBe('path/to/file.tcl');
  });

  it('parses a braced path', () => {
    expect(extractSourcePath('source {sub.tcl}')).toBe('sub.tcl');
    expect(extractSourcePath('source {path/to/sub.tcl}')).toBe('path/to/sub.tcl');
  });

  it('parses a plain unquoted path', () => {
    expect(extractSourcePath('source sub.tcl')).toBe('sub.tcl');
    expect(extractSourcePath('source ./sub.tcl')).toBe('./sub.tcl');
    expect(extractSourcePath('source ../other/sub.tcl')).toBe('../other/sub.tcl');
  });

  it('parses [file join [file dirname [info script]] single-component]', () => {
    expect(extractSourcePath('source [file join [file dirname [info script]] sub.tcl]')).toBe(
      'sub.tcl'
    );
  });

  it('parses [file join [file dirname [info script]] quoted-component]', () => {
    expect(extractSourcePath('source [file join [file dirname [info script]] "sub.tcl"]')).toBe(
      'sub.tcl'
    );
  });

  it('parses [file join [file dirname [info script]] multi-component]', () => {
    expect(
      extractSourcePath('source [file join [file dirname [info script]] subdir file.tcl]')
    ).toBe(path.join('subdir', 'file.tcl'));
  });

  it('returns null for variable substitutions', () => {
    expect(extractSourcePath('source $script_dir/sub.tcl')).toBeNull();
    expect(extractSourcePath('source ${MY_DIR}/sub.tcl')).toBeNull();
  });

  it('returns null for unresolvable command substitutions', () => {
    expect(extractSourcePath('source [some_proc args]')).toBeNull();
  });
});

// ── parseHwTclFile – source directive handling ────────────────────────────────

describe('parseHwTclFile (source directive)', () => {
  const MAIN_PATH = '/project/intel/my_core_hw.tcl';

  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it('inlines fileset files declared in a sourced sibling file', async () => {
    const mainTcl = `
      set_module_property NAME my_core
      source "sub.tcl"
    `;
    const subTcl = `
      add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
      add_fileset_file core.vhd VHDL PATH ../rtl/core.vhd TOP_LEVEL_FILE
    `;

    mockReadFile.mockImplementation(async (p: string) => {
      if (p === MAIN_PATH) {
        return mainTcl;
      }
      if (p === '/project/intel/sub.tcl') {
        return subTcl;
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });

    const { componentName, yamlText } = await parseHwTclFile(MAIN_PATH);
    const doc = yaml.load(yamlText) as Record<string, unknown>;

    expect(componentName).toBe('my_core');
    const fileSets = doc.fileSets as Array<Record<string, unknown>>;
    expect(fileSets).toHaveLength(1);
    expect(fileSets[0].name).toBe('RTL_Sources');
    const files = fileSets[0].files as Array<{ path: string }>;
    expect(files[0].path).toBe(path.join('..', 'rtl', 'core.vhd'));
  });

  it('normalizes paths from a sourced file in a subdirectory', async () => {
    // Sub file lives in /project/intel/sub/ — its ../rtl/ refers to /project/intel/rtl/
    const subPath = '/project/intel/sub/interfaces.tcl';
    const mainTcl = `
      set_module_property NAME my_core
      source "sub/interfaces.tcl"
    `;
    const subTcl = `
      add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
      add_fileset_file core.vhd VHDL PATH ../rtl/core.vhd TOP_LEVEL_FILE
    `;

    mockReadFile.mockImplementation(async (p: string) => {
      if (p === MAIN_PATH) {
        return mainTcl;
      }
      if (p === subPath) {
        return subTcl;
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });

    const { yamlText } = await parseHwTclFile(MAIN_PATH);
    const doc = yaml.load(yamlText) as Record<string, unknown>;
    const files = (doc.fileSets as Array<Record<string, unknown>>)[0].files as Array<{
      path: string;
    }>;

    // ../rtl/core.vhd from /project/intel/sub/ → /project/intel/rtl/core.vhd
    // relative to /project/intel/ (tclDir of main) → rtl/core.vhd
    expect(files[0].path).toBe(path.join('rtl', 'core.vhd'));
  });

  it('handles nested sourced files (A sources B which sources C)', async () => {
    const subPath = '/project/intel/sub.tcl';
    const subSubPath = '/project/intel/subsub.tcl';

    mockReadFile.mockImplementation(async (p: string) => {
      if (p === MAIN_PATH) {
        return 'source "sub.tcl"';
      }
      if (p === subPath) {
        return 'source "subsub.tcl"';
      }
      if (p === subSubPath) {
        return `
          add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
          add_fileset_file deep.vhd VHDL PATH rtl/deep.vhd
        `;
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });

    const { yamlText } = await parseHwTclFile(MAIN_PATH);
    const doc = yaml.load(yamlText) as Record<string, unknown>;
    const fileSets = doc.fileSets as Array<Record<string, unknown>>;
    expect(fileSets).toHaveLength(1);
    expect(fileSets[0].name).toBe('RTL_Sources');
  });

  it('does not hang or throw on circular source references', async () => {
    // Main sources itself — cycle detection must prevent infinite recursion
    const mainTcl = `
      set_module_property NAME circ_core
      source "my_core_hw.tcl"
      add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
      add_fileset_file core.vhd VHDL PATH rtl/core.vhd
    `;

    mockReadFile.mockImplementation(async (p: string) => {
      if (p === MAIN_PATH) {
        return mainTcl;
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });

    const { yamlText } = await parseHwTclFile(MAIN_PATH);
    const doc = yaml.load(yamlText) as Record<string, unknown>;
    // The fileset from the root level must still be parsed
    expect(doc.fileSets).toBeDefined();
  });

  it('silently skips inaccessible sourced files and continues parsing', async () => {
    const mainTcl = `
      set_module_property NAME my_core
      source "nonexistent.tcl"
      add_fileset QUARTUS_SYNTH QUARTUS_SYNTH "" ""
      add_fileset_file core.vhd VHDL PATH rtl/core.vhd
    `;

    mockReadFile.mockImplementation(async (p: string) => {
      if (p === MAIN_PATH) {
        return mainTcl;
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });

    const { componentName, yamlText } = await parseHwTclFile(MAIN_PATH);
    const doc = yaml.load(yamlText) as Record<string, unknown>;
    expect(componentName).toBe('my_core');
    const files = (doc.fileSets as Array<Record<string, unknown>>)[0].files as Array<{
      path: string;
    }>;
    expect(files[0].path).toBe(path.join('rtl', 'core.vhd'));
  });

  it('merges module properties from main and sourced files', async () => {
    const mainTcl = `
      set_module_property NAME my_core
      source "ifaces.tcl"
    `;
    const ifacesTcl = `
      add_interface clk clock end
      add_interface_port clk s_axi_aclk clk Input 1
    `;

    mockReadFile.mockImplementation(async (p: string) => {
      if (p === MAIN_PATH) {
        return mainTcl;
      }
      if (p === '/project/intel/ifaces.tcl') {
        return ifacesTcl;
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    });

    const { yamlText } = await parseHwTclFile(MAIN_PATH);
    const doc = yaml.load(yamlText) as Record<string, unknown>;
    const clocks = doc.clocks as Array<Record<string, unknown>>;
    expect(clocks).toHaveLength(1);
    expect(clocks[0].name).toBe('s_axi_aclk');
  });
});

// ---------------------------------------------------------------------------
// Parameter-based and expression-based port widths
// ---------------------------------------------------------------------------

describe('parameter-expression port widths', () => {
  const TCL_PARAM_WIDTHS = `
set_module_property NAME param_test
set_module_property VERSION 1.0

add_parameter DATA_WIDTH INTEGER 32
add_parameter ADDR_WIDTH INTEGER 16

add_interface conduit_in conduit end
add_interface_port conduit_in in_data   data  Input  DATA_WIDTH
add_interface_port conduit_in in_strobe strb  Input  DATA_WIDTH/8
add_interface_port conduit_in in_addr   addr  Input  ADDR_WIDTH
add_interface_port conduit_in in_valid  valid Input  1
add_interface_port conduit_in in_wide   wide  Input  "DATA_WIDTH * 2"
add_interface_port conduit_in in_plus   plus  Input  DATA_WIDTH+4
`;

  it('preserves a bare parameter name as the port width', () => {
    const { yamlText } = parse(TCL_PARAM_WIDTHS);
    const doc = parseYaml(yamlText);
    const ports = doc.ports as Array<Record<string, unknown>>;
    const p = ports.find((x) => x.name === 'in_data');
    expect(p?.width).toBe('DATA_WIDTH');
  });

  it('preserves a division expression (DATA_WIDTH/8) as the port width', () => {
    const { yamlText } = parse(TCL_PARAM_WIDTHS);
    const ports = parseYaml(yamlText).ports as Array<Record<string, unknown>>;
    expect(ports.find((x) => x.name === 'in_strobe')?.width).toBe('DATA_WIDTH/8');
  });

  it('preserves an addition expression (DATA_WIDTH+4) as the port width', () => {
    const { yamlText } = parse(TCL_PARAM_WIDTHS);
    const ports = parseYaml(yamlText).ports as Array<Record<string, unknown>>;
    expect(ports.find((x) => x.name === 'in_plus')?.width).toBe('DATA_WIDTH+4');
  });

  it('preserves a quoted spaced expression ("DATA_WIDTH * 2") as the port width', () => {
    const { yamlText } = parse(TCL_PARAM_WIDTHS);
    const ports = parseYaml(yamlText).ports as Array<Record<string, unknown>>;
    expect(ports.find((x) => x.name === 'in_wide')?.width).toBe('DATA_WIDTH * 2');
  });

  it('still omits width for literal 1-bit ports', () => {
    const { yamlText } = parse(TCL_PARAM_WIDTHS);
    const ports = parseYaml(yamlText).ports as Array<Record<string, unknown>>;
    expect(ports.find((x) => x.name === 'in_valid')?.width).toBeUndefined();
  });

  it('still emits width for literal multi-bit ports', () => {
    const tcl = `
set_module_property NAME literal_test
add_interface c conduit end
add_interface_port c out_bus bus Output 64
`;
    const { yamlText } = parse(tcl);
    const ports = parseYaml(yamlText).ports as Array<Record<string, unknown>>;
    expect(ports.find((x) => x.name === 'out_bus')?.width).toBe(64);
  });
});

describe('bus interface portWidthOverrides from parameter-width ports', () => {
  const TCL_BUS_PARAM = `
set_module_property NAME axi_narrow
set_module_property VERSION 1.0

add_parameter C_ADDR_WIDTH INTEGER 16

add_interface s_axi axi4lite slave
add_interface_port s_axi s_axi_awaddr awaddr Input  C_ADDR_WIDTH
add_interface_port s_axi s_axi_araddr araddr Input  C_ADDR_WIDTH
add_interface_port s_axi s_axi_wdata  wdata  Input  32
add_interface_port s_axi s_axi_rdata  rdata  Output 32
`;

  it('emits portWidthOverrides for bus ports with a parameter-name width', () => {
    const { yamlText } = parse(TCL_BUS_PARAM);
    const doc = parseYaml(yamlText);
    const busIfaces = doc.busInterfaces as Array<Record<string, unknown>>;
    const iface = busIfaces.find((b) => b.name === 's_axi');
    expect(iface).toBeDefined();
    const overrides = iface!.portWidthOverrides as Record<string, unknown>;
    expect(overrides).toBeDefined();
    expect(overrides['AWADDR']).toBe('C_ADDR_WIDTH');
    expect(overrides['ARADDR']).toBe('C_ADDR_WIDTH');
  });

  it('does not emit portWidthOverrides for ports that match bus-definition defaults', () => {
    const { yamlText } = parse(TCL_BUS_PARAM);
    const busIfaces = parseYaml(yamlText).busInterfaces as Array<Record<string, unknown>>;
    const iface = busIfaces.find((b) => b.name === 's_axi');
    const overrides = iface?.portWidthOverrides as Record<string, unknown> | undefined;
    expect(overrides?.['WDATA']).toBeUndefined();
    expect(overrides?.['RDATA']).toBeUndefined();
  });

  it('uses bus-definition case for portWidthOverrides keys (lowercase for Avalon)', () => {
    const tcl = `
set_module_property NAME avl_narrow
add_parameter DATA_WIDTH INTEGER 8
add_interface avl avalon end
add_interface_port avl avl_address  address   Input  8
add_interface_port avl avl_read     read      Input  1
add_interface_port avl avl_write    write     Input  1
add_interface_port avl avl_wdata    writedata Input  DATA_WIDTH
add_interface_port avl avl_rdata    readdata  Output DATA_WIDTH
`;
    const { yamlText } = parse(tcl);
    const busIfaces = parseYaml(yamlText).busInterfaces as Array<Record<string, unknown>>;
    const iface = busIfaces.find((b) => b.name === 'avl');
    const overrides = iface?.portWidthOverrides as Record<string, unknown> | undefined;
    expect(overrides).toBeDefined();
    // Avalon bus def names are lowercase — keys must match so canvas lookup works
    expect(overrides?.['writedata']).toBe('DATA_WIDTH');
    expect(overrides?.['readdata']).toBe('DATA_WIDTH');
    // address default is 32, we wire 8 => numeric override with lowercase key
    expect(overrides?.['address']).toBe(8);
    // Uppercase variants must NOT appear
    expect(overrides?.['WRITEDATA']).toBeUndefined();
    expect(overrides?.['READDATA']).toBeUndefined();
  });
});

describe('Avalon-ST contract properties', () => {
  const streamTcl = (symbolProperty: string) => `
set_module_property NAME stream_core
add_interface stream avalon_streaming start
set_interface_property stream ${symbolProperty} 1
set_interface_property stream symbolsPerBeat 5
set_interface_property stream readyLatency 0
set_interface_property stream firstSymbolInHighOrderBits true
add_interface_port stream stream_data data Output 5
add_interface_port stream stream_valid valid Output 1
`;

  it.each(['dataBitsPerSymbol', 'bitsPerSymbol'])(
    'normalizes %s and canonical streaming semantics',
    (symbolProperty) => {
      const doc = parseYaml(parse(streamTcl(symbolProperty)).yamlText);
      expect((doc.busInterfaces as Array<Record<string, unknown>>)[0]).toEqual(
        expect.objectContaining({
          mode: 'source',
          endianness: 'big',
          interfaceProperties: {
            dataBitsPerSymbol: 1,
            symbolsPerBeat: 5,
            readyLatency: 0,
          },
        })
      );
    }
  );

  it('rejects conflicting current and legacy symbol-width spellings with source context', () => {
    expect(() =>
      parse(`
add_interface stream avalon_streaming start
set_interface_property stream dataBitsPerSymbol 1
set_interface_property stream bitsPerSymbol 8
add_interface_port stream stream_data data Output 8
`)
    ).toThrow(`${FAKE_PATH}: interface 'stream' declares conflicting dataBitsPerSymbol`);
  });
  // Pattern from Intel IP such as altera_rs_ser_enc_hw.tcl.
  it('imports a stream whose properties are computed from parameters, with warnings', () => {
    const result = parse(`
add_parameter BITSPERSYMBOL INTEGER 8
add_interface out avalon_streaming start
set_interface_property out dataBitsPerSymbol [get_parameter_value BITSPERSYMBOL]
set_interface_property out maxChannel $MAX_CH
set_interface_property out readyLatency 0
add_interface_port out out_data data Output 8
add_interface_port out out_valid valid Output 1
`);
    const iface = (parseYaml(result.yamlText).busInterfaces as Array<Record<string, unknown>>)[0];

    expect(iface.interfaceProperties).toEqual({ readyLatency: 0 });
    expect(result.warnings).toEqual([
      expect.stringContaining("dataBitsPerSymbol: computed value 'BITSPERSYMBOL' is not a literal"),
      expect.stringContaining('maxChannel: computed value'),
    ]);
  });

  // Pattern from Intel dispatcher_hw.tcl: a static default, then an elaboration override.
  it('keeps the static default when an elaboration override is computed', () => {
    const result = parse(`
add_interface snk avalon_streaming end
set_interface_property snk dataBitsPerSymbol 256
set_interface_property snk symbolsPerBeat 1
add_interface_port snk snk_data data Input 256
proc elaborate {} {
  set_interface_property snk dataBitsPerSymbol [get_parameter_value DESCRIPTOR_WIDTH]
}
`);
    const iface = (parseYaml(result.yamlText).busInterfaces as Array<Record<string, unknown>>)[0];

    expect(iface.interfaceProperties).toEqual({ dataBitsPerSymbol: 256, symbolsPerBeat: 1 });
    expect(result.warnings).toEqual([expect.stringContaining("imported the static default '256'")]);
  });

  it('marks interfaces whose Tcl cannot be read statically', () => {
    const result = parse(`
add_interface static_st avalon_streaming start
set_interface_property static_st dataBitsPerSymbol 8
add_interface_port static_st s_data data Output 8
add_interface computed avalon_streaming start
add_interface_port computed c_data data Output [expr {$W*8}]
add_interface terminated avalon_streaming start
add_interface_port terminated t_data data Output 8
add_interface_port terminated t_empty empty Output 1
set_port_property t_empty termination true
add_interface placeholder avalon_mm end
add_interface_port placeholder p_address address Input -1
for {set i 0} {$i < 2} {incr i} {
  add_interface sink\${i} avalon_streaming end
}
`);

    // 'terminated' (literal termination) and the 'sink${i}' loop are resolved statically,
    // so they are complete; only unresolved widths and placeholder widths remain.
    expect(result.staticallyIncompleteInterfaces).toEqual(['computed', 'placeholder']);
  });

  it('still rejects a malformed literal property value', () => {
    expect(() =>
      parse(`
add_interface out avalon_streaming start
set_interface_property out readyLatency 1.5
add_interface_port out out_data data Output 8
`)
    ).toThrow("invalid integer value '1.5' for readyLatency");
  });
});

describe('Tcl loops and expr widths (#212)', () => {
  type Doc = {
    ports?: Array<Record<string, unknown>>;
    busInterfaces?: Array<Record<string, unknown>>;
  };
  const doc = (tcl: string) => parseYaml(parse(tcl).yamlText) as Doc;

  it('expands a literal-bound for loop and reduces [expr] widths', () => {
    const tcl = `
      set iwords 4
      for {set j 0} {$j < 4} {incr j} {
        add_interface tx_ch\${j}_datain avalon_streaming end
        add_interface_port tx_ch\${j}_datain tx_ch\${j}_data data Input [expr $iwords * 64]
      }
    `;
    const d = doc(tcl);
    expect(d.busInterfaces?.map((b) => b.name)).toEqual([
      'tx_ch0_datain',
      'tx_ch1_datain',
      'tx_ch2_datain',
      'tx_ch3_datain',
    ]);
    expect(d.busInterfaces?.[0].portWidthOverrides).toEqual({ data: 256 });
    expect(yaml.dump(d)).not.toMatch(/\$|expr/);
  });

  it('expands a loop bounded by a parameter default', () => {
    const tcl = `
      add_parameter NUM_CHANNELS INTEGER 2
      set num_chan [get_parameter_value NUM_CHANNELS]
      for {set i 0} {$i < $num_chan} {incr i} {
        add_interface ch$i conduit end
        add_interface_port ch$i ch\${i}_d d Input 1
      }
    `;
    expect(doc(tcl).ports?.map((p) => p.name)).toEqual(['ch0_d', 'ch1_d']);
  });

  it('expands foreach with per-iteration parameter widths', () => {
    const tcl = `
      foreach i {0 1} {
        add_interface m\${i} conduit end
        add_interface_port m\${i} addr\${i} a Input [get_parameter_value TCIM_W\${i}]
      }
    `;
    expect(doc(tcl).ports).toEqual([
      { name: 'addr0', direction: 'in', width: 'TCIM_W0' },
      { name: 'addr1', direction: 'in', width: 'TCIM_W1' },
    ]);
  });

  it('expands foreach over a list variable', () => {
    const tcl = `
      set names {a b}
      foreach n $names {
        add_interface c_$n conduit end
        add_interface_port c_$n p_$n d Input 1
      }
    `;
    expect(doc(tcl).ports?.map((p) => p.name)).toEqual(['p_a', 'p_b']);
  });

  it('expands nested loops', () => {
    const tcl = `
      for {set i 0} {$i < 2} {incr i} {
        for {set j 0} {$j <= 1} {incr j} {
          add_interface c_\${i}_\${j} conduit end
          add_interface_port c_\${i}_\${j} p_\${i}_\${j} d Input 1
        }
      }
    `;
    expect(doc(tcl).ports?.map((p) => p.name)).toEqual(['p_0_0', 'p_0_1', 'p_1_0', 'p_1_1']);
  });

  it('skips a loop with an unresolvable bound and warns', () => {
    const tcl = `
      for {set i 0} {$i < $unknown} {incr i} {
        add_interface c$i conduit end
        add_interface_port c$i p$i d Input 1
      }
    `;
    const result = parse(tcl);
    expect((parseYaml(result.yamlText) as Doc).ports).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Skipped Tcl loop "for {set i 0} {$i < $unknown}');
  });

  it('reduces [expr {$w+2}] with a set variable', () => {
    const tcl = `
      set w_add 8
      add_interface c conduit end
      add_interface_port c p p Input [expr {$w_add+2}]
    `;
    expect(doc(tcl).ports?.[0].width).toBe(10);
  });

  it('keeps parameter expressions symbolic', () => {
    const tcl = `
      add_parameter DMA_WIDTH INTEGER 32
      set DMA_WIDTH [get_parameter_value DMA_WIDTH]
      add_interface c conduit end
      add_interface_port c p p Input [expr $DMA_WIDTH/8]
    `;
    expect(doc(tcl).ports?.[0].width).toBe('DMA_WIDTH/8');
  });

  it('keeps a port with an unresolved width but omits the width', () => {
    const tcl = `
      add_interface c conduit end
      add_interface_port c p p Input [expr {int(ceil(log(4)/log(2)))}]
    `;
    const result = parse(tcl);
    const d = parseYaml(result.yamlText) as Doc;
    expect(d.ports).toEqual([{ name: 'p', direction: 'in' }]);
    expect(result.warnings).toEqual([
      'Port "p" on interface "c": width "expr {int(ceil(log(4)/log(2)))}" could not be resolved and was left out.',
    ]);
  });

  it('omits portWidthOverrides entries for unresolved bus port widths', () => {
    const tcl = `
      add_interface s avalon_streaming end
      add_interface_port s data data Input [expr {int(log(4))}]
    `;
    const d = doc(tcl);
    expect(d.busInterfaces?.[0].portWidthOverrides).toBeUndefined();
  });

  it('parses quoted foreach items without leaking quotes', () => {
    const tcl = `
      foreach suffix { "_a" "_b" } {
        add_interface m$suffix conduit end
        add_interface_port m$suffix p$suffix d Input 1
      }
    `;
    expect(doc(tcl).ports?.map((p) => p.name)).toEqual(['p_a', 'p_b']);
  });

  it('expands foreach over a [list ...] variable', () => {
    const tcl = `
      set ii_list [list "1" "2"]
      foreach ii $ii_list {
        add_interface c$ii conduit end
        add_interface_port c$ii p$ii d Input 1
      }
    `;
    expect(doc(tcl).ports?.map((p) => p.name)).toEqual(['p1', 'p2']);
  });

  it('skips foreach over a parameter-valued variable and warns', () => {
    const tcl = `
      add_parameter CHANS INTEGER 2
      set chans [get_parameter_value CHANS]
      foreach n $chans {
        add_interface c$n conduit end
        add_interface_port c$n p$n d Input 1
      }
    `;
    const result = parse(tcl);
    expect((parseYaml(result.yamlText) as Doc).ports).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });

  it('does not import unknown command substitutions as widths', () => {
    const tcl = `
      add_interface c conduit end
      add_interface_port c p p Input [log2ceil "SYMBOLS_PER_BEAT"]
    `;
    const result = parse(tcl);
    expect((parseYaml(result.yamlText) as Doc).ports).toEqual([{ name: 'p', direction: 'in' }]);
    expect(result.warnings).toHaveLength(1);
  });

  it('strips quotes from get_parameter_value names', () => {
    const tcl = `
      add_parameter DATA_WIDTH INTEGER 8
      add_interface c conduit end
      add_interface_port c p p Input [get_parameter_value "DATA_WIDTH"]
      add_interface_port c q q Input [expr {[get_parameter_value "DATA_WIDTH"] + 1}]
    `;
    expect(doc(tcl).ports?.map((p) => p.width)).toEqual(['DATA_WIDTH', 'DATA_WIDTH + 1']);
  });

  it('drops interfaces and ports whose names contain Tcl syntax', () => {
    const tcl = `
      add_interface bad$x conduit end
      add_interface_port bad$x p p Input 1
      add_interface c conduit end
      add_interface_port c q$y q Input 1
      add_interface_port c ok ok Input 1
    `;
    const result = parse(tcl);
    expect((parseYaml(result.yamlText) as Doc).ports?.map((p) => p.name)).toEqual(['ok']);
    expect(result.warnings).toEqual([
      'Interface "bad$x" was not imported: its name uses Tcl that could not be resolved.',
      'Port "q$y" on interface "c" was not imported: its name uses Tcl that could not be resolved.',
    ]);
  });
});
