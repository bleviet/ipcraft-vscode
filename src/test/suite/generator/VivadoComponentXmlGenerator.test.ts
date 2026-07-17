import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  crc32Hex,
  generateComponentXml,
  generateCustomBusDefs,
} from '../../../generator/VivadoComponentXmlGenerator';
import { parseComponentXmlText } from '../../../parser/ComponentXmlParser';
import type { BusDefinitions, IpCoreData } from '../../../generator/types';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';

const compilationOrder = jest.requireActual<typeof import('../../../utils/compilationOrder')>(
  '../../../utils/compilationOrder'
);

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
    busInterfaces: [
      {
        name: 's_axi',
        type: 'ipcraft:busif:axi4_lite:1.0',
        mode: 'slave',
        physicalPrefix: 's_axi_',
        associatedClock: 'clk',
        associatedReset: 'rst_n',
        useOptionalPorts: [],
        portWidthOverrides: {},
      },
    ],
    ports: [{ name: 'out_port', direction: 'out', width: 8 }],
    parameters: [],
    ...overrides,
  };
}

async function gen(overrides: Partial<IpCoreData> = {}, options = {}) {
  return generateComponentXml(makeIp(overrides), BUS_DEFS, options);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateComponentXml', () => {
  describe('VLNV header', () => {
    it('emits vendor, library, name, version', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:vendor>acme</spirit:vendor>');
      expect(xml).toContain('<spirit:library>ip</spirit:library>');
      expect(xml).toContain('<spirit:name>my_core</spirit:name>');
      expect(xml).toContain('<spirit:version>2.0.0</spirit:version>');
    });

    it('uses default vlnv when absent', async () => {
      const xml = await generateComponentXml({ busInterfaces: [] } as IpCoreData, BUS_DEFS);
      expect(xml).toContain('<spirit:vendor>user</spirit:vendor>');
      expect(xml).toContain('<spirit:library>ip</spirit:library>');
      expect(xml).toContain('<spirit:name>ip_core</spirit:name>');
    });

    it('escapes XML special characters', async () => {
      const xml = await gen({ description: 'Core for <test> & "examples"' });
      expect(xml).toContain('Core for &lt;test&gt; &amp; &quot;examples&quot;');
    });
  });

  describe('AXI4-Lite bus interface', () => {
    it('uses xilinx.com interface aximm bus type', async () => {
      const xml = await gen();
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm"'
      );
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm_rtl"'
      );
    });

    it('emits <spirit:slave /> for slave mode', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:slave />');
    });

    it('emits <spirit:master /> for master mode', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 'm_axi',
            type: 'ipcraft:busif:axi4_lite:1.0',
            mode: 'master',
            physicalPrefix: 'm_axi_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      expect(xml).toContain('<spirit:master />');
    });

    it('includes PROTOCOL=AXI4LITE parameter', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>PROTOCOL</spirit:name>');
      expect(xml).toContain('>AXI4LITE<');
    });

    it('builds portMaps from bus library', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>AWADDR</spirit:name>');
      expect(xml).toContain('<spirit:name>s_axi_awaddr</spirit:name>');
      expect(xml).toContain('<spirit:name>WDATA</spirit:name>');
      expect(xml).toContain('<spirit:name>s_axi_wdata</spirit:name>');
    });
  });

  describe('AXI4 Full bus interface', () => {
    it('includes PROTOCOL=AXI4', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 's_axi',
            type: 'ipcraft:busif:axi4_full:1.0',
            mode: 'slave',
            physicalPrefix: 's_axi_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      expect(xml).toContain('>AXI4<');
      expect(xml).not.toContain('>AXI4LITE<');
    });
  });

  describe('AXI-Stream bus interface', () => {
    async function makeAxis(mode: string) {
      return gen({
        busInterfaces: [
          {
            name: 'axis_s',
            type: 'ipcraft:busif:axi_stream:1.0',
            mode,
            physicalPrefix: 'axis_s_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
    }

    it('uses xilinx.com interface axis bus type', async () => {
      const xml = await makeAxis('slave');
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="axis"'
      );
    });

    it('does not include PROTOCOL parameter', async () => {
      const xml = await makeAxis('slave');
      const axisBusSection = xml.slice(
        xml.indexOf('<spirit:busInterface>'),
        xml.indexOf('</spirit:busInterface>') + 22
      );
      expect(axisBusSection).not.toContain('<spirit:name>PROTOCOL</spirit:name>');
    });

    it('emits slave for sink mode', async () => {
      expect(await makeAxis('sink')).toContain('<spirit:slave />');
    });

    it('emits master for source mode', async () => {
      expect(await makeAxis('source')).toContain('<spirit:master />');
    });
  });

  describe('unknown bus type (no bus definition)', () => {
    it('splits a well-formed VLNV type into its real components when busTypeVlnv is absent', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 'custom_if',
            type: 'custom:busif:mybus:1.0',
            mode: 'slave',
            physicalPrefix: 'custom_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      expect(xml).toContain(
        'spirit:vendor="custom" spirit:library="busif" spirit:name="mybus" spirit:version="1.0"'
      );
      expect(xml).not.toContain('spirit:vendor="user.org"');
    });

    it('emits portMaps from conduitPorts for an unsaved custom interface (no busDefinitions entry)', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 'fifo_write',
            type: 'xilinx.com:interface:fifo_write:1.0',
            mode: 'conduit',
            physicalPrefix: null,
            conduitPorts: [
              { name: 'fifo_wr_en', direction: 'out', presence: 'required', width: 1 },
              { name: 'fifo_wr_data', direction: 'out', presence: 'required', width: 8 },
              { name: 'fifo_almost_full', direction: 'in', presence: 'required', width: 1 },
            ],
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      const idx = xml.indexOf('<spirit:name>fifo_write</spirit:name>');
      const block = xml.slice(idx, xml.indexOf('</spirit:busInterface>', idx));
      expect(block).toContain('<spirit:portMaps>');
      // Conduit ports carry their final physical name already — no AXI-style
      // 's_axi_' prefix should be injected when physicalPrefix is unset/null.
      for (const name of ['fifo_wr_en', 'fifo_wr_data', 'fifo_almost_full']) {
        expect(block).toContain(`<spirit:name>${name}</spirit:name>`);
      }
      expect(block).not.toContain('s_axi_');
    });

    it('keeps using already-authored conduitPorts even when the type also matches a known busDefinitions entry', async () => {
      const defsWithFifoWrite: BusDefinitions = {
        ...BUS_DEFS,
        FIFO_WRITE: {
          busType: {
            vendor: 'xilinx.com',
            library: 'interface',
            name: 'fifo_write',
            version: '1.0',
          },
          ports: [
            { name: 'WR_DATA', direction: 'out', presence: 'required' },
            { name: 'WR_EN', width: 1, direction: 'out', presence: 'required' },
            { name: 'FULL', width: 1, direction: 'in', presence: 'optional' },
          ],
        },
      };
      const ip = makeIp({
        busInterfaces: [
          {
            name: 'fifo_write',
            type: 'xilinx.com:interface:fifo_write:1.0',
            mode: 'conduit',
            physicalPrefix: null,
            conduitPorts: [
              { name: 'fifo_wr_en', direction: 'out', presence: 'required', width: 1 },
              { name: 'fifo_wr_data', direction: 'out', presence: 'required', width: 8 },
              { name: 'fifo_almost_full', direction: 'in', presence: 'required', width: 1 },
            ],
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      const xml = await generateComponentXml(ip, defsWithFifoWrite);
      const idx = xml.indexOf('<spirit:name>fifo_write</spirit:name>');
      const block = xml.slice(idx, xml.indexOf('</spirit:busInterface>', idx));

      // busType/abstractionType still correctly declare the real Xilinx interface...
      expect(block).toContain('spirit:vendor="xilinx.com"');
      expect(block).toContain('spirit:name="fifo_write"');
      // ...but the portMaps still reflect the user's own already-wired conduitPorts,
      // not the library's official logical names — switching silently would produce
      // physical port names that don't exist on the user's real HDL entity.
      expect(block).toContain('<spirit:name>fifo_wr_en</spirit:name>');
      expect(block).not.toContain('<spirit:name>WR_EN</spirit:name>');
    });

    it('falls back to user.org with the raw type as name when type is not a valid VLNV', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 'custom_if',
            type: 'mybus',
            mode: 'slave',
            physicalPrefix: 'custom_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      expect(xml).toContain('spirit:vendor="user.org"');
      expect(xml).toContain('spirit:name="mybus"');
    });

    it('uses busTypeVlnv components when present (Avalon Streaming round-trip)', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 'st_source',
            type: 'altera.com:interface:avalon_streaming:19.1',
            busTypeVlnv: {
              vendor: 'altera.com',
              library: 'interface',
              name: 'avalon_streaming',
              version: '19.1',
            },
            mode: 'master',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      expect(xml).toContain('spirit:vendor="altera.com"');
      expect(xml).toContain('spirit:library="interface"');
      expect(xml).toContain('spirit:name="avalon_streaming"');
      expect(xml).toContain('spirit:version="19.1"');
      expect(xml).not.toContain('spirit:vendor="user.org"');
    });

    it('emits rawPortMaps verbatim for unknown bus types', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 'st_source',
            type: 'altera.com:interface:avalon_streaming:19.1',
            busTypeVlnv: {
              vendor: 'altera.com',
              library: 'interface',
              name: 'avalon_streaming',
              version: '19.1',
            },
            rawPortMaps: [
              { logical: 'DATA', physical: 'st_data', direction: 'out' as const, width: 8 },
              { logical: 'VALID', physical: 'st_valid', direction: 'out' as const, width: 1 },
            ],
            mode: 'master',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      // portMaps section
      expect(xml).toContain('<spirit:name>DATA</spirit:name>');
      expect(xml).toContain('<spirit:name>st_data</spirit:name>');
      expect(xml).toContain('<spirit:name>VALID</spirit:name>');
      expect(xml).toContain('<spirit:name>st_valid</spirit:name>');
      // spirit:ports section — physical ports must be declared
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      expect(portsSection).toContain('<spirit:name>st_data</spirit:name>');
      expect(portsSection).toContain('<spirit:name>st_valid</spirit:name>');
    });
  });

  describe('custom bus type (with bus definition)', () => {
    const CUSTOM_BUS_DEFS: BusDefinitions = {
      ...BUS_DEFS,
      MY_PROTO: {
        busType: {
          vendor: 'acme.com',
          library: 'interface',
          name: 'my_proto',
          version: '1.0',
          description: 'A proprietary data bus',
        },
        ports: [
          { name: 'DATA', width: 32, direction: 'out', presence: 'required' },
          { name: 'VALID', width: 1, direction: 'out', presence: 'required' },
          { name: 'READY', width: 1, direction: 'in', presence: 'required' },
        ],
      },
    };

    function makeCustomIp(mode = 'slave') {
      return makeIp({
        busInterfaces: [
          {
            name: 'data_in',
            type: 'acme.com:interface:my_proto:1.0',
            mode,
            physicalPrefix: 'data_in_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
    }

    it('references the custom bus VLNV in component.xml', async () => {
      const xml = await generateComponentXml(makeCustomIp(), CUSTOM_BUS_DEFS);
      expect(xml).toContain('spirit:vendor="acme.com"');
      expect(xml).toContain('spirit:library="interface"');
      expect(xml).toContain('spirit:name="my_proto"');
      expect(xml).toContain('spirit:name="my_proto_rtl"');
      expect(xml).not.toContain('spirit:vendor="user.org"');
    });

    it('emits slave for slave mode', async () => {
      const xml = await generateComponentXml(makeCustomIp('slave'), CUSTOM_BUS_DEFS);
      expect(xml).toContain('<spirit:slave />');
    });

    it('emits master for master mode', async () => {
      const xml = await generateComponentXml(makeCustomIp('master'), CUSTOM_BUS_DEFS);
      expect(xml).toContain('<spirit:master />');
    });

    it('builds portMaps from custom bus definition (slave reverses direction)', async () => {
      const xml = await generateComponentXml(makeCustomIp('slave'), CUSTOM_BUS_DEFS);
      // DATA is out from master → slave receives it (physical input)
      expect(xml).toContain('<spirit:name>DATA</spirit:name>');
      expect(xml).toContain('<spirit:name>data_in_data</spirit:name>');
    });

    it('includes all active ports in model ports', async () => {
      const xml = await generateComponentXml(makeCustomIp(), CUSTOM_BUS_DEFS);
      expect(xml).toContain('<spirit:name>data_in_data</spirit:name>');
      expect(xml).toContain('<spirit:name>data_in_valid</spirit:name>');
      expect(xml).toContain('<spirit:name>data_in_ready</spirit:name>');
    });

    it('resolves parameterized portWidthOverrides using IP core parameters', async () => {
      const ipWithParams = makeIp({
        parameters: [{ name: 'DATA_W', value: 32 }],
        busInterfaces: [
          {
            name: 'data_in',
            type: 'acme.com:interface:my_proto:1.0',
            mode: 'slave',
            physicalPrefix: 'data_in_',
            useOptionalPorts: [],
            portWidthOverrides: { DATA: 'DATA_W' },
          },
        ],
      });
      const xml = await generateComponentXml(ipWithParams, CUSTOM_BUS_DEFS);
      // DATA port should have width=32 (resolved from parameter), not std_logic (width=1)
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      const dataPortIdx = portsSection.indexOf('<spirit:name>data_in_data</spirit:name>');
      expect(dataPortIdx).toBeGreaterThan(-1);
      const dataPortXml = portsSection.slice(dataPortIdx, dataPortIdx + 500);
      // Should render as a vector (width > 1)
      expect(dataPortXml).toContain('<spirit:vector>');
      // Should reference the parameter name in a dependent expression
      expect(dataPortXml).toContain('DATA_W');
    });

    it('uses literal numeric widths from bus definition for a standalone master interface with no overrides', async () => {
      const xml = await generateComponentXml(makeCustomIp('master'), CUSTOM_BUS_DEFS);
      // DATA port is width=32 from the bus definition — should render as vector
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      const dataPortIdx = portsSection.indexOf('<spirit:name>data_in_data</spirit:name>');
      expect(dataPortIdx).toBeGreaterThan(-1);
      const dataPortXml = portsSection.slice(dataPortIdx, dataPortIdx + 300);
      expect(dataPortXml).toContain('<spirit:vector>');
      expect(dataPortXml).toContain('<spirit:left spirit:format="long">31</spirit:left>');
    });

    it('builds spirit:dependency correctly for complex expression port widths (Rb_ByteEna pattern)', async () => {
      // Simulates: Rb_ByteEna : out std_logic_vector((AxiDataWidth_g/8) - 1 downto 0)
      // where AxiDataWidth_g is a generic with default 32.
      const ip = makeIp({
        parameters: [{ name: 'AxiDataWidth_g', value: 32 }],
        ports: [{ name: 'Rb_ByteEna', direction: 'out', width: 'AxiDataWidth_g/8' }],
      });
      const xml = await generateComponentXml(ip, BUS_DEFS);
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      const portIdx = portsSection.indexOf('<spirit:name>Rb_ByteEna</spirit:name>');
      expect(portIdx).toBeGreaterThan(-1);
      const portXml = portsSection.slice(portIdx, portIdx + 600);

      // Must render as a vector (expression is parameterized)
      expect(portXml).toContain('<spirit:vector>');
      // spirit:dependency must contain the full expression with spirit:decode for the param
      expect(portXml).toContain('spirit:resolve="dependent"');
      expect(portXml).toContain('AXIDATAWIDTH_G');
      expect(portXml).toContain('/8');
      // Must NOT use the bare expression as a MODELPARAM_VALUE key (the old bug)
      expect(portXml).not.toContain('MODELPARAM_VALUE.AXIDATAWIDTH_G/8');
    });

    it('resolves complex expression to correct numeric default width', async () => {
      // AxiDataWidth_g=32 → AxiDataWidth_g/8 = 4 bits → left = 3
      const ip = makeIp({
        parameters: [{ name: 'AxiDataWidth_g', value: 32 }],
        ports: [{ name: 'Rb_ByteEna', direction: 'out', width: 'AxiDataWidth_g/8' }],
      });
      const xml = await generateComponentXml(ip, BUS_DEFS);
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      const portIdx = portsSection.indexOf('<spirit:name>Rb_ByteEna</spirit:name>');
      const portXml = portsSection.slice(portIdx, portIdx + 600);
      // Default text value should be 3 (= 4-1, where 4 = 32/8)
      expect(portXml).toContain('>3<');
    });

    it('each interface uses its own portWidthOverrides independently — no cross-interface inheritance', async () => {
      const ipWithBoth = makeIp({
        parameters: [{ name: 'DATA_W', value: 32 }],
        busInterfaces: [
          {
            name: 'data_in',
            type: 'acme.com:interface:my_proto:1.0',
            mode: 'slave',
            physicalPrefix: 'data_in_',
            useOptionalPorts: [],
            portWidthOverrides: { DATA: 'DATA_W' },
          },
          {
            name: 'data_out',
            type: 'acme.com:interface:my_proto:1.0',
            mode: 'master',
            physicalPrefix: 'data_out_',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      const xml = await generateComponentXml(ipWithBoth, CUSTOM_BUS_DEFS);
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));

      // Slave has an explicit override: DATA_W expression must appear
      const slaveIdx = portsSection.indexOf('<spirit:name>data_in_data</spirit:name>');
      expect(slaveIdx).toBeGreaterThan(-1);
      const slavePortXml = portsSection.slice(slaveIdx, slaveIdx + 500);
      expect(slavePortXml).toContain('<spirit:vector>');
      expect(slavePortXml).toContain('DATA_W');

      // Master has no override: must use the bus definition's literal width (32), not the slave's expression
      const masterIdx = portsSection.indexOf('<spirit:name>data_out_data</spirit:name>');
      expect(masterIdx).toBeGreaterThan(-1);
      const masterPortXml = portsSection.slice(masterIdx, masterIdx + 500);
      expect(masterPortXml).toContain('<spirit:vector>');
      expect(masterPortXml).not.toContain('DATA_W');
      expect(masterPortXml).toContain('<spirit:left spirit:format="long">31</spirit:left>');
    });

    it('two sibling interfaces with independent portWidthOverrides each render their own widths', async () => {
      const ipWithBoth = makeIp({
        parameters: [{ name: 'DATA_W', value: 32 }],
        busInterfaces: [
          {
            name: 'data_in',
            type: 'acme.com:interface:my_proto:1.0',
            mode: 'slave',
            physicalPrefix: 'data_in_',
            useOptionalPorts: [],
            portWidthOverrides: { DATA: 'DATA_W' },
          },
          {
            name: 'data_out',
            type: 'acme.com:interface:my_proto:1.0',
            mode: 'master',
            physicalPrefix: 'data_out_',
            useOptionalPorts: [],
            portWidthOverrides: { DATA: 8 },
          },
        ],
      });
      const xml = await generateComponentXml(ipWithBoth, CUSTOM_BUS_DEFS);
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));

      // Slave uses DATA_W expression
      const slaveIdx = portsSection.indexOf('<spirit:name>data_in_data</spirit:name>');
      expect(slaveIdx).toBeGreaterThan(-1);
      expect(portsSection.slice(slaveIdx, slaveIdx + 500)).toContain('DATA_W');

      // Master uses its own literal width 8 (left = 7), not the slave's DATA_W
      const masterIdx = portsSection.indexOf('<spirit:name>data_out_data</spirit:name>');
      expect(masterIdx).toBeGreaterThan(-1);
      const masterPortXml = portsSection.slice(masterIdx, masterIdx + 500);
      expect(masterPortXml).not.toContain('DATA_W');
      expect(masterPortXml).toContain('<spirit:left spirit:format="long">7</spirit:left>');
    });

    it('builds portMaps for workspace-sourced bus definition (source: workspace)', async () => {
      // Verifies that a custom bus definition discovered via WorkspaceBusDefinitionScanner
      // (tagged with source: 'workspace') still emits spirit:portMaps in component.xml.
      const defsWithWorkspaceSource: BusDefinitions = {
        ...CUSTOM_BUS_DEFS,
        MY_PROTO: { ...CUSTOM_BUS_DEFS.MY_PROTO, source: 'workspace' },
      };
      const xml = await generateComponentXml(makeCustomIp('slave'), defsWithWorkspaceSource);
      expect(xml).toContain('<spirit:name>DATA</spirit:name>');
      expect(xml).toContain('<spirit:name>data_in_data</spirit:name>');
    });
  });

  describe('clock bus interface', () => {
    it('uses xilinx.com signal clock bus type', async () => {
      const xml = await gen();
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock"'
      );
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock_rtl"'
      );
    });

    it('portMap CLK -> actual clock port name', async () => {
      const xml = await gen();
      const clockSection = xml.slice(
        xml.indexOf('spirit:name="clock"') - 200,
        xml.indexOf('spirit:name="clock"') + 1000
      );
      expect(clockSection).toContain('<spirit:name>CLK</spirit:name>');
      expect(clockSection).toContain('<spirit:name>clk</spirit:name>');
    });

    it('ASSOCIATED_BUSIF lists bus interfaces using this clock (uppercase)', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>ASSOCIATED_BUSIF</spirit:name>');
      expect(xml).toContain('>S_AXI<');
    });

    it('ASSOCIATED_BUSIF is colon-separated when multiple bus interfaces share a clock', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 's_axi0',
            type: 'ipcraft:busif:axi4_lite:1.0',
            mode: 'slave',
            physicalPrefix: 's_axi0_',
            associatedClock: 'clk',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
          {
            name: 's_axi1',
            type: 'ipcraft:busif:axi4_lite:1.0',
            mode: 'slave',
            physicalPrefix: 's_axi1_',
            associatedClock: 'clk',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      expect(xml).toContain('>S_AXI0:S_AXI1<');
    });

    it('ASSOCIATED_RESET contains the reset port name', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>ASSOCIATED_RESET</spirit:name>');
      expect(xml).toContain('>rst_n<');
    });

    it('omits ASSOCIATED_BUSIF when no bus interfaces reference this clock', async () => {
      const xml = await gen({
        busInterfaces: [
          {
            name: 's_axi',
            type: 'ipcraft:busif:axi4_lite:1.0',
            mode: 'slave',
            physicalPrefix: 's_axi_',
            associatedClock: 'other_clk',
            useOptionalPorts: [],
            portWidthOverrides: {},
          },
        ],
      });
      const clkSection = xml.slice(xml.indexOf('"clock"'), xml.indexOf('"clock"') + 800);
      expect(clkSection).not.toContain('ASSOCIATED_BUSIF');
    });
  });

  describe('reset bus interface', () => {
    it('uses xilinx.com signal reset bus type', async () => {
      const xml = await gen();
      expect(xml).toContain(
        'spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="reset"'
      );
    });

    it('portMap RST -> actual reset port name', async () => {
      const xml = await gen();
      const resetSection = xml.slice(xml.indexOf('"reset"') - 200, xml.indexOf('"reset"') + 800);
      expect(resetSection).toContain('<spirit:name>RST</spirit:name>');
      expect(resetSection).toContain('<spirit:name>rst_n</spirit:name>');
    });

    it('POLARITY=ACTIVE_LOW for activeLow polarity', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>POLARITY</spirit:name>');
      expect(xml).toContain('>ACTIVE_LOW<');
    });

    it('POLARITY=ACTIVE_HIGH for activeHigh polarity', async () => {
      const xml = await gen({ resets: [{ name: 'rst', polarity: 'activeHigh' }] });
      expect(xml).toContain('>ACTIVE_HIGH<');
    });
  });

  describe('model ports', () => {
    it('emits clock port as direction=in with typeName std_logic', async () => {
      const xml = await gen();
      const clkPort = extractPort(xml, 'clk');
      expect(clkPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(clkPort).toContain('<spirit:typeName>std_logic</spirit:typeName>');
      expect(clkPort).not.toContain('<spirit:vector>');
    });

    it('emits reset port as direction=in with typeName std_logic', async () => {
      const xml = await gen();
      const rstPort = extractPort(xml, 'rst_n');
      expect(rstPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(rstPort).toContain('<spirit:typeName>std_logic</spirit:typeName>');
    });

    it('emits single-bit bus port without vector element', async () => {
      const xml = await gen();
      const awvalidPort = extractPort(xml, 's_axi_awvalid');
      expect(awvalidPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(awvalidPort).toContain('<spirit:typeName>std_logic</spirit:typeName>');
      expect(awvalidPort).not.toContain('<spirit:vector>');
    });

    it('emits multi-bit bus port with vector and std_logic_vector', async () => {
      const xml = await gen();
      const awaddrPort = extractPort(xml, 's_axi_awaddr');
      expect(awaddrPort).toContain('<spirit:direction>in</spirit:direction>');
      expect(awaddrPort).toContain('<spirit:vector>');
      expect(awaddrPort).toContain('spirit:format="long">7<');
      expect(awaddrPort).toContain('<spirit:typeName>std_logic_vector</spirit:typeName>');
    });

    it('emits user port width=1 as std_logic without vector', async () => {
      const xml = await gen({ ports: [{ name: 'enable', direction: 'in', width: 1 }] });
      const port = extractPort(xml, 'enable');
      expect(port).toContain('<spirit:typeName>std_logic</spirit:typeName>');
      expect(port).not.toContain('<spirit:vector>');
    });

    it('emits user port width>1 with vector and std_logic_vector', async () => {
      const xml = await gen();
      const port = extractPort(xml, 'out_port');
      expect(port).toContain('<spirit:direction>out</spirit:direction>');
      expect(port).toContain('<spirit:vector>');
      expect(port).toContain('spirit:format="long">7<');
      expect(port).toContain('<spirit:typeName>std_logic_vector</spirit:typeName>');
    });

    it('flips direction for slave bus ports (master-out becomes slave-in)', async () => {
      const xml = await gen();
      const awaddrPort = extractPort(xml, 's_axi_awaddr');
      // AWADDR is out from master perspective → in for slave
      expect(awaddrPort).toContain('<spirit:direction>in</spirit:direction>');
    });

    it('includes ASSOCIATED_RESET and two view refs in wireTypeDef', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:viewNameRef>xilinx_anylanguagesynthesis</spirit:viewNameRef>');
      expect(xml).toContain(
        '<spirit:viewNameRef>xilinx_anylanguagebehavioralsimulation</spirit:viewNameRef>'
      );
    });

    it('emits ports with typeName wire and correct view refs when isSv is true', async () => {
      const xml = await gen({}, { isSv: true });
      const clkPort = extractPort(xml, 'clk');
      expect(clkPort).toContain('<spirit:typeName>wire</spirit:typeName>');
      expect(clkPort).toContain(
        '<spirit:viewNameRef>xilinx_anylanguagesynthesis</spirit:viewNameRef>'
      );
      expect(clkPort).toContain(
        '<spirit:viewNameRef>xilinx_anylanguagebehavioralsimulation</spirit:viewNameRef>'
      );
    });
  });

  describe('views', () => {
    it('emits xilinx_anylanguagesynthesis view for VHDL', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>xilinx_anylanguagesynthesis</spirit:name>');
      expect(xml).toContain(':vivado.xilinx.com:synthesis');
    });

    it('emits xilinx_anylanguagebehavioralsimulation view for VHDL', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>xilinx_anylanguagebehavioralsimulation</spirit:name>');
      expect(xml).toContain(':vivado.xilinx.com:simulation');
    });

    it('emits xilinx_xpgui view', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>xilinx_xpgui</spirit:name>');
    });

    it('uses entity name as modelName', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:modelName>my_core</spirit:modelName>');
    });

    it('emits SystemVerilog anylanguage views when isSv is true', async () => {
      const xml = await gen({}, { isSv: true });
      expect(xml).toContain('<spirit:name>xilinx_anylanguagesynthesis</spirit:name>');
      expect(xml).toContain(
        '<spirit:envIdentifier>:vivado.xilinx.com:synthesis</spirit:envIdentifier>'
      );
      expect(xml).toContain('<spirit:name>xilinx_anylanguagebehavioralsimulation</spirit:name>');
      expect(xml).toContain(
        '<spirit:envIdentifier>:vivado.xilinx.com:simulation</spirit:envIdentifier>'
      );
    });
  });

  describe('file sets', () => {
    it('rtlFiles option populates synthesis and simulation filesets', async () => {
      const xml = await gen({}, { rtlFiles: ['../rtl/my_core.vhd', '../rtl/my_core_pkg.vhd'] });
      expect(xml).toContain('<spirit:name>xilinx_anylanguagesynthesis_view_fileset</spirit:name>');
      expect(xml).toContain(
        '<spirit:name>xilinx_anylanguagebehavioralsimulation_view_fileset</spirit:name>'
      );
      expect(xml).toContain('<spirit:name>../rtl/my_core.vhd</spirit:name>');
    });

    it('uses simFiles option for simulation fileset when provided', async () => {
      const xml = await gen(
        {},
        {
          rtlFiles: ['../rtl/my_core.vhd'],
          simFiles: ['../tb/my_core_tb.vhd'],
        }
      );
      expect(xml).toContain('<spirit:name>../tb/my_core_tb.vhd</spirit:name>');
    });

    it('does not resolve the fileSets fallback when rtlFiles is provided', async () => {
      const resolveSpy = jest.spyOn(compilationOrder, 'resolveFileSetRtlFiles');
      try {
        await generateComponentXml(
          makeIp({
            fileSets: [
              {
                name: 'RTL_Sources',
                files: [{ path: 'rtl/on_disk.vhd', type: 'vhdl' }],
              },
            ],
          }),
          BUS_DEFS,
          {
            rtlFiles: ['../rtl/pre_resolved.vhd'],
            ipCoreDir: '/unused',
          }
        );

        expect(resolveSpy).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('emits xgui fileset with tclSource', async () => {
      const xml = await gen({}, { xguiFile: 'xgui/my_core_v2_0_0.tcl' });
      expect(xml).toContain('<spirit:name>xilinx_xpgui_view_fileset</spirit:name>');
      expect(xml).toContain('<spirit:name>xgui/my_core_v2_0_0.tcl</spirit:name>');
      expect(xml).toContain('<spirit:fileType>tclSource</spirit:fileType>');
    });

    it('derives default xgui path from name and version', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>xgui/my_core_v2_0_0.tcl</spirit:name>');
    });

    // The fileSets fallback (neither rtlFiles nor simFiles supplied) is exercised in
    // production whenever a vendor toolchain has no scaffolder-precomputed rtlFiles list
    // to work from (issue #91, reopened — a prior filename-suffix heuristic mis-sorted
    // non-conventionally-named files). These tests write real temp .vhd files with
    // genuine package/use work.X content and assert the real dependency order, following
    // the fs.mkdtempSync pattern already used in IpCoreScaffolder.test.ts.
    describe('ip.yml fileSets fallback (no rtlFiles/simFiles provided)', () => {
      let tmp: string;

      afterEach(() => {
        if (tmp) {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      });

      function writeVhd(relPath: string, content: string) {
        const full = path.join(tmp, relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }

      it('uses ip.yml fileSets when rtlFiles not provided, reading real content via ipCoreDir', async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-xml-fileset-'));
        writeVhd('rtl/my_core.vhd', 'entity my_core is\nend entity my_core;\n');

        const xml = await generateComponentXml(
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
          { filePathPrefix: '../', ipCoreDir: tmp }
        );
        expect(xml).toContain('<spirit:name>../rtl/my_core.vhd</spirit:name>');
      });

      it('sorts the fallback into real dependency order, defeating a naming-heuristic mis-sort', async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-xml-order-'));
        // Non-conventionally-named pair: 'weird_types.vhd' declares a package that
        // 'main_logic.vhd' depends on. Neither name matches a _pkg/_regs/_core/_bus
        // convention, and 'main_logic.vhd' sorts alphabetically BEFORE 'weird_types.vhd'
        // — a filename heuristic (or the raw declared order, used below) gets this
        // wrong; only real dependency parsing gets it right.
        writeVhd(
          'rtl/main_logic.vhd',
          [
            'library ieee;',
            'use ieee.std_logic_1164.all;',
            'use work.weird_types_pkg.all;',
            '',
            'entity main_logic is',
            '  port (clk : in std_logic);',
            'end entity main_logic;',
            '',
            'architecture rtl of main_logic is',
            'begin',
            'end architecture rtl;',
          ].join('\n')
        );
        writeVhd(
          'rtl/weird_types.vhd',
          [
            'package weird_types_pkg is',
            '  type my_type is (a, b, c);',
            'end package weird_types_pkg;',
          ].join('\n')
        );

        const xml = await generateComponentXml(
          {
            ...makeIp(),
            fileSets: [
              {
                name: 'RTL_Sources',
                files: [
                  { path: 'rtl/main_logic.vhd', type: 'vhdl' },
                  { path: 'rtl/weird_types.vhd', type: 'vhdl' },
                ],
              },
            ],
          } as IpCoreData,
          BUS_DEFS,
          { filePathPrefix: '../', ipCoreDir: tmp }
        );
        const names = Array.from(
          xml.matchAll(/<spirit:name>(\.\.\/rtl\/[^<]+)<\/spirit:name>/g)
        ).map((m) => m[1]);
        // Both the synthesis and simulation filesets render from the same
        // (sorted) fallback list, so each path appears once per fileset.
        expect(names.slice(0, 2)).toEqual(['../rtl/weird_types.vhd', '../rtl/main_logic.vhd']);
      });

      it('preserves the declared fileSets order when ipCoreDir is omitted (degrade, no heuristic tiebreak)', async () => {
        // Same deliberately-wrong-order pair as above, but with no ipCoreDir to read real
        // content from: the fallback must not reorder via any naming heuristic — it just
        // preserves exactly what the user declared.
        const xml = await generateComponentXml(
          {
            ...makeIp(),
            fileSets: [
              {
                name: 'RTL_Sources',
                files: [
                  { path: 'rtl/main_logic.vhd', type: 'vhdl' },
                  { path: 'rtl/weird_types.vhd', type: 'vhdl' },
                ],
              },
            ],
          } as IpCoreData,
          BUS_DEFS,
          { filePathPrefix: '../' }
        );
        const names = Array.from(
          xml.matchAll(/<spirit:name>(\.\.\/rtl\/[^<]+)<\/spirit:name>/g)
        ).map((m) => m[1]);
        expect(names.slice(0, 2)).toEqual(['../rtl/main_logic.vhd', '../rtl/weird_types.vhd']);
      });
    });

    describe('VHDL version', () => {
      it('defaults unspecified VHDL files to userFileType vhdlSource-2008', async () => {
        const xml = await gen({}, { rtlFiles: ['../rtl/my_core.vhd'] });
        expect(xml).toContain('<spirit:userFileType>vhdlSource-2008</spirit:userFileType>');
        expect(xml).not.toContain('<spirit:fileType>vhdlSource</spirit:fileType>');
      });

      it('registers a file marked version 93 as plain vhdlSource', async () => {
        const xml = await generateComponentXml(
          {
            ...makeIp(),
            fileSets: [
              {
                name: 'RTL_Sources',
                files: [{ path: 'rtl/my_core.vhd', type: 'vhdl', version: '93' }],
              },
            ],
          } as IpCoreData,
          BUS_DEFS,
          { filePathPrefix: '../', rtlFiles: ['../rtl/my_core.vhd'] }
        );
        expect(xml).toContain('<spirit:fileType>vhdlSource</spirit:fileType>');
        expect(xml).not.toContain('vhdlSource-93');
      });

      it('registers a file marked version 2002 as userFileType vhdlSource-2002', async () => {
        const xml = await generateComponentXml(
          {
            ...makeIp(),
            fileSets: [
              {
                name: 'RTL_Sources',
                files: [{ path: 'rtl/my_core.vhd', type: 'vhdl', version: '2002' }],
              },
            ],
          } as IpCoreData,
          BUS_DEFS,
          { filePathPrefix: '../', rtlFiles: ['../rtl/my_core.vhd'] }
        );
        expect(xml).toContain('<spirit:userFileType>vhdlSource-2002</spirit:userFileType>');
      });

      describe('resolves per-file version via the fileSets fallback (no rtlFiles)', () => {
        let tmp: string;

        afterEach(() => {
          if (tmp) {
            fs.rmSync(tmp, { recursive: true, force: true });
          }
        });

        it('resolves per-file version from ip.yml fileSets when rtlFiles not provided', async () => {
          tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-xml-version-'));
          fs.mkdirSync(path.join(tmp, 'rtl'), { recursive: true });
          fs.writeFileSync(
            path.join(tmp, 'rtl', 'my_core.vhd'),
            'entity my_core is\nend entity my_core;\n'
          );

          const xml = await generateComponentXml(
            {
              ...makeIp(),
              fileSets: [
                {
                  name: 'RTL_Sources',
                  files: [{ path: 'rtl/my_core.vhd', type: 'vhdl', version: '93' }],
                },
              ],
            } as IpCoreData,
            BUS_DEFS,
            { filePathPrefix: '../', ipCoreDir: tmp }
          );
          expect(xml).toContain('<spirit:fileType>vhdlSource</spirit:fileType>');
        });
      });

      it('does not apply VHDL version markers to SystemVerilog files', async () => {
        const xml = await gen({}, { rtlFiles: ['../rtl/my_core.sv'], isSv: true });
        expect(xml).toContain('<spirit:fileType>systemVerilogSource</spirit:fileType>');
        expect(xml).not.toContain('vhdlSource');
      });
    });
  });

  describe('description and parameters', () => {
    it('emits description element', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:description>A test core</spirit:description>');
    });

    it('emits Component_Name parameter', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:name>Component_Name</spirit:name>');
      expect(xml).toContain('PARAM_VALUE.Component_Name');
      expect(xml).toContain('>my_core_v2_0_0<');
    });

    it('emits integer parameter with format=long and resolve=user', async () => {
      const xml = await gen({
        parameters: [{ name: 'C_DATA_WIDTH', value: 32, dataType: 'integer' }],
      });
      expect(xml).toContain('<spirit:name>C_DATA_WIDTH</spirit:name>');
      expect(xml).toContain('spirit:format="long"');
      expect(xml).toContain('spirit:resolve="user"');
      expect(xml).toContain('>32<');
    });

    it('emits string parameter with format=string', async () => {
      const xml = await gen({
        parameters: [{ name: 'C_PROTOCOL', value: 'AXI4', dataType: 'string' }],
      });
      expect(xml).toContain('spirit:format="string"');
      expect(xml).toContain('>AXI4<');
    });

    it('normalizes natural/positive to integer in modelParameter dataType', async () => {
      const xml = await gen({
        parameters: [{ name: 'DEPTH', value: 8, dataType: 'natural' }],
      });
      expect(xml).toContain('spirit:dataType="integer"');
      expect(xml).not.toContain('spirit:dataType="natural"');
    });

    it('emits choices and choiceRef elements when parameter has allowed values', async () => {
      const xml = await gen({
        parameters: [
          { name: 'C_CHOICE_PARAM', value: 8, dataType: 'integer', allowedValues: [4, 8, 16] },
        ],
      });
      expect(xml).toContain('<spirit:choices>');
      expect(xml).toContain('<spirit:name>choice_C_CHOICE_PARAM</spirit:name>');
      expect(xml).toContain('<spirit:enumeration>4</spirit:enumeration>');
      expect(xml).toContain('<spirit:enumeration>8</spirit:enumeration>');
      expect(xml).toContain('<spirit:enumeration>16</spirit:enumeration>');
      expect(xml).toContain('spirit:choiceRef="choice_C_CHOICE_PARAM"');
    });

    it('does not emit spirit:rangeType when parameter has allowedValues', async () => {
      const xml = await gen({
        parameters: [
          { name: 'C_CHOICE_PARAM', value: 8, dataType: 'integer', allowedValues: [4, 8, 16] },
        ],
      });
      // rangeType and choiceRef are mutually exclusive in IP-XACT; only choiceRef must appear
      // Match the user parameter line (PARAM_VALUE.*) but not the model parameter line (MODELPARAM_VALUE.*)
      const paramValueLine = xml
        .split('\n')
        .find((l) => l.includes('"PARAM_VALUE.C_CHOICE_PARAM"'));
      expect(paramValueLine).toBeDefined();
      expect(paramValueLine).toContain('spirit:choiceRef');
      expect(paramValueLine).not.toContain('spirit:rangeType');
    });

    it('emits spirit:rangeType for integer parameter with min/max but not allowedValues', async () => {
      const xml = await gen({
        parameters: [{ name: 'DATA_WIDTH', value: 32, dataType: 'integer', min: 8, max: 512 }],
      });
      const paramValueLine = xml.split('\n').find((l) => l.includes('"PARAM_VALUE.DATA_WIDTH"'));
      expect(paramValueLine).toBeDefined();
      expect(paramValueLine).toContain('spirit:rangeType="long"');
      expect(paramValueLine).toContain('spirit:minimum="8"');
      expect(paramValueLine).toContain('spirit:maximum="512"');
      expect(paramValueLine).not.toContain('spirit:choiceRef');
    });

    it('defaults spirit:displayName to the raw parameter name (no mangling)', async () => {
      const xml = await gen({
        parameters: [{ name: 'AXI_ID_WIDTH', value: 4, dataType: 'integer' }],
      });
      expect(xml).toContain('<spirit:displayName>AXI_ID_WIDTH</spirit:displayName>');
      expect(xml).not.toContain('<spirit:displayName>Axi Id Width</spirit:displayName>');
    });

    it('uses an explicit displayName override for spirit:displayName when provided', async () => {
      const xml = await gen({
        parameters: [
          { name: 'AXI_ID_WIDTH', value: 4, dataType: 'integer', displayName: 'AXI ID Width' },
        ],
      });
      expect(xml).toContain('<spirit:displayName>AXI ID Width</spirit:displayName>');
      expect(xml).not.toContain('<spirit:displayName>AXI_ID_WIDTH</spirit:displayName>');
    });
  });

  describe('vendorExtensions', () => {
    it('uses xilinx namespace not amd', async () => {
      const xml = await gen();
      expect(xml).toContain('xmlns:xilinx="http://www.xilinx.com"');
      expect(xml).toContain('<xilinx:coreExtensions>');
      expect(xml).not.toContain('<amd:coreExtensions>');
    });

    it('includes standard supported FPGA families', async () => {
      const xml = await gen();
      expect(xml).toContain('versal');
      expect(xml).toContain('zynquplus');
      expect(xml).toContain('virtex7');
      expect(xml).toContain('kintex7');
      expect(xml).toContain('artix7');
      expect(xml).toContain('spartan7');
      expect(xml).toContain('kintexu');
    });

    it('includes display name derived from entity name', async () => {
      const xml = await gen();
      expect(xml).toContain('<xilinx:displayName>My Core</xilinx:displayName>');
    });

    it('accepts custom display name option', async () => {
      const xml = await gen({}, { displayName: 'Custom Display' });
      expect(xml).toContain('<xilinx:displayName>Custom Display</xilinx:displayName>');
    });

    it('includes xilinx:packagingInfo', async () => {
      const xml = await gen();
      expect(xml).toContain('<xilinx:packagingInfo>');
    });
  });

  describe('xgui checksum', () => {
    it('crc32Hex matches Vivado reference for known content', async () => {
      // Standard CRC32 test vector derived from the Vivado-packaged mydff example
      const known = '# Definitional proc to organize widgets for parameters.\n';
      expect(crc32Hex(known)).toMatch(/^[0-9a-f]{8}$/);
      // Exact match against Vivado's own output for a well-known string
      expect(crc32Hex('123456789')).toBe('cbf43926');
    });

    it('embeds CHECKSUM_ and viewChecksum when xguiChecksum is provided', async () => {
      const xml = await gen({}, { xguiChecksum: 'abcd1234' });
      expect(xml).toContain('<spirit:userFileType>CHECKSUM_abcd1234</spirit:userFileType>');
      expect(xml).toContain('<spirit:name>viewChecksum</spirit:name>');
      expect(xml).toContain('<spirit:value>abcd1234</spirit:value>');
    });

    it('omits CHECKSUM_ and viewChecksum when no xguiChecksum provided', async () => {
      const xml = await gen();
      expect(xml).not.toContain('CHECKSUM_');
      expect(xml).not.toContain('viewChecksum');
    });
  });

  describe('valid XML structure', () => {
    it('starts with XML declaration', async () => {
      expect(await gen()).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    });

    it('has spirit:component root element', async () => {
      const xml = await gen();
      expect(xml).toContain('<spirit:component ');
      expect(xml).toContain('</spirit:component>');
    });
  });

  describe('interrupts', () => {
    const interrupts = [
      { name: 'irq_out', direction: 'out', sensitivity: 'LEVEL_HIGH' },
      { name: 'irq_in', direction: 'in', sensitivity: 'LEVEL_HIGH' },
    ];

    it('emits interrupt bus interface for output (master)', async () => {
      const xml = await gen({ interrupts } as Partial<IpCoreData>);
      expect(xml).toContain('<spirit:name>irq_out</spirit:name>');
      expect(xml).toContain(
        '<spirit:busType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="interrupt" spirit:version="1.0" />'
      );
      expect(xml).toContain(
        '<spirit:abstractionType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="interrupt_rtl" spirit:version="1.0" />'
      );
      expect(xml).toContain('<spirit:master />');
    });

    it('emits interrupt bus interface for input (slave)', async () => {
      const xml = await gen({ interrupts } as Partial<IpCoreData>);
      expect(xml).toContain('<spirit:name>irq_in</spirit:name>');
      expect(xml).toContain('<spirit:slave />');
    });

    it('maps interrupt port to logical INTERRUPT signal', async () => {
      const xml = await gen({ interrupts } as Partial<IpCoreData>);
      expect(xml).toContain('<spirit:name>INTERRUPT</spirit:name>');
    });

    it('emits SENSITIVITY parameter for interrupt', async () => {
      const xml = await gen({ interrupts } as Partial<IpCoreData>);
      expect(xml).toContain('BUSIFPARAM_VALUE.IRQ_OUT.SENSITIVITY');
      expect(xml).toContain('>LEVEL_HIGH<');
    });

    it('emits physical port in spirit:ports for interrupt output', async () => {
      const xml = await gen({ interrupts } as Partial<IpCoreData>);
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      expect(portsSection).toContain('<spirit:name>irq_out</spirit:name>');
      expect(portsSection).toContain('<spirit:direction>out</spirit:direction>');
    });

    it('emits physical port in spirit:ports for interrupt input', async () => {
      const xml = await gen({ interrupts } as Partial<IpCoreData>);
      const portsSection = xml.slice(xml.indexOf('<spirit:ports>'), xml.indexOf('</spirit:ports>'));
      expect(portsSection).toContain('<spirit:name>irq_in</spirit:name>');
      expect(portsSection).toContain('<spirit:direction>in</spirit:direction>');
    });

    it('emits no interrupt elements when interrupts array is empty', async () => {
      const xml = await gen({ interrupts: [] } as Partial<IpCoreData>);
      expect(xml).not.toContain('spirit:name="interrupt"');
      expect(xml).not.toContain('SENSITIVITY');
    });
  });
});

