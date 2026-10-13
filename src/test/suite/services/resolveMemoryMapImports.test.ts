import {
  resolveMemoryMapImports,
  selectImportedMaps,
  type FileReader,
} from '../../../services/imports/resolveMemoryMapImports';

describe('selectImportedMaps', () => {
  it('shortcut import: every entry of a list file, with its path', () => {
    expect(selectImportedMaps([{ name: 'A' }, { name: 'B' }])).toEqual([
      { raw: { name: 'A' }, path: [0] },
      { raw: { name: 'B' }, path: [1] },
    ]);
  });

  it('shortcut import: any other object is one root map, a nested root included', () => {
    expect(selectImportedMaps({ name: 'A' })).toEqual([{ raw: { name: 'A' }, path: [] }]);
    const nested = { memoryMaps: [{ name: 'N' }] };
    expect(selectImportedMaps(nested)).toEqual([{ raw: nested, path: [] }]);
    expect(selectImportedMaps(null)).toEqual([]);
  });

  it('array-entry import: the first map only, with the entry overrides merged over it', () => {
    expect(selectImportedMaps([{ name: 'A', x: 1 }, { name: 'B' }], { name: 'R' })).toEqual([
      { raw: { name: 'R', x: 1 }, path: [0] },
    ]);
    expect(selectImportedMaps({ name: 'A' }, { name: 'R' })).toEqual([
      { raw: { name: 'R' }, path: [] },
    ]);
    expect(selectImportedMaps(null, {})).toEqual([{ raw: {}, path: [] }]);
  });
});

describe('resolveMemoryMapImports', () => {
  const mockReader: FileReader = {
    async readText(absPath: string): Promise<string> {
      if (absPath.endsWith('valid.mm.yml')) {
        return `
- name: MAP_A
  addressBlocks: []
`;
      }
      if (absPath.endsWith('broken.mm.yml')) {
        throw new Error('File not found');
      }
      return '';
    },
  };

  it('resolves valid legacy shortcut import', async () => {
    const memoryMaps = { import: 'valid.mm.yml' };
    const { resolved, errors } = await resolveMemoryMapImports({
      memoryMaps,
      baseDir: '/test',
      reader: mockReader,
    });
    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe('MAP_A');
  });

  it('resolves valid entry-level imports with overrides', async () => {
    const memoryMaps = [{ import: 'valid.mm.yml', name: 'OVERRIDDEN_NAME' }];
    const { resolved, errors } = await resolveMemoryMapImports({
      memoryMaps,
      baseDir: '/test',
      reader: mockReader,
    });
    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe('OVERRIDDEN_NAME');
  });

  it('merges entry-level overrides over the imported file without shifting child offsets', async () => {
    const reader: FileReader = {
      async readText(): Promise<string> {
        return `
- name: IMPORTED
  baseAddress: 0x1000
  addressBlocks:
    - name: BLK0
      baseAddress: 0x0
      registers:
        - name: REG0
          offset: 0x4
`;
      },
    };
    const memoryMaps = [{ import: 'maps/core.mm.yml', name: 'CORE', baseAddress: 0x2000 }];
    const { resolved, errors } = await resolveMemoryMapImports({
      memoryMaps,
      baseDir: '/ip',
      reader,
    });
    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    // Entry-level fields override the imported file's top-level fields...
    expect(resolved[0].name).toBe('CORE');
    expect(resolved[0].baseAddress).toBe(0x2000);
    // ...but nested blocks/registers are carried through verbatim (no offset shift).
    const blocks = resolved[0].addressBlocks as Array<Record<string, unknown>>;
    expect(blocks[0].baseAddress).toBe(0x0);
    const registers = blocks[0].registers as Array<Record<string, unknown>>;
    expect(registers[0].offset).toBe(0x4);
  });

  it('collects errors for invalid imports', async () => {
    const memoryMaps = [{ import: 'broken.mm.yml' }];
    const { resolved, errors } = await resolveMemoryMapImports({
      memoryMaps,
      baseDir: '/test',
      reader: mockReader,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Failed to load memory map');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].import).toBe('broken.mm.yml');
  });
});
