/* eslint-disable */
import * as path from 'path';
import {
  normalizeIpCoreData,
  normalizeBusType,
  getBusTypeForTemplate,
  expandBusInterfaces,
  checkDuplicatePhysicalPrefixes,
  evalWidthExpr,
  getVhdlPortType,
  getActiveBusPortsFromDefinition,
  prepareRegisters,
} from '../../../generator/registerProcessor';

describe('registerProcessor', () => {
  describe('normalizeIpCoreData', () => {
    it('normalizes a minimal IP core', () => {
      const raw = {
        vlnv: { name: 'test' },
        busInterfaces: [],
      };
      const result = normalizeIpCoreData(raw);
      expect(result.vlnv!.name).toBe('test');
      expect(result.busInterfaces).toEqual([]);
      expect(result.parameters).toEqual([]);
      expect(result.clocks).toEqual([]);
    });

    it('collects parameters', () => {
      const raw = {
        parameters: [{ name: 'PARAM', value: 42, dataType: 'int' }],
      };
      const result = normalizeIpCoreData(raw);
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters![0].name).toBe('PARAM');
      expect(result.parameters![0].value).toBe(42);
    });
  });

  describe('normalizeBusType', () => {
    it('handles ipcraft VLNV strings', () => {
      expect(normalizeBusType('ipcraft:busif:axi4_lite:1.0')).toEqual({
        libraryKey: 'AXI4_LITE',
        templateType: 'axil',
      });
      expect(normalizeBusType('ipcraft:busif:axi4_full:1.0')).toEqual({
        libraryKey: 'AXI4_FULL',
        templateType: 'axi4',
      });
      expect(normalizeBusType('ipcraft:busif:axi_stream:1.0')).toEqual({
        libraryKey: 'AXI_STREAM',
        templateType: 'axis',
      });
      expect(normalizeBusType('ipcraft:busif:avalon_mm:1.0')).toEqual({
        libraryKey: 'AVALON_MEMORY_MAPPED',
        templateType: 'avmm',
      });
      expect(normalizeBusType('ipcraft:busif:avalon_st:1.0')).toEqual({
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
      expect(normalizeBusType('user:busif:myif:1.0')).toEqual({
        libraryKey: '',
        templateType: 'custom',
      });
    });
  });

  describe('getBusTypeForTemplate', () => {
    it('returns slave template type', () => {
      const ipCore = {
        busInterfaces: [{ type: 'AVMM', mode: 'slave' }],
      };

      expect(getBusTypeForTemplate(ipCore as any)).toBe('avmm');
    });

    it('defaults to axil', () => {
      const ipCore = { busInterfaces: [] };

      expect(getBusTypeForTemplate(ipCore as any)).toBe('axil');
    });
  });

  describe('expandBusInterfaces', () => {
    it('expands arrays', () => {
      const ipCore = {
        busInterfaces: [
          {
            name: 'CH',
            type: 'AXIS',
            mode: 'master',
            array: { count: 2, indexStart: 0, namingPattern: 'M_CH{index}' },
          },
        ],
      };

      const result = expandBusInterfaces(ipCore as any);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('M_CH0');
      expect(result[1].name).toBe('M_CH1');
    });

    it('substitutes {index} into physicalNamePattern per array instance', () => {
      const ipCore = {
        busInterfaces: [
          {
            name: 'SINK',
            type: 'AVALON_ST',
            mode: 'sink',
            physicalNamePattern: 'asi_{signal}_{index}_i',
            array: { count: 2, indexStart: 0, namingPattern: 'sink_{index}' },
          },
        ],
      };
      const result = expandBusInterfaces(ipCore as any);
      expect(result).toHaveLength(2);
      expect(result[0].physicalNamePattern).toBe('asi_{signal}_0_i');
      expect(result[1].physicalNamePattern).toBe('asi_{signal}_1_i');
    });

    it('round-trips index-varying port names through expand + resolve', () => {
      const ipCore = {
        busInterfaces: [
          {
            name: 'SINK',
            type: 'AVALON_ST',
            mode: 'sink',
            physicalNamePattern: 'asi_{signal}_{index}_i',
            array: { count: 2, indexStart: 0, namingPattern: 'sink_{index}' },
          },
        ],
      };
      const defPorts = [
        { name: 'DATA', presence: 'required', direction: 'out', width: 8 },
        { name: 'VALID', presence: 'required', direction: 'out' },
      ];
      const names = expandBusInterfaces(ipCore as any).flatMap((iface) =>
        getActiveBusPortsFromDefinition(
          defPorts,
          [],
          iface.physicalPrefix ?? '',
          iface.mode ?? '',
          {},
          undefined,
          undefined,
          undefined,
          iface.physicalNamePattern
        ).map((p) => p.name)
      );
      expect(names).toEqual(['asi_data_0_i', 'asi_valid_0_i', 'asi_data_1_i', 'asi_valid_1_i']);
    });

    it('preserves zero-padded indices through expand + resolve with {index:N}', () => {
      const ipCore = {
        busInterfaces: [
          {
            name: 'SINK',
            type: 'AVALON_ST',
            mode: 'sink',
            physicalNamePattern: 'asi_{signal}_{index:2}_i',
            array: { count: 11, indexStart: 0, namingPattern: 'sink_{index:2}' },
          },
        ],
      };
      const defPorts = [
        { name: 'DATA', presence: 'required', direction: 'out', width: 8 },
        { name: 'VALID', presence: 'required', direction: 'out' },
      ];
      const result = expandBusInterfaces(ipCore as any);
      // Instance names keep the zero padding...
      expect(result[0].name).toBe('sink_00');
      expect(result[10].name).toBe('sink_10');
      // ...and so do the resolved physical port names (across the digit boundary).
      const names = result.flatMap((iface) =>
        getActiveBusPortsFromDefinition(
          defPorts,
          [],
          iface.physicalPrefix ?? '',
          iface.mode ?? '',
          {},
          undefined,
          undefined,
          undefined,
          iface.physicalNamePattern
        ).map((p) => p.name)
      );
      expect(names).toContain('asi_valid_00_i');
      expect(names).toContain('asi_valid_09_i');
      expect(names).toContain('asi_valid_10_i');
      expect(names).toContain('asi_data_10_i');
    });

    it('resolves per-signal `*` wildcards via wildcardMatches (mixed _i/_o)', () => {
      const ipCore = {
        busInterfaces: [
          {
            name: 'SINK',
            type: 'AVALON_ST',
            mode: 'sink',
            physicalNamePattern: 'asi_{signal}_{index}_*',
            wildcardMatches: { VALID: 'i', DATA: 'i', READY: 'o' },
            array: { count: 2, indexStart: 0, namingPattern: 'sink_{index}' },
          },
        ],
      };
      const defPorts = [
        { name: 'VALID', presence: 'required', direction: 'out' },
        { name: 'DATA', presence: 'required', direction: 'out', width: 8 },
        { name: 'READY', presence: 'optional', direction: 'in' },
      ];
      const result = expandBusInterfaces(ipCore as any);
      const names = result.flatMap((iface) =>
        getActiveBusPortsFromDefinition(
          defPorts,
          ['READY'],
          iface.physicalPrefix ?? '',
          iface.mode ?? '',
          {},
          undefined,
          undefined,
          undefined,
          iface.physicalNamePattern,
          iface.wildcardMatches
        ).map((p) => p.name)
      );
      expect(names).toEqual(
        expect.arrayContaining([
          'asi_valid_0_i',
          'asi_data_0_i',
          'asi_ready_0_o',
          'asi_valid_1_i',
          'asi_data_1_i',
          'asi_ready_1_o',
        ])
      );
    });

    it('defaults missing physicalPrefix to s_axi_ for a standard bus interface', () => {
      const ipCore = {
        busInterfaces: [{ name: 'bus', type: 'AXI4-Lite', mode: 'slave' }],
      };
      const result = expandBusInterfaces(ipCore as any);
      expect(result[0].physicalPrefix).toBe('s_axi_');
    });

    it('defaults a null physicalPrefix to empty (no prefix) for a conduit interface', () => {
      const ipCore = {
        busInterfaces: [
          {
            name: 'fifo_write',
            type: 'xilinx.com:interface:fifo_write:1.0',
            mode: 'conduit',
            physicalPrefix: null,
            conduitPorts: [{ name: 'fifo_wr_en', direction: 'out', presence: 'required' }],
          },
        ],
      };
      const result = expandBusInterfaces(ipCore as any);
      expect(result[0].physicalPrefix).toBe('');
    });
  });

  describe('getVhdlPortType', () => {
    it('returns std_logic for width 1', () => {
      expect(getVhdlPortType(1, 'SIG')).toBe('std_logic');
    });

    it('returns vector for width > 1', () => {
      expect(getVhdlPortType(8, 'SIG')).toBe('std_logic_vector(7 downto 0)');
    });

    it('returns concrete vector for wide ports without parameterization', () => {
      expect(getVhdlPortType(32, 'AWADDR')).toBe('std_logic_vector(31 downto 0)');
      expect(getVhdlPortType(32, 'WDATA')).toBe('std_logic_vector(31 downto 0)');
      expect(getVhdlPortType(4, 'WSTRB')).toBe('std_logic_vector(3 downto 0)');
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
        { name: 'XCVR_DW', value: 16, dataType: 'natural' },
        { name: 'XCVR_KW', value: 2, dataType: 'natural' },
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
      const parameters = [{ name: 'XCVR_DW', value: 16, dataType: 'natural' }];
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

    it('emits concrete numeric widths for AXI ports with no portWidthOverrides', () => {
      // Simulates the axi4_lite bus definition ports: AWADDR=32, WDATA=32, WSTRB=4
      const defPorts = [
        { name: 'AWADDR', direction: 'out', presence: 'required', width: 32 },
        { name: 'WDATA', direction: 'out', presence: 'required', width: 32 },
        { name: 'WSTRB', direction: 'out', presence: 'required', width: 4 },
        { name: 'RDATA', direction: 'in', presence: 'required', width: 32 },
      ];
      const result = getActiveBusPortsFromDefinition(defPorts, [], 's_axi_', 'slave', {});
      const byName = Object.fromEntries(result.map((p) => [p.logical_name as string, p]));

      expect(byName['AWADDR'].type).toBe('std_logic_vector(31 downto 0)');
      expect(byName['WDATA'].type).toBe('std_logic_vector(31 downto 0)');
      expect(byName['WSTRB'].type).toBe('std_logic_vector(3 downto 0)');
      expect(byName['RDATA'].type).toBe('std_logic_vector(31 downto 0)');
      expect(byName['AWADDR'].is_parameterized).toBe(false);
    });

    it('uses the override expression for parameterized AXI port widths', () => {
      const defPorts = [
        { name: 'AWADDR', direction: 'out', presence: 'required', width: 32 },
        { name: 'WDATA', direction: 'out', presence: 'required', width: 32 },
        { name: 'WSTRB', direction: 'out', presence: 'required', width: 4 },
      ];
      const params = [
        { name: 'C_ADDR_WIDTH', value: 32 },
        { name: 'C_DATA_WIDTH', value: 32 },
      ];
      const overrides = { AWADDR: 'C_ADDR_WIDTH', WDATA: 'C_DATA_WIDTH', WSTRB: 'C_DATA_WIDTH' };
      const result = getActiveBusPortsFromDefinition(
        defPorts,
        [],
        's_',
        'slave',
        overrides,
        params
      );
      const byName = Object.fromEntries(result.map((p) => [p.logical_name as string, p]));

      expect(byName['AWADDR'].type).toBe('std_logic_vector(C_ADDR_WIDTH-1 downto 0)');
      expect(byName['WDATA'].type).toBe('std_logic_vector(C_DATA_WIDTH-1 downto 0)');
      expect(byName['WSTRB'].type).toBe('std_logic_vector((C_DATA_WIDTH/8)-1 downto 0)');
      expect(byName['AWADDR'].is_parameterized).toBe(true);
      expect(byName['AWADDR'].width_expr).toBe('C_ADDR_WIDTH');
    });

    it('uses portNameOverrides to preserve original-case port name suffix', () => {
      const defPorts = [
        { name: 'AWADDR', direction: 'out', presence: 'required', width: 32 },
        { name: 'AWVALID', direction: 'out', presence: 'required', width: 1 },
        { name: 'AWREADY', direction: 'in', presence: 'required', width: 1 },
        { name: 'WDATA', direction: 'out', presence: 'required', width: 32 },
      ];
      const nameOverrides = {
        AWADDR: 'AwAddr',
        AWVALID: 'AwValid',
        AWREADY: 'AwReady',
        WDATA: 'WData',
      };
      const result = getActiveBusPortsFromDefinition(
        defPorts,
        [],
        'S_AxiLite_',
        'slave',
        {},
        undefined,
        nameOverrides
      );
      const byLogical = Object.fromEntries(result.map((p) => [p.logical_name as string, p]));

      expect(byLogical['AWADDR'].name).toBe('S_AxiLite_AwAddr');
      expect(byLogical['AWVALID'].name).toBe('S_AxiLite_AwValid');
      expect(byLogical['AWREADY'].name).toBe('S_AxiLite_AwReady');
      expect(byLogical['WDATA'].name).toBe('S_AxiLite_WData');
    });
  });

  describe('prepareRegisters (Integrative)', () => {
    it('resolves imported memory maps and flattens registers', async () => {
      const fixturePath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const ipCore = normalizeIpCoreData({
        vlnv: { name: 'sample' },
        memoryMaps: { import: 'sample-memmap.yml' },
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
      const result = await prepareRegisters({ ...ipCore, memoryMaps: mockMemMap }, 'dummy.yml');

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

  describe('evalWidthExpr', () => {
    it('resolves a plain parameter name', () => {
      expect(evalWidthExpr('AxiDataWidth_g', { AxiDataWidth_g: 32 })).toBe(32);
    });

    it('evaluates division expression', () => {
      expect(evalWidthExpr('AxiDataWidth_g/8', { AxiDataWidth_g: 32 })).toBe(4);
    });

    it('evaluates multiplication expression', () => {
      expect(evalWidthExpr('AxiDataWidth_g*2', { AxiDataWidth_g: 16 })).toBe(32);
    });

    it('returns undefined when a parameter is not in defaults', () => {
      expect(evalWidthExpr('UnknownParam/8', {})).toBeUndefined();
    });

    it('handles a plain numeric string', () => {
      expect(evalWidthExpr('32', {})).toBe(32);
    });

    it('accepts a Map as paramDefaults', () => {
      const m = new Map([['AxiDataWidth_g', 64]]);
      expect(evalWidthExpr('AxiDataWidth_g/8', m)).toBe(8);
    });

    it('re-evaluates correctly when generic value changes', () => {
      expect(evalWidthExpr('AxiDataWidth_g/8', { AxiDataWidth_g: 32 })).toBe(4);
      expect(evalWidthExpr('AxiDataWidth_g/8', { AxiDataWidth_g: 64 })).toBe(8);
    });
  });
});
