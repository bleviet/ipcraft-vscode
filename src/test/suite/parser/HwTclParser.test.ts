import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fsPromises from 'fs/promises';
import { parseHwTclContent, parseHwTclFile, extractSourcePath } from '../../../parser/HwTclParser';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof fsPromises>('fs/promises');
  return { ...actual, readFile: jest.fn() };
});

const mockReadFile = fsPromises.readFile as jest.Mock;

const FAKE_PATH = '/project/intel/my_core_hw.tcl';

function parse(content: string, opts?: { library?: string; outputDir?: string }) {
  return parseHwTclContent(content, FAKE_PATH, opts);
}

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
      expect(bi.type).toBe('ipcraft.busif.axi4_lite.1.0');
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
      expect(doc.busInterfaces[0].type).toBe('ipcraft.busif.avalon_mm.1.0');
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

    it('uses sink/source mode for streaming interfaces', () => {
      const tcl = `
        add_interface axis_in axi4stream end
        add_interface_port axis_in in_tdata tdata Input 8
        add_interface axis_out axi4stream start
        add_interface_port axis_out out_tdata tdata Output 8
      `;
      const doc = parseYaml(parse(tcl).yamlText) as {
        busInterfaces: Array<Record<string, unknown>>;
      };
      expect(doc.busInterfaces[0].mode).toBe('sink');
      expect(doc.busInterfaces[1].mode).toBe('source');
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
      expect(bi.useOptionalPorts).toEqual(['awlen']);
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
      expect(optPorts).toContain('tlast');
      expect(optPorts).toContain('tkeep');
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
      expect(bi.type).toBe('ipcraft.busif.axi4_lite.1.0');
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
