import {
  resolvePhysicalPortName,
  resolveSignalToken,
  substitutePattern,
} from '../../../shared/physicalName';

describe('resolveSignalToken', () => {
  it('lowercases the logical name by default', () => {
    expect(resolveSignalToken('TDATA')).toBe('tdata');
  });

  it('uses a portNameOverride when present', () => {
    expect(resolveSignalToken('TDATA', { TDATA: 'm_data' })).toBe('m_data');
  });
});

describe('resolvePhysicalPortName', () => {
  it('falls back to physicalPrefix + lowercased signal (legacy)', () => {
    expect(resolvePhysicalPortName('AWVALID', { physicalPrefix: 's_axi_' })).toBe('s_axi_awvalid');
  });

  it('applies portNameOverrides in the legacy path', () => {
    expect(
      resolvePhysicalPortName('AWVALID', {
        physicalPrefix: 's_axi_',
        portNameOverrides: { AWVALID: 'aw_v' },
      })
    ).toBe('s_axi_aw_v');
  });

  it('prefers physicalNamePattern over physicalPrefix', () => {
    expect(
      resolvePhysicalPortName('VALID', {
        physicalPrefix: 'ignored_',
        physicalNamePattern: 'asi_{signal}_{index}_i',
      })
    ).toBe('asi_valid_{index}_i');
  });

  it('substitutes both {signal} and {index} when an index is given', () => {
    expect(
      resolvePhysicalPortName('VALID', { physicalNamePattern: 'asi_{signal}_{index}_i' }, 3)
    ).toBe('asi_valid_3_i');
  });

  it('is equivalent to physicalPrefix when pattern is "<prefix>{signal}"', () => {
    const a = resolvePhysicalPortName('TDATA', { physicalPrefix: 's_axi_' });
    const b = resolvePhysicalPortName('TDATA', { physicalNamePattern: 's_axi_{signal}' });
    expect(a).toBe(b);
  });
});

describe('substitutePattern', () => {
  it('replaces all occurrences of {signal} and {index}', () => {
    expect(substitutePattern('{signal}_{index}_{signal}', 'd', 2)).toBe('d_2_d');
  });
});
