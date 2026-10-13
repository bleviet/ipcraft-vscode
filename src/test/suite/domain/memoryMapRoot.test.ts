import { detectMemoryMapRoot } from '../../../domain/memoryMapRoot';
import { parseMemoryMap } from '../../../domain/parse';

describe('detectMemoryMapRoot', () => {
  it('treats a bare map as standalone with the empty path', () => {
    const { rootStyle, maps } = detectMemoryMapRoot({ name: 'M', addressBlocks: [] });
    expect(rootStyle).toBe('standalone');
    expect(maps).toEqual([{ path: [], raw: { name: 'M', addressBlocks: [] } }]);
  });

  it('lists every map of a top-level array with its index path', () => {
    const { rootStyle, maps } = detectMemoryMapRoot([{ name: 'A' }, { name: 'B' }]);
    expect(rootStyle).toBe('array');
    expect(maps.map((m) => m.path)).toEqual([[0], [1]]);
    expect(maps.map((m) => m.raw.name)).toEqual(['A', 'B']);
  });

  it('lists every map of a nested memoryMaps root', () => {
    const { rootStyle, maps } = detectMemoryMapRoot({ memoryMaps: [{ name: 'A' }, { name: 'B' }] });
    expect(rootStyle).toBe('nested');
    expect(maps.map((m) => m.path)).toEqual([
      ['memoryMaps', 0],
      ['memoryMaps', 1],
    ]);
  });

  it('has no maps for an empty array', () => {
    expect(detectMemoryMapRoot([]).maps).toEqual([]);
  });

  it('keeps parseMemoryMap reading the first map of each root style', () => {
    expect(parseMemoryMap('name: S\naddressBlocks: []\n').rootStyle).toBe('standalone');
    const array = parseMemoryMap('- name: A\n- name: B\n');
    expect([array.rootStyle, array.map.name]).toEqual(['array', 'A']);
    const nested = parseMemoryMap('memoryMaps:\n  - name: N\n');
    expect([nested.rootStyle, nested.map.name]).toEqual(['nested', 'N']);
    expect(parseMemoryMap('[]').map.name).toBe('');
  });
});
