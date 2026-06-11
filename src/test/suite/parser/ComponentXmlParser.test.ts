import * as yaml from 'js-yaml';
import { parseComponentXmlText } from '../../../parser/ComponentXmlParser';

function parseYaml(text: string) {
  return yaml.load(text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Minimal component.xml fixture (no bus interfaces, no registers)
// ---------------------------------------------------------------------------
const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>my_ip</spirit:name>
  <spirit:version>2.0</spirit:version>
  <spirit:description>A minimal test IP</spirit:description>
</spirit:component>`;

// ---------------------------------------------------------------------------
// Component with one AXI4-Lite slave, a clock, and an active-low reset
// ---------------------------------------------------------------------------
const AXI4LITE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"
                  xmlns:xilinx="http://www.xilinx.com">
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>axi_gpio</spirit:name>
  <spirit:version>2.0</spirit:version>

  <spirit:busInterfaces>
    <!-- AXI4-Lite slave (no ARLEN → Lite) -->
    <spirit:busInterface>
      <spirit:name>S_AXI</spirit:name>
      <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm" spirit:version="1.0"/>
      <spirit:slave/>
      <spirit:portMaps>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>ARADDR</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axi_araddr</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>ARREADY</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axi_arready</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>AWADDR</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axi_awaddr</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>WDATA</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axi_wdata</spirit:name></spirit:physicalPort>
        </spirit:portMap>
      </spirit:portMaps>
      <spirit:memoryMapRef spirit:memoryMapRef="S_AXI"/>
    </spirit:busInterface>

    <!-- Clock -->
    <spirit:busInterface>
      <spirit:name>S_AXI_ACLK</spirit:name>
      <spirit:busType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock" spirit:version="1.0"/>
      <spirit:slave/>
      <spirit:portMaps>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>CLK</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axi_aclk</spirit:name></spirit:physicalPort>
        </spirit:portMap>
      </spirit:portMaps>
      <spirit:parameters>
        <spirit:parameter>
          <spirit:name>ASSOCIATED_BUSIF</spirit:name>
          <spirit:value>S_AXI</spirit:value>
        </spirit:parameter>
      </spirit:parameters>
    </spirit:busInterface>

    <!-- Active-low reset -->
    <spirit:busInterface>
      <spirit:name>S_AXI_ARESETN</spirit:name>
      <spirit:busType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="reset" spirit:version="1.0"/>
      <spirit:slave/>
      <spirit:portMaps>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>RST</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axi_aresetn</spirit:name></spirit:physicalPort>
        </spirit:portMap>
      </spirit:portMaps>
      <spirit:parameters>
        <spirit:parameter>
          <spirit:name>POLARITY</spirit:name>
          <spirit:value>ACTIVE_LOW</spirit:value>
        </spirit:parameter>
      </spirit:parameters>
    </spirit:busInterface>
  </spirit:busInterfaces>

  <spirit:memoryMaps>
    <spirit:memoryMap>
      <spirit:name>S_AXI</spirit:name>
      <spirit:addressBlock>
        <spirit:name>Reg</spirit:name>
        <spirit:baseAddress>0x00000000</spirit:baseAddress>
        <spirit:range>4096</spirit:range>
        <spirit:width>32</spirit:width>
        <spirit:register>
          <spirit:name>GPIO_DATA</spirit:name>
          <spirit:description>GPIO Data Register</spirit:description>
          <spirit:addressOffset>0x0</spirit:addressOffset>
          <spirit:size spirit:format="long">32</spirit:size>
          <spirit:access>read-write</spirit:access>
          <spirit:fields>
            <spirit:field>
              <spirit:name>DATA</spirit:name>
              <spirit:bitOffset>0</spirit:bitOffset>
              <spirit:bitWidth>32</spirit:bitWidth>
              <spirit:access>read-write</spirit:access>
            </spirit:field>
          </spirit:fields>
        </spirit:register>
        <spirit:register>
          <spirit:name>GPIO_TRI</spirit:name>
          <spirit:description>GPIO Tri-state Register</spirit:description>
          <spirit:addressOffset>0x4</spirit:addressOffset>
          <spirit:size spirit:format="long">32</spirit:size>
          <spirit:access>read-write</spirit:access>
          <spirit:fields>
            <spirit:field>
              <spirit:name>TRI</spirit:name>
              <spirit:bitOffset>0</spirit:bitOffset>
              <spirit:bitWidth>32</spirit:bitWidth>
              <spirit:access>read-write</spirit:access>
              <spirit:reset>0xFFFFFFFF</spirit:reset>
            </spirit:field>
          </spirit:fields>
        </spirit:register>
      </spirit:addressBlock>
    </spirit:memoryMap>
  </spirit:memoryMaps>

  <spirit:parameters>
    <spirit:parameter>
      <spirit:name>C_GPIO_WIDTH</spirit:name>
      <spirit:value spirit:format="long">32</spirit:value>
    </spirit:parameter>
    <spirit:parameter>
      <spirit:name>C_ALL_INPUTS</spirit:name>
      <spirit:value spirit:format="bool">false</spirit:value>
    </spirit:parameter>
  </spirit:parameters>
</spirit:component>`;

// ---------------------------------------------------------------------------
// Component with a full AXI4 master (has ARLEN)
// ---------------------------------------------------------------------------
const AXI4FULL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>axi_master</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busInterfaces>
    <spirit:busInterface>
      <spirit:name>M_AXI</spirit:name>
      <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm" spirit:version="1.0"/>
      <spirit:master/>
      <spirit:portMaps>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>ARADDR</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>m_axi_araddr</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>ARLEN</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>m_axi_arlen</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>ARBURST</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>m_axi_arburst</spirit:name></spirit:physicalPort>
        </spirit:portMap>
      </spirit:portMaps>
    </spirit:busInterface>
  </spirit:busInterfaces>
</spirit:component>`;

// ---------------------------------------------------------------------------
// Component with an AXI-Stream interface
// ---------------------------------------------------------------------------
const AXIS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>axis_fifo</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busInterfaces>
    <spirit:busInterface>
      <spirit:name>S_AXIS</spirit:name>
      <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="axis" spirit:version="1.0"/>
      <spirit:slave/>
      <spirit:portMaps>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>TDATA</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axis_tdata</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>TVALID</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axis_tvalid</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>TREADY</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>s_axis_tready</spirit:name></spirit:physicalPort>
        </spirit:portMap>
      </spirit:portMaps>
    </spirit:busInterface>
    <spirit:busInterface>
      <spirit:name>M_AXIS</spirit:name>
      <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="axis" spirit:version="1.0"/>
      <spirit:master/>
      <spirit:portMaps>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>TDATA</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>m_axis_tdata</spirit:name></spirit:physicalPort>
        </spirit:portMap>
        <spirit:portMap>
          <spirit:logicalPort><spirit:name>TVALID</spirit:name></spirit:logicalPort>
          <spirit:physicalPort><spirit:name>m_axis_tvalid</spirit:name></spirit:physicalPort>
        </spirit:portMap>
      </spirit:portMaps>
    </spirit:busInterface>
  </spirit:busInterfaces>
</spirit:component>`;

// ===========================================================================
// Tests
// ===========================================================================

describe('ComponentXmlParser', () => {
  describe('VLNV extraction', () => {
    it('extracts vendor, library, name, version', () => {
      const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
      const doc = parseYaml(ipYamlText) as { vlnv: Record<string, string> };
      expect(doc.vlnv.vendor).toBe('acme.com');
      expect(doc.vlnv.library).toBe('ip');
      expect(doc.vlnv.name).toBe('my_ip');
      expect(doc.vlnv.version).toBe('2.0');
    });

    it('uses options.library override', () => {
      const { ipYamlText } = parseComponentXmlText(MINIMAL_XML, { library: 'user' });
      const doc = parseYaml(ipYamlText) as { vlnv: Record<string, string> };
      expect(doc.vlnv.library).toBe('user');
    });

    it('includes description when present', () => {
      const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
      const doc = parseYaml(ipYamlText) as { description: string };
      expect(doc.description).toBe('A minimal test IP');
    });

    it('sets componentName from spirit:name', () => {
      const { componentName } = parseComponentXmlText(MINIMAL_XML);
      expect(componentName).toBe('my_ip');
    });

    it('always sets apiVersion to 1.0', () => {
      const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
      const doc = parseYaml(ipYamlText) as { apiVersion: string };
      expect(doc.apiVersion).toBe('1.0');
    });
  });

  describe('clock and reset extraction', () => {
    it('extracts clock port from clock busInterface', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as { clocks: Array<{ name: string; direction: string }> };
      expect(doc.clocks).toBeDefined();
      expect(doc.clocks[0].name).toBe('s_axi_aclk');
      expect(doc.clocks[0].direction).toBe('in');
    });

    it('extracts active-low reset with correct polarity', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        resets: Array<{ name: string; direction: string; polarity: string }>;
      };
      expect(doc.resets).toBeDefined();
      expect(doc.resets[0].name).toBe('s_axi_aresetn');
      expect(doc.resets[0].polarity).toBe('activeLow');
    });

    it('does not emit clocks or resets for minimal component', () => {
      const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
      const doc = parseYaml(ipYamlText);
      expect(doc.clocks).toBeUndefined();
      expect(doc.resets).toBeUndefined();
    });
  });

  describe('bus interface detection', () => {
    it('identifies AXI4-Lite slave (no ARLEN) with physicalPrefix', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        busInterfaces: Array<{
          name: string;
          type: string;
          mode: string;
          physicalPrefix: string;
        }>;
      };
      const iface = doc.busInterfaces.find((b) => b.name === 'S_AXI');
      expect(iface).toBeDefined();
      expect(iface!.type).toBe('ipcraft.busif.axi4_lite.1.0');
      expect(iface!.mode).toBe('slave');
      expect(iface!.physicalPrefix).toBe('s_axi_');
    });

    it('identifies AXI4-Full master (has ARLEN)', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4FULL_XML);
      const doc = parseYaml(ipYamlText) as {
        busInterfaces: Array<{ name: string; type: string; mode: string }>;
      };
      const iface = doc.busInterfaces.find((b) => b.name === 'M_AXI');
      expect(iface).toBeDefined();
      expect(iface!.type).toBe('ipcraft.busif.axi4_full.1.0');
      expect(iface!.mode).toBe('master');
    });

    it('identifies AXI-Stream slave and master', () => {
      const { ipYamlText } = parseComponentXmlText(AXIS_XML);
      const doc = parseYaml(ipYamlText) as {
        busInterfaces: Array<{ name: string; type: string; mode: string }>;
      };
      const slave = doc.busInterfaces.find((b) => b.name === 'S_AXIS');
      const master = doc.busInterfaces.find((b) => b.name === 'M_AXIS');
      expect(slave?.type).toBe('ipcraft.busif.axi_stream.1.0');
      expect(slave?.mode).toBe('slave');
      expect(master?.type).toBe('ipcraft.busif.axi_stream.1.0');
      expect(master?.mode).toBe('master');
    });

    it('excludes clock/reset busInterfaces from busInterfaces list', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        busInterfaces: Array<{ name: string }>;
      };
      const names = doc.busInterfaces.map((b) => b.name);
      expect(names).not.toContain('S_AXI_ACLK');
      expect(names).not.toContain('S_AXI_ARESETN');
    });

    it('sets associatedClock via ASSOCIATED_BUSIF parameter', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        busInterfaces: Array<{ name: string; associatedClock?: string }>;
      };
      const iface = doc.busInterfaces.find((b) => b.name === 'S_AXI');
      expect(iface?.associatedClock).toBe('s_axi_aclk');
    });

    it('sets memoryMapRef when present', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        busInterfaces: Array<{ name: string; memoryMapRef?: string }>;
      };
      const iface = doc.busInterfaces.find((b) => b.name === 'S_AXI');
      expect(iface?.memoryMapRef).toBe('S_AXI');
    });
  });

  describe('parameter extraction', () => {
    it('extracts integer parameters', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        parameters: Array<{ name: string; value: unknown; dataType: string }>;
      };
      const param = doc.parameters.find((p) => p.name === 'C_GPIO_WIDTH');
      expect(param).toBeDefined();
      expect(param!.value).toBe(32);
      expect(param!.dataType).toBe('integer');
    });

    it('extracts boolean parameters', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as {
        parameters: Array<{ name: string; value: unknown; dataType: string }>;
      };
      const param = doc.parameters.find((p) => p.name === 'C_ALL_INPUTS');
      expect(param).toBeDefined();
      expect(param!.value).toBe(false);
      expect(param!.dataType).toBe('boolean');
    });

    it('omits parameters section for minimal component', () => {
      const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
      const doc = parseYaml(ipYamlText);
      expect(doc.parameters).toBeUndefined();
    });
  });

  describe('register map extraction (mm.yml)', () => {
    it('generates mm.yml when registers are present', () => {
      const { mmYamlText, mmFileName } = parseComponentXmlText(AXI4LITE_XML);
      expect(mmYamlText).toBeDefined();
      expect(mmFileName).toBe('axi_gpio.mm.yml');
    });

    it('does not generate mm.yml when no registers', () => {
      const { mmYamlText } = parseComponentXmlText(MINIMAL_XML);
      expect(mmYamlText).toBeUndefined();
    });

    it('includes import reference in ip.yml when mm.yml generated', () => {
      const { ipYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const doc = parseYaml(ipYamlText) as { memoryMaps?: { import: string } };
      expect(doc.memoryMaps?.import).toBe('axi_gpio.mm.yml');
    });

    it('extracts register names and address offsets', () => {
      const { mmYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const mm = parseYaml(mmYamlText!) as {
        addressBlocks: Array<{ registers: Array<{ name: string; addressOffset: string }> }>;
      };
      const regs = mm.addressBlocks[0].registers;
      expect(regs.find((r) => r.name === 'GPIO_DATA')).toBeDefined();
      expect(regs.find((r) => r.name === 'GPIO_TRI')).toBeDefined();
      expect(regs.find((r) => r.name === 'GPIO_DATA')!.addressOffset).toBe('0x00');
      expect(regs.find((r) => r.name === 'GPIO_TRI')!.addressOffset).toBe('0x04');
    });

    it('extracts field definitions with bitOffset and bitWidth', () => {
      const { mmYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const mm = parseYaml(mmYamlText!) as {
        addressBlocks: Array<{
          registers: Array<{
            name: string;
            fields: Array<{ name: string; bitOffset: number; bitWidth: number }>;
          }>;
        }>;
      };
      const gpioReg = mm.addressBlocks[0].registers.find((r) => r.name === 'GPIO_DATA')!;
      expect(gpioReg.fields[0].name).toBe('DATA');
      expect(gpioReg.fields[0].bitOffset).toBe(0);
      expect(gpioReg.fields[0].bitWidth).toBe(32);
    });

    it('includes reset value when present', () => {
      const { mmYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const mm = parseYaml(mmYamlText!) as {
        addressBlocks: Array<{
          registers: Array<{
            name: string;
            fields: Array<{ name: string; reset?: number }>;
          }>;
        }>;
      };
      const triReg = mm.addressBlocks[0].registers.find((r) => r.name === 'GPIO_TRI')!;
      expect(triReg.fields[0].reset).toBe(0xffffffff);
    });

    it('includes description in registers', () => {
      const { mmYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const mm = parseYaml(mmYamlText!) as {
        addressBlocks: Array<{
          registers: Array<{ name: string; description?: string }>;
        }>;
      };
      const gpioReg = mm.addressBlocks[0].registers.find((r) => r.name === 'GPIO_DATA')!;
      expect(gpioReg.description).toBe('GPIO Data Register');
    });

    it('extracts address block metadata', () => {
      const { mmYamlText } = parseComponentXmlText(AXI4LITE_XML);
      const mm = parseYaml(mmYamlText!) as {
        addressBlocks: Array<{ name: string; baseAddress: string; range: number; width: number }>;
      };
      const ab = mm.addressBlocks[0];
      expect(ab.name).toBe('Reg');
      expect(ab.baseAddress).toBe('0x00000000');
      expect(ab.range).toBe(4096);
      expect(ab.width).toBe(32);
    });
  });
});

// ---------------------------------------------------------------------------
// Component with subCoreRef in fileSets (new format, generated by IPCraft)
// ---------------------------------------------------------------------------
const SUBCORES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component
  xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"
  xmlns:xilinx="http://www.xilinx.com">
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>top_ip</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:fileSets>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlsynthesis_xilinx_com_ip_fifo_generator_13_2__ref_view_fileset</spirit:name>
      <spirit:vendorExtensions>
        <xilinx:subCoreRef>
          <xilinx:componentRef xilinx:vendor="xilinx.com" xilinx:library="ip" xilinx:name="fifo_generator" xilinx:version="13.2">
            <xilinx:mode xilinx:name="create_mode"/>
          </xilinx:componentRef>
        </xilinx:subCoreRef>
      </spirit:vendorExtensions>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlbehavioralsimulation_xilinx_com_ip_fifo_generator_13_2__ref_view_fileset</spirit:name>
      <spirit:vendorExtensions>
        <xilinx:subCoreRef>
          <xilinx:componentRef xilinx:vendor="xilinx.com" xilinx:library="ip" xilinx:name="fifo_generator" xilinx:version="13.2">
            <xilinx:mode xilinx:name="create_mode"/>
          </xilinx:componentRef>
        </xilinx:subCoreRef>
      </spirit:vendorExtensions>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlsynthesis_acme_com_user_my_block_2_0__ref_view_fileset</spirit:name>
      <spirit:vendorExtensions>
        <xilinx:subCoreRef>
          <xilinx:componentRef xilinx:vendor="acme.com" xilinx:library="user" xilinx:name="my_block" xilinx:version="2.0">
            <xilinx:mode xilinx:name="create_mode"/>
          </xilinx:componentRef>
        </xilinx:subCoreRef>
      </spirit:vendorExtensions>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlbehavioralsimulation_acme_com_user_my_block_2_0__ref_view_fileset</spirit:name>
      <spirit:vendorExtensions>
        <xilinx:subCoreRef>
          <xilinx:componentRef xilinx:vendor="acme.com" xilinx:library="user" xilinx:name="my_block" xilinx:version="2.0">
            <xilinx:mode xilinx:name="create_mode"/>
          </xilinx:componentRef>
        </xilinx:subCoreRef>
      </spirit:vendorExtensions>
    </spirit:fileSet>
  </spirit:fileSets>
</spirit:component>`;

// Component with legacy subCoreRef in coreExtensions (vlnv format, for backward compat)
const SUBCORES_LEGACY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component
  xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"
  xmlns:xilinx="http://www.xilinx.com">
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>top_ip</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:vendorExtensions>
    <xilinx:coreExtensions>
      <xilinx:subCoreRef>
        <xilinx:vlnv xilinx:vendor="xilinx.com" xilinx:library="ip" xilinx:name="fifo_generator" xilinx:version="13.2"/>
      </xilinx:subCoreRef>
      <xilinx:subCoreRef>
        <xilinx:vlnv xilinx:vendor="acme.com" xilinx:library="user" xilinx:name="my_block" xilinx:version="2.0"/>
      </xilinx:subCoreRef>
    </xilinx:coreExtensions>
  </spirit:vendorExtensions>
</spirit:component>`;

// ---------------------------------------------------------------------------
// Component with spirit:fileSets containing actual source files
// ---------------------------------------------------------------------------
const FILESETS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>my_core</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:fileSets>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlsynthesis_view_fileset</spirit:name>
      <spirit:file>
        <spirit:name>hdl/my_core.vhd</spirit:name>
        <spirit:fileType>vhdlSource</spirit:fileType>
        <spirit:logicalName>work</spirit:logicalName>
      </spirit:file>
      <spirit:file>
        <spirit:name>constraints/my_core.xdc</spirit:name>
        <spirit:fileType>xdcSource</spirit:fileType>
      </spirit:file>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_verilogsynthesis_view_fileset</spirit:name>
      <spirit:file>
        <spirit:name>hdl/my_core.vhd</spirit:name>
        <spirit:fileType>vhdlSource</spirit:fileType>
      </spirit:file>
      <spirit:file>
        <spirit:name>hdl/my_core_extra.v</spirit:name>
        <spirit:fileType>verilogSource</spirit:fileType>
      </spirit:file>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlbehavioralsimulation_view_fileset</spirit:name>
      <spirit:file>
        <spirit:name>sim/my_core_tb.vhd</spirit:name>
        <spirit:fileType>vhdlSource</spirit:fileType>
        <spirit:isIncludeFile>true</spirit:isIncludeFile>
      </spirit:file>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_xpgui_view_fileset</spirit:name>
      <spirit:file>
        <spirit:name>xgui/my_core_v1_0.tcl</spirit:name>
        <spirit:fileType>tclSource</spirit:fileType>
      </spirit:file>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_productguide_view_fileset</spirit:name>
      <spirit:file>
        <spirit:name>http://www.xilinx.com/docs/pg001.pdf</spirit:name>
      </spirit:file>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>xilinx_vhdlsynthesis_xilinx_com_ip_sub_core_1_0__ref_view_fileset</spirit:name>
      <spirit:file>
        <spirit:name>hdl/sub_core.vhd</spirit:name>
        <spirit:fileType>vhdlSource</spirit:fileType>
      </spirit:file>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>empty_fileset</spirit:name>
    </spirit:fileSet>
    <spirit:fileSet>
      <spirit:name>custom_fileset</spirit:name>
      <spirit:file>
        <spirit:name>doc/readme.md</spirit:name>
        <spirit:fileType>markdown</spirit:fileType>
      </spirit:file>
    </spirit:fileSet>
  </spirit:fileSets>
</spirit:component>`;

describe('fileSets extraction', () => {
  it('maps xilinx_vhdlsynthesis_view_fileset to RTL_Sources', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    expect(doc.fileSets.find((f) => f.name === 'RTL_Sources')).toBeDefined();
  });

  it('maps xilinx_vhdlbehavioralsimulation_view_fileset to Simulation_Resources', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    expect(doc.fileSets.find((f) => f.name === 'Simulation_Resources')).toBeDefined();
  });

  it('maps xilinx_xpgui_view_fileset to Integration', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    expect(doc.fileSets.find((f) => f.name === 'Integration')).toBeDefined();
  });

  it('merges multiple synthesis filesets into one RTL_Sources and deduplicates', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as {
      fileSets: Array<{ name: string; files: Array<{ path: string }> }>;
    };
    const rtl = doc.fileSets.find((f) => f.name === 'RTL_Sources')!;
    // hdl/my_core.vhd appears in both synthesis filesets — only once in output
    const vhdlFiles = rtl.files.filter((f) => f.path === 'hdl/my_core.vhd');
    expect(vhdlFiles.length).toBe(1);
    // hdl/my_core_extra.v from the second synthesis fileset is included
    expect(rtl.files.find((f) => f.path === 'hdl/my_core_extra.v')).toBeDefined();
  });

  it('adds description to canonical filesets', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as {
      fileSets: Array<{ name: string; description?: string }>;
    };
    expect(doc.fileSets.find((f) => f.name === 'RTL_Sources')?.description).toBe('RTL Sources');
    expect(doc.fileSets.find((f) => f.name === 'Simulation_Resources')?.description).toBe(
      'Simulation Files'
    );
    expect(doc.fileSets.find((f) => f.name === 'Integration')?.description).toBe(
      'Integration Files'
    );
  });

  it('maps spirit fileType values to ip.yml types', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as {
      fileSets: Array<{ name: string; files: Array<{ path: string; type: string }> }>;
    };
    const rtl = doc.fileSets.find((f) => f.name === 'RTL_Sources')!;
    expect(rtl.files.find((f) => f.path === 'hdl/my_core.vhd')?.type).toBe('vhdl');
    expect(rtl.files.find((f) => f.path === 'constraints/my_core.xdc')?.type).toBe('xdc');
    expect(rtl.files.find((f) => f.path === 'hdl/my_core_extra.v')?.type).toBe('verilog');
  });

  it('preserves logicalName when present', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as {
      fileSets: Array<{ name: string; files: Array<{ path: string; logicalName?: string }> }>;
    };
    const rtl = doc.fileSets.find((f) => f.name === 'RTL_Sources')!;
    expect(rtl.files.find((f) => f.path === 'hdl/my_core.vhd')?.logicalName).toBe('work');
  });

  it('marks isIncludeFile when true', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as {
      fileSets: Array<{ name: string; files: Array<{ path: string; isIncludeFile?: boolean }> }>;
    };
    const sim = doc.fileSets.find((f) => f.name === 'Simulation_Resources')!;
    expect(sim.files[0].isIncludeFile).toBe(true);
  });

  it('skips _ref_view_fileset (subcore-owned files)', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    const names = doc.fileSets.map((f) => f.name);
    expect(names.every((n) => !n.endsWith('_ref_view_fileset'))).toBe(true);
  });

  it('skips xilinx_productguide (skipped category)', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    expect(doc.fileSets.find((f) => f.name.includes('productguide'))).toBeUndefined();
  });

  it('passes through non-Vivado fileset names unchanged', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    expect(doc.fileSets.find((f) => f.name === 'custom_fileset')).toBeDefined();
  });

  it('skips empty fileSets', () => {
    const { ipYamlText } = parseComponentXmlText(FILESETS_XML);
    const doc = parseYaml(ipYamlText) as { fileSets: Array<{ name: string }> };
    expect(doc.fileSets.find((f) => f.name === 'empty_fileset')).toBeUndefined();
  });

  it('omits fileSets section when no filesets have files', () => {
    const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
    const doc = parseYaml(ipYamlText) as { fileSets?: unknown };
    expect(doc.fileSets).toBeUndefined();
  });
});

describe('subCoreRef parsing', () => {
  it('extracts subcores from fileSets using componentRef format', () => {
    const { ipYamlText } = parseComponentXmlText(SUBCORES_XML);
    const ip = parseYaml(ipYamlText) as { subcores?: string[] };
    expect(ip.subcores).toBeDefined();
    expect(ip.subcores).toHaveLength(2);
    expect(ip.subcores![0]).toBe('xilinx.com:ip:fifo_generator:13.2');
    expect(ip.subcores![1]).toBe('acme.com:user:my_block:2.0');
  });

  it('deduplicates subcores (synthesis + simulation filesets for same dep)', () => {
    const { ipYamlText } = parseComponentXmlText(SUBCORES_XML);
    const ip = parseYaml(ipYamlText) as { subcores?: string[] };
    expect(ip.subcores).toHaveLength(2); // not 4
  });

  it('extracts subcores from legacy coreExtensions vlnv format', () => {
    const { ipYamlText } = parseComponentXmlText(SUBCORES_LEGACY_XML);
    const ip = parseYaml(ipYamlText) as { subcores?: string[] };
    expect(ip.subcores).toBeDefined();
    expect(ip.subcores).toHaveLength(2);
    expect(ip.subcores![0]).toBe('xilinx.com:ip:fifo_generator:13.2');
    expect(ip.subcores![1]).toBe('acme.com:user:my_block:2.0');
  });

  it('returns no subcores for component without vendorExtensions', () => {
    const { ipYamlText } = parseComponentXmlText(MINIMAL_XML);
    const ip = parseYaml(ipYamlText) as { subcores?: unknown };
    expect(
      ip.subcores === null ||
        ip.subcores === undefined ||
        (Array.isArray(ip.subcores) && ip.subcores.length === 0)
    ).toBe(true);
  });
});