// ── generateCustomBusDefs ────────────────────────────────────────────────────

// ── generateCustomBusDefs ────────────────────────────────────────────────────

describe('array bus interface expansion', () => {
  const AXIS_IP: IpCoreData = {
    vlnv: { vendor: 'acme', library: 'ip', name: 'axis_core', version: '1.0.0' },
    description: '',
    clocks: [{ name: 'clk' }],
    resets: [{ name: 'rst_n', polarity: 'activeLow' }],
    busInterfaces: [
      {
        name: 'S_AXIS',
        type: 'ipcraft:busif:axi_stream:1.0',
        mode: 'slave',
        physicalPrefix: 's_axis_',
        associatedClock: 'clk',
        associatedReset: 'rst_n',
        useOptionalPorts: [],
        portWidthOverrides: {},
        array: {
          count: 3,
          indexStart: 0,
          namingPattern: 'S_AXIS_{index}',
          physicalPrefixPattern: 's_axis_{index}_',
        },
      },
    ],
    ports: [],
    parameters: [],
  };

  it('expands array interface into N individual bus interface entries', async () => {
    const xml = await generateComponentXml(AXIS_IP, BUS_DEFS);
    expect(xml).toContain('<spirit:name>S_AXIS_0</spirit:name>');
    expect(xml).toContain('<spirit:name>S_AXIS_1</spirit:name>');
    expect(xml).toContain('<spirit:name>S_AXIS_2</spirit:name>');
    expect(xml).not.toContain('<spirit:name>S_AXIS</spirit:name>');
  });

  it('emits physical ports for all expanded array instances', async () => {
    const xml = await generateComponentXml(AXIS_IP, BUS_DEFS);
    // Each expanded instance has its own prefixed physical port (physical names are lowercased)
    expect(xml).toContain('s_axis_0_tdata');
    expect(xml).toContain('s_axis_1_tdata');
    expect(xml).toContain('s_axis_2_tdata');
  });

  it('ASSOCIATED_BUSIF clock parameter lists all expanded instance names', async () => {
    const xml = await generateComponentXml(AXIS_IP, BUS_DEFS);
    // Clock must associate with all expanded instances
    expect(xml).toContain('S_AXIS_0');
    expect(xml).toContain('S_AXIS_1');
    expect(xml).toContain('S_AXIS_2');
  });
});

