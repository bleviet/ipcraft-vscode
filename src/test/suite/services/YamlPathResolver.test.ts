import { migrateMemoryMapYaml } from '../../../shared/ipCoreFormat';
import { YamlService } from '../../../webview/services/YamlService';
import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';

describe('YamlPathResolver', () => {
  it('gets and sets nested values by path', () => {
    const root = {
      memoryMaps: [
        {
          addressBlocks: [{ name: 'b0', registers: [{ name: 'r0' }] }],
        },
      ],
    };

    expect(YamlPathResolver.getAtPath(root, ['memoryMaps', 0, 'addressBlocks', 0, 'name'])).toBe(
      'b0'
    );
    YamlPathResolver.setAtPath(root, ['memoryMaps', 0, 'addressBlocks', 0, 'name'], 'renamed');
    expect(YamlPathResolver.getAtPath(root, ['memoryMaps', 0, 'addressBlocks', 0, 'name'])).toBe(
      'renamed'
    );
  });

  it('returns undefined for missing path segments and throws on invalid set paths', () => {
    const root = { a: { b: 1 } };

    expect(YamlPathResolver.getAtPath(root, ['a', 'x'])).toBeUndefined();
    expect(() => YamlPathResolver.setAtPath(root, [], 1)).toThrow('Cannot set empty path');
    expect(() => YamlPathResolver.setAtPath(root, ['a', 'x', 'y'], 1)).toThrow(
      'Path not found at y'
    );
  });

  it('deletes array/object items by path', () => {
    const root = {
      items: [{ id: 1 }, { id: 2 }],
      meta: { description: 'x' },
    };

    YamlPathResolver.deleteAtPath(root, ['items', 0]);
    expect(root.items as Array<{ id: number }>).toHaveLength(1);
    expect((root.items as Array<{ id: number }>)[0].id).toBe(2);

    YamlPathResolver.deleteAtPath(root, ['meta', 'description']);
    expect((root.meta as Record<string, unknown>).description).toBeUndefined();
  });

  it('does nothing when deleting empty or non-existent paths', () => {
    const root = { items: [{ id: 1 }], meta: { keep: true } };

    YamlPathResolver.deleteAtPath(root, []);
    YamlPathResolver.deleteAtPath(root, ['missing', 'path']);

    expect(root.items).toEqual([{ id: 1 }]);
    expect(root.meta).toEqual({ keep: true });
  });

  it('does not read legacy snake_case keys', () => {
    const root = { address_blocks: [{ name: 'b0' }] };
    expect(YamlPathResolver.getAtPath(root, ['addressBlocks', 0, 'name'])).toBeUndefined();
  });

  it('resolves map root info for array, memoryMaps wrapper, and direct map', () => {
    const arrRoot = [{ name: 'map0' }];
    const directRoot = { name: 'map2' };

    expect(YamlPathResolver.getMapRootInfo(arrRoot)).toEqual({
      root: arrRoot,
      selectionRootPath: [0],
      map: arrRoot[0],
    });
    const wrappedRoot = { memoryMaps: [{ name: 'map1' }] };
    expect(YamlPathResolver.getMapRootInfo(wrappedRoot)).toEqual({
      root: wrappedRoot,
      selectionRootPath: ['memoryMaps', 0],
      map: wrappedRoot.memoryMaps[0],
    });
    expect(YamlPathResolver.getMapRootInfo(directRoot)).toEqual({
      root: directRoot,
      selectionRootPath: [],
      map: directRoot,
    });
  });

  it('targets memoryMaps[0] for a legacy memory_maps wrapper after migration', () => {
    const legacy = `memory_maps:
  - name: m
    address_blocks:
      - name: B
        base_address: 0
        registers: []
`;
    const { text } = migrateMemoryMapYaml(legacy);
    const { root, selectionRootPath, map } = YamlPathResolver.getMapRootInfo(
      YamlService.safeParse(text)
    );
    expect(selectionRootPath).toEqual(['memoryMaps', 0]);
    expect((map as { name: string }).name).toBe('m');

    const edited = YamlService.applyPathEdits(text, [
      { path: [...selectionRootPath, 'addressBlocks', 0, 'baseAddress'], value: 16 },
    ]);
    const blocks = (
      YamlService.safeParse(edited) as { memoryMaps: Array<{ addressBlocks: unknown[] }> }
    ).memoryMaps[0].addressBlocks as Array<{ baseAddress: number }>;
    expect(blocks[0].baseAddress).toBe(16);
    expect(root).toBeDefined();
  });
});
