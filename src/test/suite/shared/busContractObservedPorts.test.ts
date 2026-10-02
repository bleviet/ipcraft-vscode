import { reconcileObservedBusPorts } from '../../../shared/busContracts';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const avalonMmPorts = builtinBusLibrary().definitions.AVALON_MEMORY_MAPPED.ports;

describe('reconcileObservedBusPorts polarity roles', () => {
  it('keeps the active-low logical role independent from an active-high physical suffix', () => {
    expect(
      reconcileObservedBusPorts(
        avalonMmPorts,
        [{ logicalName: 'byteenable_n', physicalName: 'avs_byteenable', width: 2 }],
        'avs_'
      )
    ).toEqual({
      useOptionalPorts: ['byteenable'],
      portWidthOverrides: { byteenable: 2 },
      portNameOverrides: { byteenable: 'byteenable' },
      portPolarityOverrides: { byteenable: 'activeLow' },
    });
  });

  it('keeps the active-high logical role independent from an active-low physical suffix', () => {
    expect(
      reconcileObservedBusPorts(
        avalonMmPorts,
        [{ logicalName: 'byteenable', physicalName: 'avs_byteenable_n', width: 2 }],
        'avs_'
      )
    ).toEqual({
      useOptionalPorts: ['byteenable'],
      portWidthOverrides: { byteenable: 2 },
      portNameOverrides: { byteenable: 'byteenable_n' },
    });
  });

  it('omits a physical-name override when the suffix matches the selected role', () => {
    expect(
      reconcileObservedBusPorts(
        avalonMmPorts,
        [{ logicalName: 'byteenable_n', physicalName: 'avs_byteenable_n', width: 2 }],
        'avs_'
      )
    ).toEqual({
      useOptionalPorts: ['byteenable'],
      portWidthOverrides: { byteenable: 2 },
      portPolarityOverrides: { byteenable: 'activeLow' },
    });
  });

  it('uses the last observed role for shared canonical selections', () => {
    expect(
      reconcileObservedBusPorts(
        avalonMmPorts,
        [
          { logicalName: 'byteenable_n', physicalName: 'avs_byteenable_n', width: 2 },
          { logicalName: 'byteenable', physicalName: 'avs_byteenable_n', width: 3 },
        ],
        'avs_'
      )
    ).toEqual({
      useOptionalPorts: ['byteenable'],
      portWidthOverrides: { byteenable: 3 },
      portNameOverrides: { byteenable: 'byteenable_n' },
    });
  });
});