describe('subcores in vendorExtensions', () => {
  it('emits no subCoreRef elements when subcores is empty', async () => {
    const xml = await gen({ subcores: [] });
    expect(xml).not.toContain('subCoreRef');
  });

  it('emits xilinx:subCoreRef for a single subcore', async () => {
    const xml = await gen({ subcores: [{ vlnv: 'xilinx.com:ip:fifo_generator:13.2' }] });
    expect(xml).toContain('<xilinx:subCoreRef>');
    expect(xml).toContain('xilinx:vendor="xilinx.com"');
    expect(xml).toContain('xilinx:library="ip"');
    expect(xml).toContain('xilinx:name="fifo_generator"');
    expect(xml).toContain('xilinx:version="13.2"');
  });

  it('emits multiple subCoreRef elements for multiple subcores (2 filesets each)', async () => {
    const xml = await gen({
      subcores: [
        { vlnv: 'xilinx.com:ip:fifo_generator:13.2' },
        { vlnv: 'xilinx.com:ip:axi_uartlite:2.0' },
      ],
    });
    const count = (xml.match(/<xilinx:subCoreRef>/g) ?? []).length;
    expect(count).toBe(4); // 2 subcores × 2 filesets (synthesis + simulation)
  });

  it('emits subCoreRef inside spirit:fileSet vendorExtensions, not in coreExtensions', async () => {
    const xml = await gen({ subcores: [{ vlnv: 'xilinx.com:ip:fifo_generator:13.2' }] });
    const extOpen = xml.indexOf('<xilinx:coreExtensions>');
    const extClose = xml.indexOf('</xilinx:coreExtensions>');
    const refIdx = xml.indexOf('<xilinx:subCoreRef>');
    // subCoreRef must be OUTSIDE coreExtensions (either before or after it)
    expect(refIdx).toBeGreaterThan(-1);
    expect(extOpen === -1 || refIdx < extOpen || refIdx > extClose).toBe(true);
  });

  it('emits componentRef (not vlnv) inside subCoreRef', async () => {
    const xml = await gen({ subcores: [{ vlnv: 'xilinx.com:ip:fifo_generator:13.2' }] });
    expect(xml).toContain('<xilinx:componentRef');
    expect(xml).toContain('<xilinx:mode xilinx:name="create_mode"/>');
  });

  it('adds fileSetRef for synthesis and simulation views', async () => {
    const xml = await gen({ subcores: [{ vlnv: 'xilinx.com:ip:fifo_generator:13.2' }] });
    expect(xml).toContain(
      'xilinx_anylanguagesynthesis_xilinx_com_ip_fifo_generator_13_2__ref_view_fileset'
    );
    expect(xml).toContain(
      'xilinx_anylanguagebehavioralsimulation_xilinx_com_ip_fifo_generator_13_2__ref_view_fileset'
    );
  });
});

