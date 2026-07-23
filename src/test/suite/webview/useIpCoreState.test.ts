import { renderHook, act } from '@testing-library/react';
import { useIpCoreState } from '../../../webview/ipcore/hooks/useIpCoreState';

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

describe('useIpCoreState', () => {
  describe('updateFromYaml', () => {
    it('parses YAML into ipCore state', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml(BASE_YAML, 'my_core.ip.yml'));

      expect(result.current.parseError).toBeNull();
      expect(result.current.fileName).toBe('my_core.ip.yml');
      expect((result.current.ipCore as { clocks?: unknown[] })?.clocks).toHaveLength(1);
    });

    it('aliases snake_case bus_interfaces to camelCase busInterfaces', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() =>
        result.current.updateFromYaml(
          'bus_interfaces:\n  - name: S_AXI\n    type: axi4_lite\n',
          'x.ip.yml'
        )
      );

      const ipCore = result.current.ipCore as { busInterfaces?: Array<{ name: string }> };
      expect(ipCore?.busInterfaces).toHaveLength(1);
      expect(ipCore?.busInterfaces?.[0].name).toBe('S_AXI');
    });

    it('sets a parse error for invalid YAML without clobbering fileName', () => {
      const { result } = renderHook(() => useIpCoreState());
      act(() => result.current.updateFromYaml('not: valid: yaml: [', 'broken.ip.yml'));

      expect(result.current.parseError).not.toBeNull();
      expect(result.current.fileName).toBe('broken.ip.yml');
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
  });
});
