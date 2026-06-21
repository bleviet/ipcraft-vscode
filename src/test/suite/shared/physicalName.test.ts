import {
  resolvePhysicalPortName,
  resolveSignalToken,
  substitutePattern,
  substituteIndex,
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

  it('leaves {index} intact when no index is provided (array template)', () => {
    expect(substitutePattern('asi_{signal}_{index}_i', 'valid')).toBe('asi_valid_{index}_i');
  });

  it('zero-pads the index to the requested width via {index:N}', () => {
    expect(substitutePattern('asi_{signal}_{index:2}_i', 'valid', 3)).toBe('asi_valid_03_i');
    expect(substitutePattern('asi_{signal}_{index:2}_i', 'valid', 12)).toBe('asi_valid_12_i');
  });

  it('treats {index:1} the same as bare {index} (no extra padding)', () => {
    expect(substitutePattern('sink_{index:1}', '', 7)).toBe('sink_7');
  });

  it('preserves zero-padded HDL indices across a digit-width boundary', () => {
    // 00..10 — without the width specifier the lossless guard would refuse to collapse.
    const pat = 'asi_{signal}_{index:2}_i';
    expect(substitutePattern(pat, 'valid', 0)).toBe('asi_valid_00_i');
    expect(substitutePattern(pat, 'valid', 9)).toBe('asi_valid_09_i');
    expect(substitutePattern(pat, 'valid', 10)).toBe('asi_valid_10_i');
  });

  it('handles a multi-token logical signal name (with underscores)', () => {
    // A custom conduit logical signal may contain an underscore; the signal token is
    // substituted as a whole substring, so underscore-bearing names round-trip.
    expect(substitutePattern('foo_{signal}_bar', 'data_out', 1)).toBe('foo_data_out_bar');
  });
});

describe('substituteIndex', () => {
  it('substitutes only {index}, leaving {signal} untouched', () => {
    expect(substituteIndex('sink_{index}_if', 4)).toBe('sink_4_if');
    expect(substituteIndex('{signal}_{index:3}', 5)).toBe('{signal}_005');
  });

  it('handles a bare {index} and a width-padded {index:N} together', () => {
    expect(substituteIndex('a{index}_b{index:2}', 7)).toBe('a7_b07');
  });
});