describe('generateCustomBusDefs', () => {
  const CUSTOM_PORTS = [
    { name: 'DATA', width: 32, direction: 'out', presence: 'required' },
    { name: 'VALID', width: 1, direction: 'out', presence: 'required' },
    { name: 'READY', width: 1, direction: 'in', presence: 'required' },
  ];

  const DEFS_WITH_CUSTOM: BusDefinitions = {
    ...BUS_DEFS,
    MY_PROTO: {
      busType: {
        vendor: 'acme.com',
        library: 'interface',
        name: 'my_proto',
        version: '2.0',
        description: 'Proprietary streaming bus',
      },
      ports: CUSTOM_PORTS,
    },
  };

  const IP_WITH_CUSTOM: IpCoreData = {
    vlnv: { vendor: 'acme', library: 'ip', name: 'my_ip', version: '1.0.0' },
    clocks: [{ name: 'clk' }],
    resets: [],
    busInterfaces: [
      {
        name: 'stream_in',
        type: 'acme.com:interface:my_proto:2.0',
        mode: 'slave',
        physicalPrefix: 's_',
        useOptionalPorts: [],
        portWidthOverrides: {},
      },
    ],
    ports: [],
    parameters: [],
  };

  it('returns empty object when all interfaces are standard types', async () => {
    const ip: IpCoreData = {
      ...IP_WITH_CUSTOM,
      busInterfaces: [
        {
          name: 's_axi',
          type: 'ipcraft:busif:axi4_lite:1.0',
          mode: 'slave',
          physicalPrefix: 's_axi_',
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
      ],
    };
    expect(generateCustomBusDefs(ip, BUS_DEFS)).toEqual({});
  });

  it('returns busdef and abstraction XMLs for a custom interface', async () => {
    const files = generateCustomBusDefs(IP_WITH_CUSTOM, DEFS_WITH_CUSTOM);
    expect(Object.keys(files)).toContain('busdef/my_proto.xml');
    expect(Object.keys(files)).toContain('busdef/my_proto_rtl.xml');
  });

  it('busDefinition XML contains correct VLNV and directConnection', async () => {
    const { 'busdef/my_proto.xml': xml } = generateCustomBusDefs(IP_WITH_CUSTOM, DEFS_WITH_CUSTOM);
    expect(xml).toContain('<spirit:vendor>acme.com</spirit:vendor>');
    expect(xml).toContain('<spirit:library>interface</spirit:library>');
    expect(xml).toContain('<spirit:name>my_proto</spirit:name>');
    expect(xml).toContain('<spirit:version>2.0</spirit:version>');
    expect(xml).toContain('<spirit:directConnection>false</spirit:directConnection>');
    expect(xml).toContain('<spirit:isAddressable>false</spirit:isAddressable>');
    expect(xml).toContain('Proprietary streaming bus');
  });

  it('abstractionDefinition XML lists ports with correct master/slave directions', async () => {
    const { 'busdef/my_proto_rtl.xml': xml } = generateCustomBusDefs(
      IP_WITH_CUSTOM,
      DEFS_WITH_CUSTOM
    );
    expect(xml).toContain('<spirit:name>my_proto_rtl</spirit:name>');
    expect(xml).toContain('<spirit:logicalName>DATA</spirit:logicalName>');
    // DATA: master out → slave in
    const dataBlock = xml.slice(
      xml.indexOf('<spirit:logicalName>DATA</spirit:logicalName>'),
      xml.indexOf('</spirit:port>', xml.indexOf('<spirit:logicalName>DATA</spirit:logicalName>'))
    );
    expect(dataBlock).toContain('<spirit:direction>out</spirit:direction>'); // onMaster
    expect(dataBlock).toContain('<spirit:direction>in</spirit:direction>'); // onSlave
  });

  it('deduplicates when the same custom type appears on multiple interfaces', async () => {
    const ip: IpCoreData = {
      ...IP_WITH_CUSTOM,
      busInterfaces: [
        { ...IP_WITH_CUSTOM.busInterfaces![0], name: 'if_a' },
        { ...IP_WITH_CUSTOM.busInterfaces![0], name: 'if_b' },
      ],
    };
    const files = generateCustomBusDefs(ip, DEFS_WITH_CUSTOM);
    expect(Object.keys(files)).toHaveLength(2); // only one bus def pair
  });

  it('skips busdef generation for interfaces discovered from a local Vivado install', async () => {
    const ip: IpCoreData = {
      ...IP_WITH_CUSTOM,
      busInterfaces: [
        {
          name: 'fifo_write',
          type: 'xilinx.com:interface:fifo_write:1.0',
          mode: 'master',
          physicalPrefix: null,
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
      ],
    };
    const defs: BusDefinitions = {
      ...BUS_DEFS,
      FIFO_WRITE: {
        busType: { vendor: 'xilinx.com', library: 'interface', name: 'fifo_write', version: '1.0' },
        source: 'vivado',
        ports: [{ name: 'WR_EN', width: 1, direction: 'out', presence: 'required' }],
      },
    };
    expect(generateCustomBusDefs(ip, defs)).toEqual({});
  });

  it('still generates busdef files for a user-authored custom type with no source tag', async () => {
    const ip: IpCoreData = {
      ...IP_WITH_CUSTOM,
      busInterfaces: [
        {
          name: 'stream_in',
          type: 'acme.com:interface:my_proto:2.0',
          mode: 'slave',
          physicalPrefix: 's_',
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
      ],
    };
    const files = generateCustomBusDefs(ip, DEFS_WITH_CUSTOM);
    expect(Object.keys(files)).toContain('busdef/my_proto.xml');
  });

  it('generates busdef files for workspace-sourced custom types (source: workspace)', async () => {
    const defs: BusDefinitions = {
      ...BUS_DEFS,
      MY_PROTO: { ...DEFS_WITH_CUSTOM.MY_PROTO, source: 'workspace' },
    };
    const files = generateCustomBusDefs(IP_WITH_CUSTOM, defs);
    expect(Object.keys(files)).toContain('busdef/my_proto.xml');
    expect(Object.keys(files)).toContain('busdef/my_proto_rtl.xml');
  });

  it('generates separate busdef files for two different custom types', async () => {
    const ip: IpCoreData = {
      ...IP_WITH_CUSTOM,
      busInterfaces: [
        {
          name: 'if_a',
          type: 'acme.com:interface:my_proto:2.0',
          mode: 'slave',
          physicalPrefix: 'a_',
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
        {
          name: 'if_b',
          type: 'acme.com:interface:other_bus:1.0',
          mode: 'slave',
          physicalPrefix: 'b_',
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
      ],
    };
    const defs: BusDefinitions = {
      ...DEFS_WITH_CUSTOM,
      OTHER_BUS: {
        busType: { vendor: 'acme.com', library: 'interface', name: 'other_bus', version: '1.0' },
        ports: [{ name: 'SIG', width: 1, direction: 'out', presence: 'required' }],
      },
    };
    const files = generateCustomBusDefs(ip, defs);
    expect(Object.keys(files)).toContain('busdef/my_proto.xml');
    expect(Object.keys(files)).toContain('busdef/other_bus.xml');
    expect(Object.keys(files)).toHaveLength(4); // two bus def pairs
  });
});

// ── Memory maps ─────────────────────────────────────────────────────────────

describe('generateComponentXml memory maps', () => {
  function map(overrides: Partial<NormalizedMemoryMap> = {}): NormalizedMemoryMap {
    return {
      name: 'S_AXI',
      description: '',
      addressBlocks: [
        {
          rowId: 'ab1',
          name: 'Reg',
          baseAddress: 0,
          range: 4096,
          usage: 'register',
          description: '',
          defaultRegWidth: 32,
          registers: [
            {
              rowId: 'r1',
              name: 'CTRL',
              offset: 0,
              size: 32,
              resetValue: 0,
              description: 'Control register',
              fields: [
                {
                  rowId: 'f1',
                  name: 'ENABLE',
                  bits: '[0:0]',
                  offset: 0,
                  width: 1,
                  access: 'read-write',
                  resetValue: 0,
                  description: 'Global enable',
                },
                {
                  rowId: 'f2',
                  name: 'STATE',
                  bits: '[2:1]',
                  offset: 1,
                  width: 2,
                  access: 'read-only',
                  resetValue: 0,
                  description: '',
                },
              ],
            },
            {
              rowId: 'r2',
              name: 'MASK',
              offset: 4,
              size: 32,
              resetValue: 0,
              description: '',
              fields: [
                {
                  rowId: 'f3',
                  name: 'BITS',
                  bits: '[31:0]',
                  offset: 0,
                  width: 32,
                  access: 'read-write',
                  resetValue: 0xffffffff,
                  description: '',
                },
              ],
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  it('emits a <spirit:memoryMaps> tree between busInterfaces and model', async () => {
    const xml = await gen({}, { memoryMaps: [map()] });
    expect(xml).toContain('<spirit:memoryMaps>');
    expect(xml).toContain('<spirit:memoryMap>');
    expect(xml).toContain('<spirit:name>S_AXI</spirit:name>');
    expect(xml).toContain('<spirit:addressBlock>');
    expect(xml).toContain('<spirit:name>Reg</spirit:name>');
    expect(xml).toContain('<spirit:baseAddress spirit:format="long">0</spirit:baseAddress>');
    expect(xml).toContain('<spirit:range spirit:format="long">4096</spirit:range>');
    expect(xml).toContain('<spirit:width spirit:format="long">32</spirit:width>');
    // Ordering: memoryMaps after busInterfaces, before model.
    expect(xml.indexOf('<spirit:busInterfaces>')).toBeLessThan(xml.indexOf('<spirit:memoryMaps>'));
    expect(xml.indexOf('<spirit:memoryMaps>')).toBeLessThan(xml.indexOf('<spirit:model>'));
  });

  it('references the map from its owning slave interface so it is not orphaned', async () => {
    // IP_Flow 19-1980: a memory map must be referenced by a bus interface.
    const ip = makeIp({
      busInterfaces: [
        {
          name: 's_axi',
          type: 'ipcraft:busif:axi4_lite:1.0',
          mode: 'slave',
          memoryMapRef: 'S_AXI',
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
      ],
    });
    const xml = await generateComponentXml(ip, BUS_DEFS, { memoryMaps: [map()] });
    expect(xml).toContain('<spirit:slave>');
    expect(xml).toContain('<spirit:memoryMapRef spirit:memoryMapRef="S_AXI" />');
    // The referenced name matches the emitted <spirit:memoryMap><spirit:name>.
    expect(xml).toContain('<spirit:name>S_AXI</spirit:name>');
    expect(xml.indexOf('<spirit:memoryMapRef')).toBeLessThan(xml.indexOf('<spirit:memoryMaps>'));
  });

  it('keeps a self-closing slave when the interface declares no memoryMapRef', async () => {
    // Default fixture's slave has no memoryMapRef.
    expect(await gen({}, { memoryMaps: [map()] })).toContain('<spirit:slave />');
  });

  it('does not add a memoryMapRef to master interfaces', async () => {
    const ip = makeIp({
      busInterfaces: [
        {
          name: 'm_axi',
          type: 'ipcraft:busif:axi4_lite:1.0',
          mode: 'master',
          memoryMapRef: 'S_AXI',
          useOptionalPorts: [],
          portWidthOverrides: {},
        },
      ],
    });
    const xml = await generateComponentXml(ip, BUS_DEFS, { memoryMaps: [map()] });
    expect(xml).toContain('<spirit:master />');
    expect(xml).not.toContain('<spirit:memoryMapRef');
  });

  it('emits registers with offset, size, access and description', async () => {
    const xml = await gen({}, { memoryMaps: [map()] });
    expect(xml).toContain('<spirit:name>CTRL</spirit:name>');
    expect(xml).toContain('<spirit:description>Control register</spirit:description>');
    expect(xml).toContain('<spirit:addressOffset>0x0</spirit:addressOffset>');
    expect(xml).toContain('<spirit:addressOffset>0x4</spirit:addressOffset>');
    expect(xml).toContain('<spirit:size spirit:format="long">32</spirit:size>');
  });

  it('emits fields with bitOffset, bitWidth and access (no field-level reset)', async () => {
    const xml = await gen({}, { memoryMaps: [map()] });
    expect(xml).toContain('<spirit:name>ENABLE</spirit:name>');
    expect(xml).toContain('<spirit:bitOffset>0</spirit:bitOffset>');
    expect(xml).toContain('<spirit:bitOffset>1</spirit:bitOffset>');
    expect(xml).toContain('<spirit:bitWidth spirit:format="long">2</spirit:bitWidth>');
    // IP-XACT 1685-2009 has no field-level reset. A field-level reset would be
    // indented 12 spaces (a field child); the legal register-level reset is at
    // 10 spaces. Assert no reset appears at field indentation.
    expect(xml).not.toContain('            <spirit:reset>');
  });

  it('emits a register-level <spirit:reset> composed from field resets, after access and before fields', async () => {
    const xml = await gen({}, { memoryMaps: [map()] });
    // MASK register: field BITS resets to 0xFFFFFFFF at offset 0 -> register reset word.
    expect(xml).toContain(
      '<spirit:reset>\n            <spirit:value spirit:format="long">0xFFFFFFFF</spirit:value>\n          </spirit:reset>'
    );
    // CTRL register: all field resets are 0 -> no reset element emitted for it.
    expect(xml).not.toContain('0x0</spirit:value>');
    // Ordering inside the MASK register: access before reset before the first field.
    const mask = xml.slice(xml.indexOf('<spirit:name>MASK</spirit:name>'));
    const accessIdx = mask.indexOf('<spirit:access>');
    const resetIdx = mask.indexOf('<spirit:reset>');
    const fieldIdx = mask.indexOf('<spirit:field>');
    expect(accessIdx).toBeLessThan(resetIdx);
    expect(resetIdx).toBeLessThan(fieldIdx);
  });

  it('derives register access from fields when the register has no explicit access', async () => {
    const xml = await gen({}, { memoryMaps: [map()] });
    // CTRL mixes read-write + read-only fields -> read-write at register level.
    const ctrl = xml.slice(
      xml.indexOf('<spirit:name>CTRL</spirit:name>'),
      xml.indexOf('</spirit:register>', xml.indexOf('CTRL'))
    );
    expect(ctrl).toContain('<spirit:access>read-write</spirit:access>');
  });

  it('omits the section entirely when there are no memory maps', async () => {
    expect(await gen()).not.toContain('<spirit:memoryMaps>');
    expect(await gen({}, { memoryMaps: [] })).not.toContain('<spirit:memoryMaps>');
    // A map with only empty blocks is also omitted.
    const empty = map({ addressBlocks: [] });
    expect(await gen({}, { memoryMaps: [empty] })).not.toContain('<spirit:memoryMaps>');
  });

  it('expands register arrays into individual flat registers', async () => {
    const arrayMap = map({
      addressBlocks: [
        {
          rowId: 'ab1',
          name: 'CHANNELS',
          baseAddress: 0,
          range: null,
          usage: 'register',
          description: '',
          defaultRegWidth: 32,
          registers: [
            {
              rowId: 'ra',
              name: 'CHANNEL',
              offset: 0,
              size: 32,
              resetValue: 0,
              description: '',
              fields: [],
              __kind: 'array',
              count: 2,
              stride: 8,
              registers: [
                {
                  rowId: 'rc',
                  name: 'CTRL',
                  offset: 0,
                  size: 32,
                  resetValue: 0,
                  description: '',
                  fields: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const xml = await gen({}, { memoryMaps: [arrayMap] });
    expect(xml).toContain('<spirit:name>CHANNEL_0_CTRL</spirit:name>');
    expect(xml).toContain('<spirit:name>CHANNEL_1_CTRL</spirit:name>');
    // second instance sits at base + 1 * stride = 8 (0x8)
    expect(xml).toContain('<spirit:addressOffset>0x8</spirit:addressOffset>');
  });

  it('round-trips through ComponentXmlParser (generate -> parse -> .mm.yml)', async () => {
    const xml = await gen({}, { memoryMaps: [map()] });
    const parsed = parseComponentXmlText(xml);
    expect(parsed.mmYamlText).toBeTruthy();
    const mm = yaml.load(parsed.mmYamlText as string) as Array<Record<string, unknown>>;
    expect(Array.isArray(mm)).toBe(true);
    expect(mm[0].name).toBe('S_AXI');

    const blocks = mm[0].addressBlocks as Array<Record<string, unknown>>;
    expect(blocks[0].name).toBe('Reg');
    expect(blocks[0].baseAddress).toBe(0);

    const regs = blocks[0].registers as Array<Record<string, unknown>>;
    expect(regs.map((r) => r.name)).toEqual(['CTRL', 'MASK']);
    expect(regs[0].offset).toBe(0);
    expect(regs[1].offset).toBe(4);

    const ctrlFields = regs[0].fields as Array<Record<string, unknown>>;
    expect(ctrlFields.map((f) => f.name)).toEqual(['ENABLE', 'STATE']);
    expect(ctrlFields[0].bits).toBe('[0:0]');
    expect(ctrlFields[1].bits).toBe('[2:1]');

    const maskFields = regs[1].fields as Array<Record<string, unknown>>;
    expect(maskFields[0].resetValue).toBe(0xffffffff);
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
