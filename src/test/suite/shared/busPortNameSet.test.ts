import { reconstructBusPortNameSet } from '../../../shared/busPortNameSet';
import { builtinBusLibrary } from '../../helpers/busLibrary';

describe('reconstructBusPortNameSet', () => {
  it('uses canonical ports, optional selection, overrides, and clock/reset roles', () => {
    const names = reconstructBusPortNameSet(
      {
        type: 'AXI4S',
        physicalPrefix: 'm_',
        useOptionalPorts: ['TLAST'],
        portNameOverrides: { TDATA: 'payload' },
      },
      builtinBusLibrary()
    );

    expect(names).toContain('m_payload');
    expect(names).toContain('m_tlast');
    expect(names).not.toContain('m_aclk');
    expect(names).not.toContain('m_tkeep');
  });

  it('preserves physical ports for a contract-less imported custom interface', () => {
    expect(
      reconstructBusPortNameSet(
        {
          type: 'acme:interface:custom:1.0',
          rawPortMaps: [{ physical: 'custom_data' }, { physical: 'Custom_Valid' }],
        },
        builtinBusLibrary()
      )
    ).toEqual(new Set(['custom_data', 'custom_valid']));
  });
});
