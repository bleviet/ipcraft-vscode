import { useEffect } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useIpCoreState } from '../../../webview/ipcore/hooks/useIpCoreState';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const BASE_YAML = `vlnv:
  vendor: acme
  library: user
  name: my_core
  version: "1.0"
clocks:
  - name: clk
ports:
  - name: data_in
    direction: in
    width: 8
`;

const LEGACY_POLARITY_YAML = `# Keep this comment and hex spelling.
vlnv:
  vendor: acme
  library: user
  name: my_core
  version: "1.0"
parameters:
  - name: BASE_ADDR
    value: 0x20
clocks:
  - name: clk
busInterfaces:
  - name: avs
    type: xilinx.com:interface:avalon:1.0
    mode: slave
    useOptionalPorts: [read_n]
`;

describe('useIpCoreState', () => {
  describe('updateFromYaml', () => {
    it('parses YAML into ipCore state', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml(BASE_YAML, 'my_core.ip.yml'));

      expect(result.current.parseError).toBeNull();
      expect(result.current.fileName).toBe('my_core.ip.yml');
      expect((result.current.ipCore as { clocks?: unknown[] })?.clocks).toHaveLength(1);
    });

    it('sets a parse error for invalid YAML without clobbering fileName', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml('not: valid: yaml: [', 'broken.ip.yml'));

      expect(result.current.parseError).not.toBeNull();
      expect(result.current.fileName).toBe('broken.ip.yml');
    });

    it('canonicalizes legacy polarity aliases in memory without rewriting loaded YAML', () => {
      const { result } = renderHook(() => useIpCoreState());

      act(() =>
        result.current.updateFromYaml(LEGACY_POLARITY_YAML, 'legacy.ip.yml', {
          busLibrary: builtinBusLibrary(),
        })
      );

      const bus = (
        result.current.ipCore as {
          busInterfaces?: Array<{
            useOptionalPorts?: string[];
            portPolarityOverrides?: Record<string, string>;
          }>;
        }
      ).busInterfaces?.[0];
      expect(bus).toMatchObject({
        useOptionalPorts: ['read'],
        portPolarityOverrides: { read: 'activeLow' },
      });
      expect(result.current.rawYaml).toBe(LEGACY_POLARITY_YAML);
    });

    it('reports a newer format version as a parse error', () => {
      const { result } = renderHook(() => useIpCoreState());

      act(() =>
        result.current.updateFromYaml(`apiVersion: '1.3'\n${BASE_YAML}`, 'future.ip.yml', {
          busLibrary: builtinBusLibrary(),
        })
      );

      expect(result.current.parseError).toMatch(/apiVersion 1\.3.*up to 1\.2/);
      expect(result.current.ipCore).toBeNull();
    });
  });

  describe('updateIpCore', () => {
    it('edits a single path and re-parses the resulting YAML', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml(BASE_YAML, 'x.ip.yml'));
      act(() => result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));

      const ipCore = result.current.ipCore as { clocks?: Array<{ name: string }> };
      expect(ipCore?.clocks?.[0].name).toBe('sys_clk');
      expect(result.current.rawYaml).toContain('sys_clk');
    });

    it('deletes a path when value is undefined', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml(BASE_YAML, 'x.ip.yml'));
      act(() => result.current.updateIpCore(['ports', 0], undefined));

      const ipCore = result.current.ipCore as { ports?: unknown[] };
      expect(ipCore?.ports ?? []).toHaveLength(0);
    });

    it('persists pending canonicalization with the first user edit in one state transition', () => {
      const rawYamlHistory: string[] = [];
      const { result } = renderHook(() => {
        const hook = useIpCoreState();
        useEffect(() => {
          rawYamlHistory.push(hook.rawYaml);
        }, [hook.rawYaml]);
        return hook;
      });

      act(() =>
        result.current.updateFromYaml(LEGACY_POLARITY_YAML, 'legacy.ip.yml', {
          busLibrary: builtinBusLibrary(),
        })
      );
      act(() => result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));

      expect(rawYamlHistory).toEqual(['', LEGACY_POLARITY_YAML, result.current.rawYaml]);
      expect(result.current.rawYaml).toContain('# Keep this comment and hex spelling.');
      expect(result.current.rawYaml).toContain('value: 0x20');
      expect(result.current.rawYaml).toContain('useOptionalPorts: [ read ]');
      expect(result.current.rawYaml).toContain('portPolarityOverrides:\n      read: activeLow');
      expect(result.current.rawYaml).toContain('name: sys_clk');

      act(() => result.current.updateIpCore(['parameters', 0, 'name'], 'BASE'));
      expect(result.current.rawYaml).toContain('useOptionalPorts: [ read ]');
      expect(result.current.rawYaml).toContain('portPolarityOverrides:\n      read: activeLow');
    });

    it('upgrades a 1.0 file to apiVersion 1.2 with the first edit in one update', () => {
      const rawYamlHistory: string[] = [];
      const { result } = renderHook(() => {
        const hook = useIpCoreState();
        useEffect(() => {
          rawYamlHistory.push(hook.rawYaml);
        }, [hook.rawYaml]);
        return hook;
      });

      act(() =>
        result.current.updateFromYaml(
          `apiVersion: '1.0'\n${LEGACY_POLARITY_YAML}`,
          'legacy.ip.yml',
          {
            busLibrary: builtinBusLibrary(),
          }
        )
      );
      act(() => result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));

      expect(rawYamlHistory).toHaveLength(3);
      expect(result.current.rawYaml).toContain("apiVersion: '1.2'");
      expect(result.current.rawYaml).not.toContain("'1.0'\n#");
      expect(result.current.rawYaml).toContain('portPolarityOverrides:\n      read: activeLow');
      expect(result.current.rawYaml).toContain('name: sys_clk');
      expect(result.current.ipCore?.apiVersion).toBe('1.2');
    });

    it('keeps hex spellings and flush sequences when upgrading on the first edit', () => {
      const source = `vlnv:
  vendor: acme
  library: user
  name: my_core
  version: "1.0"
clocks:
- name: clk
ports:
- name: data_in
  direction: in
  width: 0x0010
`;
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(source, 'hex.ip.yml', { busLibrary: builtinBusLibrary() })
      );
      act(() => result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));

      expect(result.current.rawYaml).toContain('width: 0x0010');
      expect(result.current.rawYaml).toContain('ports:\n- name: data_in\n  direction: in');
      expect(result.current.rawYaml).toContain("apiVersion: '1.2'");
    });

    it('stamps apiVersion 1.2 on a file that declares none', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(BASE_YAML, 'plain.ip.yml', {
          busLibrary: builtinBusLibrary(),
        })
      );
      act(() => result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));

      expect(result.current.ipCore?.apiVersion).toBe('1.2');
      expect(result.current.rawYaml).toMatch(/^apiVersion: ["']1\.2["']$/m);
    });

    it('does not touch apiVersion of a file already at 1.2', () => {
      const source = `apiVersion: '1.2'\n${LEGACY_POLARITY_YAML}`;
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(source, 'current.ip.yml', { busLibrary: builtinBusLibrary() })
      );
      act(() => result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));

      expect(result.current.rawYaml.startsWith("apiVersion: '1.2'\n")).toBe(true);
      expect(result.current.rawYaml.match(/apiVersion/g)).toHaveLength(1);
      expect(result.current.rawYaml).toContain('portPolarityOverrides:\n      read: activeLow');
    });

    it('keeps raw YAML aligned with canonical indices after an edit introduces a legacy alias', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(
          LEGACY_POLARITY_YAML.replace('useOptionalPorts: [read_n]', 'useOptionalPorts: [write]'),
          'legacy.ip.yml',
          { busLibrary: builtinBusLibrary() }
        )
      );
      act(() =>
        result.current.updateIpCore(
          ['busInterfaces', 0, 'useOptionalPorts'],
          ['read', 'read_n', 'write']
        )
      );
      const optionalPorts = () =>
        (result.current.ipCore as { busInterfaces?: Array<{ useOptionalPorts?: string[] }> })
          .busInterfaces?.[0]?.useOptionalPorts;
      const canonical = optionalPorts() ?? [];
      const writeIndex = canonical.indexOf('write');
      expect(canonical).not.toContain('read_n');

      act(() =>
        result.current.updateIpCore(['busInterfaces', 0, 'useOptionalPorts', writeIndex], undefined)
      );

      expect(optionalPorts()).toEqual(canonical.filter((name) => name !== 'write'));
      expect(result.current.rawYaml).not.toContain('read_n');
      expect(result.current.rawYaml).toContain('portPolarityOverrides:');
    });
  });

  describe('updateIpCoreBatch', () => {
    it('applies multiple mutations as a single state transition', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml(BASE_YAML, 'x.ip.yml'));

      act(() =>
        result.current.updateIpCoreBatch([
          [['clocks', 0, 'name'], 'sys_clk'],
          [['ports', 0], undefined],
          [['resets'], [{ name: 'rst_n' }]],
        ])
      );

      const ipCore = result.current.ipCore as {
        clocks?: Array<{ name: string }>;
        ports?: unknown[];
        resets?: Array<{ name: string }>;
      };
      expect(ipCore?.clocks?.[0].name).toBe('sys_clk');
      expect(ipCore?.ports ?? []).toHaveLength(0);
      expect(ipCore?.resets?.[0].name).toBe('rst_n');
    });

    it('produces the same result as applying each mutation sequentially via updateIpCore', () => {
      const sequential = renderHook(() => useIpCoreState());
      act(() => sequential.result.current.updateFromYaml(BASE_YAML, 'x.ip.yml'));
      act(() => sequential.result.current.updateIpCore(['clocks', 0, 'name'], 'sys_clk'));
      act(() => sequential.result.current.updateIpCore(['ports', 0], undefined));

      const batched = renderHook(() => useIpCoreState());
      act(() => batched.result.current.updateFromYaml(BASE_YAML, 'x.ip.yml'));
      act(() =>
        batched.result.current.updateIpCoreBatch([
          [['clocks', 0, 'name'], 'sys_clk'],
          [['ports', 0], undefined],
        ])
      );

      expect(batched.result.current.rawYaml).toBe(sequential.result.current.rawYaml);
    });

    it('is a no-op when there is no ipCore loaded yet', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateIpCoreBatch([[['clocks', 0, 'name'], 'sys_clk']]));

      expect(result.current.ipCore).toBeNull();
    });
  });

  describe('getValidationErrors', () => {
    it('flags a bus interface referencing an unknown clock', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(
          'busInterfaces:\n  - name: S_AXI\n    type: axi4_lite\n    mode: slave\n    associatedClock: missing_clk\n',
          'x.ip.yml'
        )
      );

      const errors = result.current.getValidationErrors();
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'associatedClock', entityName: 'S_AXI' })
      );
    });

    it('returns no errors when references resolve', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(
          'clocks:\n  - name: clk\nbusInterfaces:\n  - name: S_AXI\n    type: axi4_lite\n    mode: slave\n    associatedClock: clk\n',
          'x.ip.yml'
        )
      );

      expect(result.current.getValidationErrors()).toHaveLength(0);
    });

    it('defers memory-map protocol validation until the bus library arrives', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(
          'busInterfaces:\n  - name: S_AXI\n    type: axi4_lite\n    mode: slave\n    memoryMapRef: REGS\nmemoryMaps:\n  - name: REGS\n',
          'x.ip.yml'
        )
      );

      expect(result.current.getValidationErrors()).not.toContainEqual(
        expect.objectContaining({ field: 'memoryMapRef', entityName: 'S_AXI' })
      );
    });
  });

  describe('port field metadata round-trip', () => {
    const FIELDS_YAML = `vlnv:
  vendor: acme
  library: user
  name: my_core
  version: "1.0"
clocks:
  - name: clk
ports:
  - name: o_status
    direction: out
    width: 8
    fields:
      # state machine state
      - name: state
        bits: "[3:0]"
        enumeratedValues:
          0x0: idle
          0xF: error
      - name: mode
        offset: 4
        width: 2
busInterfaces:
  - name: s_axis
    type: ipcraft:busif:axi_stream:1.0
    mode: slave
    physicalPrefix: s_axis_
    portFields:
      TDATA:
        - name: low
          bits: "[7:0]"
  - name: dbg
    type: ipcraft:busif:conduit:1.0
    mode: conduit
    conduitPorts:
      - name: dbg_val
        direction: out
        width: 4
        fields:
          - name: nibble
            bits: "[3:0]"
`;
    const STATUS_FIELDS_BLOCK = FIELDS_YAML.slice(
      FIELDS_YAML.indexOf('    fields:\n      # state'),
      FIELDS_YAML.indexOf('busInterfaces:')
    );

    function load() {
      const hook = renderHook(() => useIpCoreState());
      act(() =>
        hook.result.current.updateFromYaml(FIELDS_YAML, 'f.ip.yml', {
          busLibrary: builtinBusLibrary(),
        })
      );
      return hook;
    }

    type Loaded = {
      ports?: Array<{ name: string; fields?: unknown[] }>;
      busInterfaces?: Array<{
        portFields?: Record<string, unknown[]>;
        conduitPorts?: Array<{ name: string; fields?: unknown[] }>;
      }>;
    };

    function expectAllFieldMetadata(hook: ReturnType<typeof load>, portName = 'o_status') {
      const ipCore = hook.result.current.ipCore as unknown as Loaded;
      expect(ipCore.ports?.find((p) => p.name === portName)?.fields).toHaveLength(2);
      expect(ipCore.busInterfaces?.[0].portFields?.TDATA).toHaveLength(1);
      expect(ipCore.busInterfaces?.[1].conduitPorts?.[0].fields).toHaveLength(1);
    }

    it('keeps field metadata and the fields block text across plain edits', () => {
      const hook = load();

      act(() => hook.result.current.updateIpCore(['ports', 0, 'name'], 'o_state'));
      act(() => hook.result.current.updateIpCore(['busInterfaces', 0, 'physicalPrefix'], 's_'));
      act(() =>
        hook.result.current.updateIpCore(['busInterfaces', 1, 'conduitPorts', 0, 'name'], 'dbg_v')
      );

      expectAllFieldMetadata(hook, 'o_state');
      expect(hook.result.current.rawYaml).toContain(STATUS_FIELDS_BLOCK);
      expect(hook.result.current.rawYaml).toContain('0xF: error');
      expect(hook.result.current.rawYaml).toContain('portFields:\n      TDATA:');
      expect(hook.result.current.rawYaml).toContain('name: nibble');
    });

    it('keeps field metadata when the ports array is rewritten from ipCore.ports plus a new port', () => {
      const hook = load();
      const ports = (hook.result.current.ipCore as unknown as Loaded).ports ?? [];

      act(() =>
        hook.result.current.updateIpCore(
          ['ports'],
          [...ports, { name: 'i_new', direction: 'in', width: 1 }]
        )
      );

      expectAllFieldMetadata(hook);
      expect(hook.result.current.rawYaml).toContain('0xF: error');
      expect(hook.result.current.rawYaml).toContain('i_new');
      expect(hook.result.current.rawYaml).toContain(STATUS_FIELDS_BLOCK);
    });
  });
});
