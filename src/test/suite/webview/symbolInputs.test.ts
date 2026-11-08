import {
  CLOCK_DOMAIN_COLORS,
  clockDomainColor,
  computeSymbolLayout,
  hasMultipleClockDomains,
  isExpandableBus,
  symbolLayoutInputs,
} from '../../../webview/ipcore/components/canvas/symbolInputs';
import { computeLayout } from '../../../webview/ipcore/components/canvas/canvasLayout';
import type { IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const core: IpCore = {
  vlnv: { vendor: 'v', library: 'l', name: 'core', version: '1.0.0' },
  description: 'A core',
  clocks: [
    { name: 'clk_a', direction: 'in' },
    { name: 'clk_b', direction: 'in' },
  ],
  busInterfaces: [
    {
      name: 'S_AXI',
      type: 'ipcraft:busif:axi4_lite:1.0',
      mode: 'slave',
      associatedClock: 'clk_a',
    },
    {
      name: 'M_AXI',
      type: 'ipcraft:busif:axi4_lite:1.0',
      mode: 'master',
      associatedClock: 'clk_b',
    },
  ],
} as unknown as IpCore;

describe('clockDomainColor', () => {
  it('colors by domain only when the core has several clocks', () => {
    expect(clockDomainColor(0, false)).toBeUndefined();
    expect(clockDomainColor(-1, true)).toBeUndefined();
    expect(clockDomainColor(1, true)).toBe(CLOCK_DOMAIN_COLORS[1]);
    expect(clockDomainColor(CLOCK_DOMAIN_COLORS.length, true)).toBe(CLOCK_DOMAIN_COLORS[0]);
  });

  it('detects several clock domains', () => {
    expect(hasMultipleClockDomains(core)).toBe(true);
    expect(hasMultipleClockDomains({ ...core, clocks: [core.clocks![0]] })).toBe(false);
    expect(hasMultipleClockDomains({ vlnv: core.vlnv })).toBe(false);
  });
});

describe('symbolLayoutInputs', () => {
  it('without a library offers no lookups', () => {
    const inputs = symbolLayoutInputs(core, undefined);
    expect(inputs.busDefs('ipcraft:busif:axi4_lite:1.0')).toBeNull();
    expect(inputs.isContractConsumer).toBeUndefined();
    expect(inputs.protocolLabel).toBeUndefined();
    expect(inputs.busResolutionLookup).toBeUndefined();
    expect(inputs.description).toBe('A core');
  });

  it('with a library resolves buses by their contracts', () => {
    const library = builtinBusLibrary();
    const inputs = symbolLayoutInputs(core, library);
    const [slave, master] = core.busInterfaces!;
    expect(inputs.isContractConsumer!(slave)).toBe(true);
    expect(inputs.isContractConsumer!(master)).toBe(false);
    expect(inputs.protocolLabel!(slave.type)).toBeTruthy();
    expect(inputs.busDefs(slave.type)!.length).toBeGreaterThan(0);
    expect(inputs.busResolutionLookup!(slave, 0)).not.toBeNull();
  });

  it('computeSymbolLayout equals computeLayout with the same arguments', () => {
    const library = builtinBusLibrary();
    const inputs = symbolLayoutInputs(core, library);
    const expanded = new Set(['bus:0']);
    expect(computeSymbolLayout(core, inputs, expanded)).toEqual(
      computeLayout(
        core,
        expanded,
        inputs.busDefs,
        'A core',
        inputs.isContractConsumer,
        inputs.protocolLabel,
        inputs.busResolutionLookup
      )
    );
  });
});

describe('isExpandableBus', () => {
  const defs = (type: string) => (type === 'known' ? [] : null);

  it('is true for conduit ports or a defined bus type', () => {
    expect(isExpandableBus({ type: 'known' }, defs)).toBe(true);
    expect(isExpandableBus({ type: 'custom', conduitPorts: [] }, defs)).toBe(true);
    expect(isExpandableBus({ type: 'custom' }, defs)).toBe(false);
  });
});
