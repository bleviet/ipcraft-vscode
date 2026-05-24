/* eslint-disable */
import * as path from 'path';
import {
  normalizeIpCoreData,
  normalizeBusType,
  getBusTypeForTemplate,
  expandBusInterfaces,
  checkDuplicatePhysicalPrefixes,
  getVhdlPortType,
  getActiveBusPortsFromDefinition,
  prepareRegisters,
} from '../../../generator/registerProcessor';

describe('registerProcessor', () => {
  describe('normalizeIpCoreData', () => {
    it('normalizes a minimal IP core', () => {
      const raw = {
        vlnv: { name: 'test' },
        bus_interfaces: [],
      };
      const result = normalizeIpCoreData(raw);
      expect(result.vlnv!.name).toBe('test');
      expect(result.bus_interfaces).toEqual([]);
      expect(result.parameters).toEqual([]);
      expect(result.clocks).toEqual([]);
    });

    it('collects parameters', () => {
      const raw = {
        parameters: [{ name: 'PARAM', value: 42, data_type: 'int' }],
      };
      const result = normalizeIpCoreData(raw);
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters![0].name).toBe('PARAM');
      expect(result.parameters![0].value).toBe(42);
    });
  });

  describe('normalizeBusType', () => {
    it('handles ipcraft VLNV strings', () => {
      expect(normalizeBusType('ipcraft.busif.axi4_lite.1.0')).toEqual({
        libraryKey: 'AXI4_LITE',
        templateType: 'axil',
      });
      expect(normalizeBusType('ipcraft.busif.axi4_full.1.0')).toEqual({
        libraryKey: 'AXI4_FULL',
        templateType: 'axi4',
      });
      expect(normalizeBusType('ipcraft.busif.axi_stream.1.0')).toEqual({
        libraryKey: 'AXI_STREAM',
        templateType: 'axis',
      });
      expect(normalizeBusType('ipcraft.busif.avalon_mm.1.0')).toEqual({
        libraryKey: 'AVALON_MEMORY_MAPPED',
        templateType: 'avmm',
      });
      expect(normalizeBusType('ipcraft.busif.avalon_st.1.0')).toEqual({
        libraryKey: 'AVALON_STREAMING',
        templateType: 'avst',
      });
    });

    it('handles short aliases', () => {
      expect(normalizeBusType('AXI4LITE')).toEqual({
        libraryKey: 'AXI4_LITE',
        templateType: 'axil',
      });
      expect(normalizeBusType('AVMM')).toEqual({
        libraryKey: 'AVALON_MEMORY_MAPPED',
        templateType: 'avmm',
      });
      expect(normalizeBusType('AVALON_MEMORY_MAPPED')).toEqual({
        libraryKey: 'AVALON_MEMORY_MAPPED',
        templateType: 'avmm',
      });
    });

    it('returns custom for unknown types', () => {
      expect(normalizeBusType('UNKNOWN')).toEqual({
        libraryKey: '',
        templateType: 'custom',
      });
      expect(normalizeBusType('user.busif.myif.1.0')).toEqual({
        libraryKey: '',
        templateType: 'custom',
      });
    });
  });

  describe('getBusTypeForTemplate', () => {
    it('returns slave template type', () => {
      const ipCore = {
        bus_interfaces: [{ type: 'AVMM', mode: 'slave' }],
      };

      expect(getBusTypeForTemplate(ipCore as any)).toBe('avmm');
    });

    it('defaults to axil', () => {
      const ipCore = { bus_interfaces: [] };

      expect(getBusTypeForTemplate(ipCore as any)).toBe('axil');
    });
  });

  describe('expandBusInterfaces', () => {
    it('expands arrays', () => {
      const ipCore = {
        bus_interfaces: [
          {
            name: 'CH',
            type: 'AXIS',
            mode: 'master',
            array: { count: 2, index_start: 0, naming_pattern: 'M_CH{index}' },
          },
        ],
      };

      const result = expandBusInterfaces(ipCore as any);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('M_CH0');
      expect(result[1].name).toBe('M_CH1');
    });
  });

  describe('getVhdlPortType', () => {
    it('returns std_logic for width 1', () => {
      expect(getVhdlPortType(1, 'SIG')).toBe('std_logic');
    });

    it('returns vector for width > 1', () => {
      expect(getVhdlPortType(8, 'SIG')).toBe('std_logic_vector(7 downto 0)');
    });

    it('handles special names', () => {
      expect(getVhdlPortType(32, 'AWADDR')).toBe('std_logic_vector(C_ADDR_WIDTH-1 downto 0)');
    });
  });

  describe('getActiveBusPortsFromDefinition', () => {
    it('filters required and used optional ports', () => {
      const defPorts = [
        { name: 'REQ', presence: 'required' },
        { name: 'OPT', presence: 'optional' },
        { name: 'SKIP', presence: 'optional' },
      ];
      const result = getActiveBusPortsFromDefinition(defPorts, ['OPT'], 's_', 'slave', {});
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.logical_name)).toContain('REQ');
      expect(result.map((p) => p.logical_name)).toContain('OPT');
      expect(result.map((p) => p.logical_name)).not.toContain('SKIP');
    });

    it('inverts port directions for sink mode (Avalon-ST SINK)', () => {
      const defPorts = [
        { name: 'data', direction: 'out', presence: 'required', width: 32 },
        { name: 'valid', direction: 'out', presence: 'required', width: 1 },
        { name: 'ready', direction: 'in', presence: 'required', width: 1 },
      ];
      const result = getActiveBusPortsFromDefinition(defPorts, [], 'avl_st_', 'sink', {});
      const byName = Object.fromEntries(result.map((p) => [p.logical_name, p.direction]));
      expect(byName['data']).toBe('in');
      expect(byName['valid']).toBe('in');
      expect(byName['ready']).toBe('out');
    });

    it('resolves parameter-name widths in bus definition using IP core defaults', () => {
      const defPorts = [
        { name: 'tx_data', direction: 'out', presence: 'required', width: 'XCVR_DW' },
        { name: 'tx_k', direction: 'out', presence: 'required', width: 'XCVR_KW' },
      ];
      const parameters = [
        { name: 'XCVR_DW', value: 16, data_type: 'natural' },
        { name: 'XCVR_KW', value: 2, data_type: 'natural' },
      ];
      const result = getActiveBusPortsFromDefinition(
        defPorts,
        [],
        'xcvr_',
        'master',
        {},
        parameters
      );
      const byName = Object.fromEntries(result.map((p) => [p.logical_name as string, p]));

      expect(byName['tx_data'].width).toBe(16);
      expect(byName['tx_data'].width_expr).toBe('XCVR_DW');
      expect(byName['tx_data'].is_parameterized).toBe(true);
      expect(byName['tx_data'].default_width).toBe(15);
      expect(byName['tx_data'].type).toBe('std_logic_vector(XCVR_DW-1 downto 0)');
      expect(byName['tx_data'].sv_type).toBe('logic [XCVR_DW-1:0]');

      expect(byName['tx_k'].width).toBe(2);
      expect(byName['tx_k'].width_expr).toBe('XCVR_KW');
      expect(byName['tx_k'].is_parameterized).toBe(true);
      expect(byName['tx_k'].type).toBe('std_logic_vector(XCVR_KW-1 downto 0)');
    });

    it('allows portWidthOverrides to override parameter-name widths from bus definition', () => {
      const defPorts = [
        { name: 'tx_data', direction: 'out', presence: 'required', width: 'XCVR_DW' },
      ];
      const parameters = [{ name: 'XCVR_DW', value: 16, data_type: 'natural' }];
      // Override with a fixed number
      const result = getActiveBusPortsFromDefinition(
        defPorts,
        [],
        'xcvr_',
        'master',
        { tx_data: 8 },
        parameters
      );
      expect(result[0].width).toBe(8);
      expect(result[0].width_expr).toBeNull();
      expect(result[0].is_parameterized).toBe(false);
      expect(result[0].type).toBe('std_logic_vector(7 downto 0)');
    });

    it('falls back to width 1 when parameter name not found in defaults', () => {
      const defPorts = [
        { name: 'data', direction: 'out', presence: 'required', width: 'UNKNOWN_PARAM' },
      ];
      const result = getActiveBusPortsFromDefinition(defPorts, [], 'p_', 'master', {}, []);
      expect(result[0].width).toBe(1);
      expect(result[0].width_expr).toBe('UNKNOWN_PARAM');
      expect(result[0].is_parameterized).toBe(true);
    });
  });

  describe('prepareRegisters (Integrative)', () => {
    it('resolves imported memory maps and flattens registers', async () => {
      const fixturePath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const ipCore = normalizeIpCoreData({
        vlnv: { name: 'sample' },
        memory_maps: { import: 'sample-memmap.yml' },
      });

      const result = await prepareRegisters(ipCore, fixturePath);

      // sample-memmap.yml has REGS block with CTRL (0) and STATUS (4)
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('CTRL');
      expect(result[0].offset).toBe(0);
      expect(result[1].name).toBe('STATUS');
      expect(result[1].offset).toBe(4);

      const ctrl = result[0] as any;
      expect(ctrl.fields).toHaveLength(2);
      expect(ctrl.fields[0].name).toBe('ENABLE');
      expect(ctrl.fields[1].name).toBe('RESET');
    });

    it('handles nested counts/strides', async () => {
      const ipCore = normalizeIpCoreData({});
      const rawRegisters = [
        {
          name: 'CHANNEL',
          count: 2,
          stride: 16,
          registers: [{ name: 'VAL', offset: 0, fields: [{ name: 'D', bits: '[31:0]' }] }],
        },
      ];

      const mockMemMap = [{ addressBlocks: [{ registers: rawRegisters }] }] as any;

      // Injecting a manual memmap to avoid file read for this specific test
      const result = await prepareRegisters({ ...ipCore, memory_maps: mockMemMap }, 'dummy.yml');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('CHANNEL_0_VAL');
      expect(result[0].offset).toBe(0);
      expect(result[1].name).toBe('CHANNEL_1_VAL');
      expect(result[1].offset).toBe(16);
    });
  });

  describe('normalizeIpCoreData subcores', () => {
    it('normalizes string subcores to object form', () => {
      const raw = { subcores: ['xilinx.com:ip:fifo_generator:13.2'] };
      const result = normalizeIpCoreData(raw);
      expect(result.subcores).toEqual([{ vlnv: 'xilinx.com:ip:fifo_generator:13.2' }]);
    });

    it('preserves object subcores with path', () => {
      const raw = {
        subcores: [{ vlnv: 'xilinx.com:ip:fifo_generator:13.2', path: '/some/path' }],
      };
      const result = normalizeIpCoreData(raw);
      expect(result.subcores).toEqual([
        { vlnv: 'xilinx.com:ip:fifo_generator:13.2', path: '/some/path' },
      ]);
    });

    it('handles mixed string and object subcores', () => {
      const raw = {
        subcores: [
          'xilinx.com:ip:fifo_generator:13.2',
          { vlnv: 'acme.com:user:my_ip:1.0', path: '/path' },
        ],
      };
      const result = normalizeIpCoreData(raw);
      expect(result.subcores).toHaveLength(2);
      expect(result.subcores![0]).toEqual({ vlnv: 'xilinx.com:ip:fifo_generator:13.2' });
      expect(result.subcores![1]).toEqual({ vlnv: 'acme.com:user:my_ip:1.0', path: '/path' });
    });

    it('returns empty array when no subcores field', () => {
      const raw = { vlnv: { name: 'test' } };
      const result = normalizeIpCoreData(raw);
      expect(result.subcores).toEqual([]);
    });
  });

  describe('checkDuplicatePhysicalPrefixes', () => {
    it('returns null when there are no bus interfaces', () => {
      const ipCore = normalizeIpCoreData({});
      expect(checkDuplicatePhysicalPrefixes(ipCore)).toBeNull();
    });

    it('returns null when all prefixes are unique', () => {
      const ipCore = normalizeIpCoreData({
        busInterfaces: [
          { name: 'bus_a', type: 'AXI4-Lite', mode: 'slave', physicalPrefix: 'a_' },
          { name: 'bus_b', type: 'AXI4-Lite', mode: 'slave', physicalPrefix: 'b_' },
        ],
      });
      expect(checkDuplicatePhysicalPrefixes(ipCore)).toBeNull();
    });

    it('returns error string when two interfaces share the same physicalPrefix', () => {
      const ipCore = normalizeIpCoreData({
        busInterfaces: [
          { name: 'bus_a', type: 'AXI4-Lite', mode: 'slave', physicalPrefix: 's_axi_' },
          { name: 'bus_b', type: 'AXI4-Lite', mode: 'slave', physicalPrefix: 's_axi_' },
        ],
      });
      const result = checkDuplicatePhysicalPrefixes(ipCore);
      expect(result).not.toBeNull();
      expect(result).toContain('s_axi_');
    });

    it('returns null when a single interface has no duplicates', () => {
      const ipCore = normalizeIpCoreData({
        busInterfaces: [
          { name: 'solo', type: 'AXI4-Lite', mode: 'slave', physicalPrefix: 'solo_' },
        ],
      });
      expect(checkDuplicatePhysicalPrefixes(ipCore)).toBeNull();
    });

    it('returns error string when array expansion produces duplicate prefixes (missing {index})', () => {
      const ipCore = normalizeIpCoreData({
        busInterfaces: [
          {
            name: 'bus_arr',
            type: 'AXI4-Lite',
            mode: 'slave',
            physicalPrefix: 's_axi_',
            array: { count: 2, physicalPrefixPattern: 's_axi_' },
          },
        ],
      });
      const result = checkDuplicatePhysicalPrefixes(ipCore);
      expect(result).not.toBeNull();
      expect(result).toContain('s_axi_');
    });

    it('returns null when array expansion with {index} produces unique prefixes', () => {
      const ipCore = normalizeIpCoreData({
        busInterfaces: [
          {
            name: 'bus_arr',
            type: 'AXI4-Lite',
            mode: 'slave',
            physicalPrefix: 's_axi_0_',
            array: { count: 2, physicalPrefixPattern: 's_axi_{index}_' },
          },
        ],
      });
      expect(checkDuplicatePhysicalPrefixes(ipCore)).toBeNull();
    });
  });
});
