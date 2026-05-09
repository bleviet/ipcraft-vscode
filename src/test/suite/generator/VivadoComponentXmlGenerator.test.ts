import { generateComponentXml } from '../../../generator/VivadoComponentXmlGenerator';
import type { BusDefinitions, IpCoreData } from '../../../generator/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const AXI4L_PORTS = [
  { name: 'AWADDR', width: 8, direction: 'out' },
  { name: 'AWVALID', width: 1, direction: 'out' },
  { name: 'AWREADY', width: 1, direction: 'in' },
  { name: 'WDATA', width: 32, direction: 'out' },
  { name: 'WSTRB', width: 4, direction: 'out' },
  { name: 'WVALID', width: 1, direction: 'out' },
  { name: 'WREADY', width: 1, direction: 'in' },
  { name: 'BRESP', width: 2, direction: 'in' },
  { name: 'BVALID', width: 1, direction: 'in' },
  { name: 'BREADY', width: 1, direction: 'out' },
  { name: 'ARADDR', width: 8, direction: 'out' },
  { name: 'ARVALID', width: 1, direction: 'out' },
  { name: 'ARREADY', width: 1, direction: 'in' },
  { name: 'RDATA', width: 32, direction: 'in' },
  { name: 'RRESP', width: 2, direction: 'in' },
  { name: 'RVALID', width: 1, direction: 'in' },
  { name: 'RREADY', width: 1, direction: 'out' },
];

const BUS_DEFS: BusDefinitions = {
  AXI4_LITE: { ports: AXI4L_PORTS },
  AXI4_FULL: { ports: AXI4L_PORTS },
  AXI_STREAM: {
    ports: [
      { name: 'TDATA', width: 8, direction: 'out' },
      { name: 'TVALID', width: 1, direction: 'out' },
      { name: 'TREADY', width: 1, direction: 'in' },
      { name: 'TLAST', width: 1, direction: 'out' },
    ],
  },
};

function makeIp(overrides: Partial<IpCoreData> = {}): IpCoreData {
  return {
    vlnv: { vendor: 'acme', library: 'ip', name: 'my_core', version: '2.0.0' },
    description: 'A test core',
    clocks: [{ name: 'clk' }],
    resets: [{ name: 'rst_n', polarity: 'activeLow' }],
    bus_interfaces: [
      {
        name: 's_axi',
        type: 'ipcraft.busif.axi4_lite.1.0',
        mode: 'slave',
        physical_prefix: 's_axi_',
        associated_clock: 'clk',
        associated_reset: 'rst_n',
        use_optional_ports: [],
        port_width_overrides: {},
      },
    ],
    ports: [{ name: 'out_port', direction: 'out', width: 8 }],
    parameters: [],
    ...overrides,
  };
}

