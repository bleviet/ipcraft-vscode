import { reconcileObservedBusPorts, type NormalizedBusPort } from '../../../shared/busContracts';

function port(
  name: string,
  width: number,
  presence: NormalizedBusPort['presence']
): NormalizedBusPort {
  return {
    name,
    width,
    direction: 'out',
    presence,
    role: 'control',
    widthPolicy: 'root',
  };
}

describe('reconcileObservedBusPorts', () => {
  it('uses canonical keys for optional, width, and physical-name selections', () => {
    expect(
      reconcileObservedBusPorts(
        [port('DATA', 32, 'required'), port('KEEP', 4, 'optional'), port('READY', 1, 'required')],
        [
          { logicalName: 'data', physicalName: 's_data', width: 64 },
          { logicalName: 'keep', physicalName: 's_keep_i', width: 'DATA_W/8' },
          { logicalName: 'ready', physicalName: 'ready_external', width: 1 },
        ],
        's_'
      )
    ).toEqual({
      useOptionalPorts: ['KEEP'],
      portWidthOverrides: { DATA: 64, KEEP: 'DATA_W/8' },
      portNameOverrides: { KEEP: 'keep_i', READY: 'ready_external' },
    });
  });

  it('omits empty selections when observed ports match the contract', () => {
    expect(
      reconcileObservedBusPorts(
        [port('DATA', 32, 'required')],
        [{ logicalName: 'DATA', physicalName: 's_data', width: 32 }],
        's_'
      )
    ).toEqual({});
  });
});
