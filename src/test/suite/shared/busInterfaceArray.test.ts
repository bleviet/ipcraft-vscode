import { arrayedBusNames } from '../../../shared/busInterfaceArray';

describe('arrayedBusNames', () => {
  it('uses the naming and prefix patterns with indexStart', () => {
    expect(
      arrayedBusNames({
        name: 'M_AXIS',
        array: {
          count: 2,
          indexStart: 1,
          namingPattern: 'M_AXIS_CH{index}',
          physicalPrefixPattern: 'm_axis_ch{index}_',
        },
      })
    ).toEqual([
      { name: 'M_AXIS_CH1', physicalPrefix: 'm_axis_ch1_' },
      { name: 'M_AXIS_CH2', physicalPrefix: 'm_axis_ch2_' },
    ]);
  });

  it('applies the generator defaults: count 1, start 0, <name>_{index}, <prefix>{index}_', () => {
    expect(arrayedBusNames({ name: 'BUS', physicalPrefix: 'p_', array: {} })).toEqual([
      { name: 'BUS_0', physicalPrefix: 'p_0_' },
    ]);
    expect(arrayedBusNames({ name: 'BUS', array: { count: 2 } })).toEqual([
      { name: 'BUS_0', physicalPrefix: '0_' },
      { name: 'BUS_1', physicalPrefix: '1_' },
    ]);
  });

  it('produces nothing for a count of zero', () => {
    expect(arrayedBusNames({ name: 'BUS', array: { count: 0 } })).toEqual([]);
  });
});
