import { readVivadoFlatRow } from '../../../../services/resources/vivadoFlatTable';
import { vivadoFixture } from './fixtures';

describe('readVivadoFlatRow', () => {
  it('reads used, available and util% by header, with the Prohibited column', () => {
    expect(readVivadoFlatRow(vivadoFixture('routed_flat.rpt'), ['Slice LUTs'])).toEqual({
      used: 841,
      available: 63400,
      utilPct: 1.33,
    });
  });

  it('ignores a trailing asterisk on the label', () => {
    expect(readVivadoFlatRow(vivadoFixture('synth_flat.rpt'), ['Slice LUTs'])).toMatchObject({
      used: 919,
      available: 63400,
    });
  });

  it('returns the first matching row', () => {
    expect(
      readVivadoFlatRow(vivadoFixture('sys_wrapper_utilization_placed.rpt'), ['LUT as Logic'])
    ).toMatchObject({
      used: 839,
    });
  });

  it('finds the other rows used for capacity', () => {
    const text = vivadoFixture('routed_flat.rpt');
    expect(readVivadoFlatRow(text, ['Block RAM Tile'])).toMatchObject({ available: 135 });
    expect(readVivadoFlatRow(text, ['DSPs'])).toMatchObject({ available: 240 });
    expect(readVivadoFlatRow(text, ['Slice Registers'])).toMatchObject({
      used: 1386,
      available: 126800,
    });
  });

  it('follows the header of each table, whatever the column order', () => {
    const text = [
      '| Site Type | Used | Fixed | Available | Proh | Util% |',
      '| Slice LUTs* | 12,345 | 0 | 234,560 | 0 | 5.26 |',
    ].join('\n');
    expect(readVivadoFlatRow(text, ['Slice LUTs'])).toEqual({
      used: 12345,
      available: 234560,
      utilPct: 5.26,
    });
  });

  it('reads <0.01 as 0.01', () => {
    expect(
      readVivadoFlatRow(vivadoFixture('ooc/sys_bram_0_0_utilization_synth.rpt'), ['Slice LUTs'])
    ).toMatchObject({
      used: 5,
      utilPct: 0.01,
    });
  });

  it('has no available figure for a row without a header above it', () => {
    expect(readVivadoFlatRow('| Slice LUTs* | 100 | 0 | 0 | 53200 | 0 |', ['Slice LUTs'])).toEqual({
      used: 100,
    });
  });

  it('returns undefined when no row matches', () => {
    expect(readVivadoFlatRow(vivadoFixture('routed_flat.rpt'), ['URAM'])).toBeUndefined();
  });
});
