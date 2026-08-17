import { act, renderHook } from '@testing-library/react';
import { stringify } from 'yaml';
import type { BusInterface } from '../../../domain/ipcore.types';
import { useIpCoreState } from '../../../webview/ipcore/hooks/useIpCoreState';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const AVALON_TYPE = 'xilinx.com:interface:avalon:1.0';

const POLARITY_PORTS = [
  ['byteenable', 'byteenable_n'],
  ['readdatavalid', 'readdatavalid_n'],
  ['waitrequest', 'waitrequest_n'],
  ['read', 'read_n'],
  ['write', 'write_n'],
] as const;

interface CompatibilityCase {
  name: string;
  authored: BusInterface;
  expected: BusInterface;
}

function avalonInterface(overrides: Partial<BusInterface>): BusInterface {
  return {
    name: 'avs',
    type: AVALON_TYPE,
    mode: 'slave',
    ...overrides,
  };
}

const ALIAS_ORDER_CASES: CompatibilityCase[] = POLARITY_PORTS.flatMap(([canonical, activeLow]) => [
  {
    name: `${canonical} followed by ${activeLow} selects active low`,
    authored: avalonInterface({ useOptionalPorts: [canonical, activeLow] }),
    expected: avalonInterface({
      useOptionalPorts: [canonical],
      portPolarityOverrides: { [canonical]: 'activeLow' },
    }),
  },
  {
    name: `${activeLow} followed by ${canonical} selects the active-high default`,
    authored: avalonInterface({ useOptionalPorts: [activeLow, canonical] }),
    expected: avalonInterface({ useOptionalPorts: [canonical] }),
  },
]);

const MIXED_FIELD_CASES: CompatibilityCase[] = POLARITY_PORTS.flatMap(([canonical, activeLow]) => [
  {
    name: `${canonical} active-low selection outranks a canonical keyed-map spelling`,
    authored: avalonInterface({
      useOptionalPorts: [activeLow],
      portNameOverrides: { [canonical]: 'literal' },
    }),
    expected: avalonInterface({
      useOptionalPorts: [canonical],
      portNameOverrides: { [canonical]: 'literal' },
      portPolarityOverrides: { [canonical]: 'activeLow' },
    }),
  },
  {
    name: `${canonical} canonical selection outranks an active-low keyed-map spelling`,
    authored: avalonInterface({
      useOptionalPorts: [canonical],
      portNameOverrides: { [activeLow]: 'literal' },
    }),
    expected: avalonInterface({
      useOptionalPorts: [canonical],
      portNameOverrides: { [canonical]: 'literal' },
    }),
  },
  {
    name: `${activeLow} keyed width fallback selects active low`,
    authored: avalonInterface({ portWidthOverrides: { [activeLow]: 1 } }),
    expected: avalonInterface({
      portWidthOverrides: { [canonical]: 1 },
      portPolarityOverrides: { [canonical]: 'activeLow' },
    }),
  },
  {
    name: `${activeLow} keyed name fallback selects active low and preserves its literal value`,
    authored: avalonInterface({ portNameOverrides: { [activeLow]: 'literal' } }),
    expected: avalonInterface({
      portNameOverrides: { [canonical]: 'literal' },
      portPolarityOverrides: { [canonical]: 'activeLow' },
    }),
  },
  {
    name: `${activeLow} last in a keyed map wins and preserves its literal value`,
    authored: avalonInterface({
      portNameOverrides: { [canonical]: 'first', [activeLow]: 'last' },
    }),
    expected: avalonInterface({
      portNameOverrides: { [canonical]: 'last' },
      portPolarityOverrides: { [canonical]: 'activeLow' },
    }),
  },
  {
    name: `${canonical} last in a keyed map wins without inferring active low`,
    authored: avalonInterface({
      portNameOverrides: { [activeLow]: 'first', [canonical]: 'last' },
    }),
    expected: avalonInterface({ portNameOverrides: { [canonical]: 'last' } }),
  },
  {
    name: `${canonical} explicit override outranks identity and preserves literal spelling`,
    authored: avalonInterface({
      useOptionalPorts: [activeLow],
      portNameOverrides: { [activeLow]: 'literal' },
      portPolarityOverrides: { [canonical]: 'activeHigh' },
    }),
    expected: avalonInterface({
      useOptionalPorts: [canonical],
      portNameOverrides: { [canonical]: 'literal' },
      portPolarityOverrides: { [canonical]: 'activeHigh' },
    }),
  },
]);

