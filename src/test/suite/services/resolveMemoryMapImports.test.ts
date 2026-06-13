import {
  resolveMemoryMapImports,
  type FileReader,
} from '../../../services/imports/resolveMemoryMapImports';

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
  base_address: 0x1000
  addressBlocks:
    - name: BLK0
      base_address: 0x0
      registers:
        - name: REG0
          address_offset: 0x4
`;
      },
    };
    const memoryMaps = [{ import: 'maps/core.mm.yml', name: 'CORE', base_address: 0x2000 }];
    const { resolved, errors } = await resolveMemoryMapImports({
      memoryMaps,
      baseDir: '/ip',
      reader,
    });
    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    // Entry-level fields override the imported file's top-level fields...
    expect(resolved[0].name).toBe('CORE');
    expect(resolved[0].base_address).toBe(0x2000);
    // ...but nested blocks/registers are carried through verbatim (no offset shift).
    const blocks = resolved[0].addressBlocks as Array<Record<string, unknown>>;
    expect(blocks[0].base_address).toBe(0x0);
    const registers = blocks[0].registers as Array<Record<string, unknown>>;
    expect(registers[0].address_offset).toBe(0x4);
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
