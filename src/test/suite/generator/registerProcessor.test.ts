/* eslint-disable */
import * as path from 'path';
import {
  normalizeIpCoreData,
  normalizeBusType,
  getBusTypeForTemplate,
  expandBusInterfaces,
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
    it('handles aliases', () => {
      expect(normalizeBusType('AXI4LITE')).toEqual({ libraryKey: 'AXI4L', templateType: 'axil' });
      expect(normalizeBusType('AVMM')).toEqual({ libraryKey: 'AVALON_MM', templateType: 'avmm' });
    });

    it('defaults to AXI4L', () => {
      expect(normalizeBusType('UNKNOWN')).toEqual({ libraryKey: 'AXI4L', templateType: 'axil' });
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
});