const DOCUMENT_CASES: CompatibilityCase[] = [
  {
    name: 'absentPorts keeps historical precedence when identity-bearing lists conflict',
    authored: avalonInterface({ useOptionalPorts: ['read_n'], absentPorts: ['read'] }),
    expected: avalonInterface({ useOptionalPorts: ['read'], absentPorts: ['read'] }),
  },
  {
    name: 'main-compatible canonical active-high documents remain unchanged',
    authored: avalonInterface({
      useOptionalPorts: POLARITY_PORTS.map(([canonical]) => canonical),
    }),
    expected: avalonInterface({
      useOptionalPorts: POLARITY_PORTS.map(([canonical]) => canonical),
    }),
  },
  {
    name: 'new canonical active-low documents remain unchanged',
    authored: avalonInterface({
      useOptionalPorts: POLARITY_PORTS.map(([canonical]) => canonical),
      portPolarityOverrides: Object.fromEntries(
        POLARITY_PORTS.map(([canonical]) => [canonical, 'activeLow'])
      ),
    }),
    expected: avalonInterface({
      useOptionalPorts: POLARITY_PORTS.map(([canonical]) => canonical),
      portPolarityOverrides: Object.fromEntries(
        POLARITY_PORTS.map(([canonical]) => [canonical, 'activeLow'])
      ),
    }),
  },
  ...(['activeHigh', 'activeLow'] as const).map(
    (polarity): CompatibilityCase => ({
      name: `an arbitrary imported physical name remains literal with ${polarity}`,
      authored: avalonInterface({
        useOptionalPorts: ['read'],
        portNameOverrides: { read: 'vendor_literal_read_n' },
        portPolarityOverrides: { read: polarity },
      }),
      expected: avalonInterface({
        useOptionalPorts: ['read'],
        portNameOverrides: { read: 'vendor_literal_read_n' },
        portPolarityOverrides: { read: polarity },
      }),
    })
  ),
  {
    name: 'unsupported interfaces remain unchanged',
    authored: {
      name: 'custom',
      type: 'acme.com:interface:custom:1.0',
      mode: 'slave',
      useOptionalPorts: ['read', 'read_n'],
      portNameOverrides: { read_n: 'vendor_literal' },
      portPolarityOverrides: { read_n: 'activeLow' },
    },
    expected: {
      name: 'custom',
      type: 'acme.com:interface:custom:1.0',
      mode: 'slave',
      useOptionalPorts: ['read', 'read_n'],
      portNameOverrides: { read_n: 'vendor_literal' },
      portPolarityOverrides: { read_n: 'activeLow' },
    },
  },
];

describe('bus port polarity document compatibility', () => {
  it.each([...ALIAS_ORDER_CASES, ...MIXED_FIELD_CASES, ...DOCUMENT_CASES])(
    '$name',
    ({ authored, expected }) => {
      const text = stringify({ busInterfaces: [authored] });
      const { result } = renderHook(() => useIpCoreState());

      act(() =>
        result.current.updateFromYaml(text, 'compatibility.ip.yml', {
          busLibrary: builtinBusLibrary(),
        })
      );

      expect(
        (result.current.ipCore as { busInterfaces?: BusInterface[] }).busInterfaces?.[0]
      ).toEqual(expected);
      expect(result.current.rawYaml).toBe(text);
    }
  );
});