function gen(overrides: Partial<IpCoreData> = {}, options = {}) {
  return generateComponentXml(makeIp(overrides), BUS_DEFS, options);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateComponentXml', () => {
  describe('VLNV header', () => {
    it('emits vendor, library, name, version', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:vendor>acme</spirit:vendor>');
      expect(xml).toContain('<spirit:library>ip</spirit:library>');
      expect(xml).toContain('<spirit:name>my_core</spirit:name>');
      expect(xml).toContain('<spirit:version>2.0.0</spirit:version>');
    });

    it('uses default vlnv when absent', () => {
      const xml = generateComponentXml({ bus_interfaces: [] } as IpCoreData, BUS_DEFS);
      expect(xml).toContain('<spirit:vendor>user</spirit:vendor>');
      expect(xml).toContain('<spirit:library>ip</spirit:library>');
      expect(xml).toContain('<spirit:name>ip_core</spirit:name>');
    });

    it('escapes XML special characters', () => {
      const xml = gen({ description: 'Core for <test> & "examples"' });
      expect(xml).toContain('Core for &lt;test&gt; &amp; &quot;examples&quot;');
    });
  });

  describe('AXI4-Lite bus interface', () => {
    it('uses xilinx.com interface aximm bus type', () => {
      const xml = gen();
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm"'
      );
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm_rtl"'
      );
    });

    it('emits <spirit:slave /> for slave mode', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:slave />');
    });

    it('emits <spirit:master /> for master mode', () => {
      const xml = gen({
        bus_interfaces: [
          {
            name: 'm_axi',
            type: 'ipcraft.busif.axi4_lite.1.0',
            mode: 'master',
            physical_prefix: 'm_axi_',
            use_optional_ports: [],
            port_width_overrides: {},
          },
        ],
      });
      expect(xml).toContain('<spirit:master />');
    });

    it('includes PROTOCOL=AXI4LITE parameter', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>PROTOCOL</spirit:name>');
      expect(xml).toContain('>AXI4LITE<');
    });

    it('builds portMaps from bus library', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>AWADDR</spirit:name>');
      expect(xml).toContain('<spirit:name>s_axi_awaddr</spirit:name>');
      expect(xml).toContain('<spirit:name>WDATA</spirit:name>');
      expect(xml).toContain('<spirit:name>s_axi_wdata</spirit:name>');
    });
  });

  describe('AXI4 Full bus interface', () => {
    it('includes PROTOCOL=AXI4', () => {
      const xml = gen({
        bus_interfaces: [
          {
            name: 's_axi',
            type: 'ipcraft.busif.axi4_full.1.0',
            mode: 'slave',
            physical_prefix: 's_axi_',
            use_optional_ports: [],
            port_width_overrides: {},
          },
        ],
      });
      expect(xml).toContain('>AXI4<');
      expect(xml).not.toContain('>AXI4LITE<');
    });
  });

  describe('AXI-Stream bus interface', () => {
    function makeAxis(mode: string) {
      return gen({
        bus_interfaces: [
          {
            name: 'axis_s',
            type: 'ipcraft.busif.axi_stream.1.0',
            mode,
            physical_prefix: 'axis_s_',
            use_optional_ports: [],
            port_width_overrides: {},
          },
        ],
      });
    }

    it('uses xilinx.com interface axis bus type', () => {
      const xml = makeAxis('slave');
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="axis"'
      );
    });

    it('does not include PROTOCOL parameter', () => {
      const xml = makeAxis('slave');
      const axisBusSection = xml.slice(
        xml.indexOf('<spirit:busInterface>'),
        xml.indexOf('</spirit:busInterface>') + 22
      );
      expect(axisBusSection).not.toContain('<spirit:name>PROTOCOL</spirit:name>');
    });

    it('emits slave for sink mode', () => {
      expect(makeAxis('sink')).toContain('<spirit:slave />');
    });

    it('emits master for source mode', () => {
      expect(makeAxis('source')).toContain('<spirit:master />');
    });
  });

  describe('unknown bus type', () => {
    it('falls back to user.org with type as name', () => {
      const xml = gen({
        bus_interfaces: [
          {
            name: 'custom_if',
            type: 'custom.busif.mybus.1.0',
            mode: 'slave',
            physical_prefix: 'custom_',
            use_optional_ports: [],
            port_width_overrides: {},
          },
        ],
      });
      expect(xml).toContain('spirit:vendor="user.org"');
      expect(xml).toContain('spirit:name="custom.busif.mybus.1.0"');
    });
  });

  describe('clock bus interface', () => {
    it('uses xilinx.com signal clock bus type', () => {
      const xml = gen();
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock"'
      );
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock_rtl"'
      );
    });

    it('portMap CLK -> actual clock port name', () => {
      const xml = gen();
      const clockSection = xml.slice(
        xml.indexOf('spirit:name="clock"') - 200,
        xml.indexOf('spirit:name="clock"') + 1000
      );
      expect(clockSection).toContain('<spirit:name>CLK</spirit:name>');
      expect(clockSection).toContain('<spirit:name>clk</spirit:name>');
    });

    it('ASSOCIATED_BUSIF lists bus interfaces using this clock (uppercase)', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>ASSOCIATED_BUSIF</spirit:name>');
      expect(xml).toContain('>S_AXI<');
    });

    it('ASSOCIATED_BUSIF is colon-separated when multiple bus interfaces share a clock', () => {
      const xml = gen({
        bus_interfaces: [
          {
            name: 's_axi0',
            type: 'ipcraft.busif.axi4_lite.1.0',
            mode: 'slave',
            physical_prefix: 's_axi0_',
            associated_clock: 'clk',
            use_optional_ports: [],
            port_width_overrides: {},
          },
          {
            name: 's_axi1',
            type: 'ipcraft.busif.axi4_lite.1.0',
            mode: 'slave',
            physical_prefix: 's_axi1_',
            associated_clock: 'clk',
            use_optional_ports: [],
            port_width_overrides: {},
          },
        ],
      });
      expect(xml).toContain('>S_AXI0:S_AXI1<');
    });

    it('ASSOCIATED_RESET contains the reset port name', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>ASSOCIATED_RESET</spirit:name>');
      expect(xml).toContain('>rst_n<');
    });

    it('omits ASSOCIATED_BUSIF when no bus interfaces reference this clock', () => {
      const xml = gen({
        bus_interfaces: [
          {
            name: 's_axi',
            type: 'ipcraft.busif.axi4_lite.1.0',
            mode: 'slave',
            physical_prefix: 's_axi_',
            associated_clock: 'other_clk',
            use_optional_ports: [],
            port_width_overrides: {},
          },
        ],
      });
      const clkSection = xml.slice(xml.indexOf('"clock"'), xml.indexOf('"clock"') + 800);
      expect(clkSection).not.toContain('ASSOCIATED_BUSIF');
    });
  });

  describe('reset bus interface', () => {
    it('uses xilinx.com signal reset bus type', () => {
      const xml = gen();
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="reset"'
      );
    });

    it('portMap RST -> actual reset port name', () => {
      const xml = gen();
      const resetSection = xml.slice(xml.indexOf('"reset"') - 200, xml.indexOf('"reset"') + 800);
      expect(resetSection).toContain('<spirit:name>RST</spirit:name>');
      expect(resetSection).toContain('<spirit:name>rst_n</spirit:name>');
    });

    it('POLARITY=ACTIVE_LOW for activeLow polarity', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>POLARITY</spirit:name>');
      expect(xml).toContain('>ACTIVE_LOW<');
    });

    it('POLARITY=ACTIVE_HIGH for activeHigh polarity', () => {
      const xml = gen({ resets: [{ name: 'rst', polarity: 'activeHigh' }] });
      expect(xml).toContain('>ACTIVE_HIGH<');
    });
  });

  describe('model ports', () => {
    it('emits clock port as direction=in with typeName std_logic', () => {
      const xml = gen();
      const clkPort = extractPort(xml, 'clk');
      expect(clkPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(clkPort).toContain('<spirit:typeName>std_logic</spirit:typeName>');
      expect(clkPort).not.toContain('<spirit:vector>');
    });

    it('emits reset port as direction=in with typeName std_logic', () => {
      const xml = gen();
      const rstPort = extractPort(xml, 'rst_n');
      expect(rstPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(rstPort).toContain('<spirit:typeName>std_logic</spirit:typeName>');
    });

    it('emits single-bit bus port without vector element', () => {
      const xml = gen();
      const awvalidPort = extractPort(xml, 's_axi_awvalid');
      expect(awvalidPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(awvalidPort).toContain('<spirit:typeName>std_logic</spirit:typeName>');
      expect(awvalidPort).not.toContain('<spirit:vector>');
    });

    it('emits multi-bit bus port with vector and std_logic_vector', () => {
      const xml = gen();
      const awaddrPort = extractPort(xml, 's_axi_awaddr');
      expect(awaddrPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(awaddrPort).toContain('<spirit:vector>');
      expect(awaddrPort).toContain('spirit:format="long">7<');
      expect(awaddrPort).toContain('<spirit:typeName>std_logic_vector</spirit:typeName>');
    });

    it('emits user port width=1 as std_logic without vector', () => {
      const xml = gen({ ports: [{ name: 'enable', direction: 'in', width: 1 }] });
      const port = extractPort(xml, 'enable');
      expect(port).toContain('<spirit:typeName>std_logic</spirit:typeName>');
      expect(port).not.toContain('<spirit:vector>');
    });

    it('emits user port width>1 with vector and std_logic_vector', () => {
      const xml = gen();
      const port = extractPort(xml, 'out_port');
      expect(port).toContain('<spirit:direction>out</spirit:direction>');
      expect(port).toContain('<spirit:vector>');
      expect(port).toContain('spirit:format="long">7<');
      expect(port).toContain('<spirit:typeName>std_logic_vector</spirit:typeName>');
    });

    it('flips direction for slave bus ports (master-out becomes slave-in)', () => {
      const xml = gen();
      const awaddrPort = extractPort(xml, 's_axi_awaddr');
      // AWADDR is out from master perspective → in for slave
      expect(awaddrPort).toContain('<spirit:direction>in</spirit:direction>');
    });

    it('includes ASSOCIATED_RESET and two view refs in wireTypeDef', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:viewNameRef>xilinx_vhdlsynthesis</spirit:viewNameRef>');
      expect(xml).toContain(
        '<spirit:viewNameRef>xilinx_vhdlbehavioralsimulation</spirit:viewNameRef>'
      );
    });
  });

  describe('views', () => {
    it('emits xilinx_vhdlsynthesis view', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>xilinx_vhdlsynthesis</spirit:name>');
      expect(xml).toContain('vhdlSource:vivado.xilinx.com:synthesis');
    });

    it('emits xilinx_vhdlbehavioralsimulation view', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>xilinx_vhdlbehavioralsimulation</spirit:name>');
      expect(xml).toContain('vhdlSource:vivado.xilinx.com:simulation');
    });

    it('emits xilinx_xpgui view', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>xilinx_xpgui</spirit:name>');
    });

    it('uses entity name as modelName', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:modelName>my_core</spirit:modelName>');
    });
  });

  describe('file sets', () => {
    it('rtlFiles option populates synthesis and simulation filesets', () => {
      const xml = gen({}, { rtlFiles: ['../rtl/my_core.vhd', '../rtl/my_core_pkg.vhd'] });
      expect(xml).toContain('<spirit:name>xilinx_vhdlsynthesis_view_fileset</spirit:name>');
      expect(xml).toContain(
        '<spirit:name>xilinx_vhdlbehavioralsimulation_view_fileset</spirit:name>'
      );
      expect(xml).toContain('<spirit:name>../rtl/my_core.vhd</spirit:name>');
      expect(xml).toContain('<spirit:fileType>vhdlSource</spirit:fileType>');
    });

    it('uses simFiles option for simulation fileset when provided', () => {
      const xml = gen(
        {},
        {
          rtlFiles: ['../rtl/my_core.vhd'],
          simFiles: ['../tb/my_core_tb.vhd'],
        }
      );
      expect(xml).toContain('<spirit:name>../tb/my_core_tb.vhd</spirit:name>');
    });

    it('emits xgui fileset with tclSource', () => {
      const xml = gen({}, { xguiFile: 'xgui/my_core_v2_0_0.tcl' });
      expect(xml).toContain('<spirit:name>xilinx_xpgui_view_fileset</spirit:name>');
      expect(xml).toContain('<spirit:name>xgui/my_core_v2_0_0.tcl</spirit:name>');
      expect(xml).toContain('<spirit:fileType>tclSource</spirit:fileType>');
    });

    it('derives default xgui path from name and version', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>xgui/my_core_v2_0_0.tcl</spirit:name>');
    });

    it('uses ip.yml fileSets when rtlFiles not provided', () => {
      const xml = generateComponentXml(
        {
          ...makeIp(),
          fileSets: [
            {
              name: 'RTL_Sources',
              files: [{ path: 'rtl/my_core.vhd', type: 'vhdl' }],
            },
          ],
        } as IpCoreData,
        BUS_DEFS,
        { filePathPrefix: '../' }
      );
      expect(xml).toContain('<spirit:name>../rtl/my_core.vhd</spirit:name>');
    });
  });

  describe('description and parameters', () => {
    it('emits description element', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:description>A test core</spirit:description>');
    });

    it('emits Component_Name parameter', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:name>Component_Name</spirit:name>');
      expect(xml).toContain('PARAM_VALUE.Component_Name');
      expect(xml).toContain('>my_core<');
    });

    it('emits integer parameter with format=long and resolve=user', () => {
      const xml = gen({
        parameters: [{ name: 'C_DATA_WIDTH', value: 32, data_type: 'integer' }],
      });
      expect(xml).toContain('<spirit:name>C_DATA_WIDTH</spirit:name>');
      expect(xml).toContain('spirit:format="long"');
      expect(xml).toContain('spirit:resolve="user"');
      expect(xml).toContain('>32<');
    });

    it('emits string parameter with format=string', () => {
      const xml = gen({
        parameters: [{ name: 'C_PROTOCOL', value: 'AXI4', data_type: 'string' }],
      });
      expect(xml).toContain('spirit:format="string"');
      expect(xml).toContain('>AXI4<');
    });
  });

  describe('vendorExtensions', () => {
    it('uses xilinx namespace not amd', () => {
      const xml = gen();
      expect(xml).toContain('xmlns:xilinx="http://www.xilinx.com"');
      expect(xml).toContain('<xilinx:coreExtensions>');
      expect(xml).not.toContain('<amd:coreExtensions>');
    });

    it('includes standard supported FPGA families', () => {
      const xml = gen();
      expect(xml).toContain('artix7');
      expect(xml).toContain('zynquplus');
    });

    it('includes display name derived from entity name', () => {
      const xml = gen();
      expect(xml).toContain('<xilinx:displayName>My Core</xilinx:displayName>');
    });

    it('accepts custom display name option', () => {
      const xml = gen({}, { displayName: 'Custom Display' });
      expect(xml).toContain('<xilinx:displayName>Custom Display</xilinx:displayName>');
    });

    it('includes xilinx:packagingInfo', () => {
      const xml = gen();
      expect(xml).toContain('<xilinx:packagingInfo>');
    });
  });

  describe('valid XML structure', () => {
    it('starts with XML declaration', () => {
      expect(gen()).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    });

    it('has spirit:component root element', () => {
      const xml = gen();
      expect(xml).toContain('<spirit:component ');
      expect(xml).toContain('</spirit:component>');
    });
  });
});

// ── Test helpers ──────────────────────────────────────────────────────────────

function extractPort(xml: string, portName: string): string {
  const marker = `<spirit:name>${portName}</spirit:name>`;
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const idx = xml.indexOf(marker, searchFrom);
    if (idx === -1) {
      return '';
    }
    const portOpen = xml.lastIndexOf('<spirit:port>', idx);
    const portClose = xml.indexOf('</spirit:port>', idx);
    if (portOpen !== -1 && portClose !== -1) {
      const fragment = xml.slice(portOpen, portClose + 14);
      if (
        fragment.includes(`<spirit:name>${portName}</spirit:name>`) &&
        !fragment.includes('<spirit:physicalPort>')
      ) {
        return fragment;
      }
    }
    searchFrom = idx + 1;
  }
  return '';
}
