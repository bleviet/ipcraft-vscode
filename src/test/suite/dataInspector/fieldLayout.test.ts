import { parseLiteral } from '../../../dataInspector/parseLiteral';
import {
  copyFieldsForSource,
  decodeField,
  InspectorField,
  projectFieldsToOutput,
  validateFieldLayout,
} from '../../../dataInspector/fieldLayout';
import { segmentFieldAcrossLanes } from '../../../dataInspector/fieldGeometry';

const field = (name: string, msb: number, lsb: number, groupId = 'default'): InspectorField => ({
  id: `${groupId}-${name}`,
  name,
  msb,
  lsb,
  groupId,
});

describe('inspector field layout', () => {
  it('allocates imported field IDs in the recipe-wide namespace', () => {
    const fields = [{ id: 'import-0-ENABLE', name: 'ENABLE', msb: 0, lsb: 0, groupId: 'default' }];
    const existingIds = new Set(['default', 'input', 'input-import-0-ENABLE']);

    expect(copyFieldsForSource(fields, 'input', existingIds)[0].id).toBe('input-import-0-ENABLE-2');
    expect(copyFieldsForSource(fields, 'input2', existingIds)[0].id).toBe('input2-import-0-ENABLE');
  });

  it('rejects overlaps within a group and permits them across groups', () => {
    expect(validateFieldLayout([field('A', 7, 4), field('B', 5, 0)], 8)).toEqual([
      'B overlaps A at bit 4 in group default',
    ]);
    expect(validateFieldLayout([field('A', 7, 4), field('B', 5, 0, 'alternative')], 8)).toEqual([]);
  });

  it('decodes a known field when unrelated bits are unknown', () => {
    const vector = parseLiteral("8'bXXXX_0011").vector;

    expect(decodeField(vector, field('KNOWN', 3, 0)).toBigInt()).toBe(BigInt(3));
    expect(decodeField(vector, field('UNKNOWN', 7, 4)).toBigInt()).toBeNull();
  });

  it('segments a cross-lane range with MSB-first lane geometry', () => {
    expect(segmentFieldAcrossLanes(64, 16, 50, 13)).toEqual([
      {
        laneIndex: 0,
        laneMsb: 63,
        laneLsb: 48,
        segmentMsb: 50,
        segmentLsb: 48,
        startFraction: 13 / 16,
        widthFraction: 3 / 16,
      },
      {
        laneIndex: 1,
        laneMsb: 47,
        laneLsb: 32,
        segmentMsb: 47,
        segmentLsb: 32,
        startFraction: 0,
        widthFraction: 1,
      },
      {
        laneIndex: 2,
        laneMsb: 31,
        laneLsb: 16,
        segmentMsb: 31,
        segmentLsb: 16,
        startFraction: 0,
        widthFraction: 1,
      },
      {
        laneIndex: 3,
        laneMsb: 15,
        laneLsb: 0,
        segmentMsb: 15,
        segmentLsb: 13,
        startFraction: 0,
        widthFraction: 3 / 16,
      },
    ]);
  });

  it('projects source fields through concat and reordered provenance', () => {
    const sourceField = { ...field('MODE', 7, 4), sourceId: 'high' };
    const concatProvenance = [
      ...Array.from({ length: 8 }, (_, sourceBit) => ({ sourceId: 'low', sourceBit })),
      ...Array.from({ length: 8 }, (_, sourceBit) => ({ sourceId: 'high', sourceBit })),
    ];

    expect(projectFieldsToOutput([sourceField], concatProvenance)).toEqual([
      expect.objectContaining({ sourceFieldId: sourceField.id, msb: 15, lsb: 12 }),
    ]);

    const swapped = [...concatProvenance.slice(8), ...concatProvenance.slice(0, 8)];
    expect(projectFieldsToOutput([sourceField], swapped)).toEqual([
      expect.objectContaining({ sourceFieldId: sourceField.id, msb: 7, lsb: 4 }),
    ]);
  });
});
