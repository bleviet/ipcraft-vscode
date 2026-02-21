import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';

describe('YamlPathResolver', () => {
  it('gets and sets nested values by path', () => {
    const root = {
      memory_maps: [
        {
          address_blocks: [{ name: 'b0', registers: [{ name: 'r0' }] }],
        },
      ],
    };

    expect(YamlPathResolver.getAtPath(root, ['memory_maps', 0, 'address_blocks', 0, 'name'])).toBe(
      'b0'
    );
    YamlPathResolver.setAtPath(root, ['memory_maps', 0, 'address_blocks', 0, 'name'], 'renamed');
    expect(YamlPathResolver.getAtPath(root, ['memory_maps', 0, 'address_blocks', 0, 'name'])).toBe(
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

  it('resolves map root info for array, memory_maps wrapper, and direct map', () => {
    const arrRoot = [{ name: 'map0' }];
    const wrappedRoot = { memory_maps: [{ name: 'map1' }] };
    const directRoot = { name: 'map2' };

    expect(YamlPathResolver.getMapRootInfo(arrRoot)).toEqual({
      root: arrRoot,
      selectionRootPath: [0],
      map: arrRoot[0],
    });
    expect(YamlPathResolver.getMapRootInfo(wrappedRoot)).toEqual({
      root: wrappedRoot,
      selectionRootPath: ['memory_maps', 0],
      map: wrappedRoot.memory_maps[0],
    });
    expect(YamlPathResolver.getMapRootInfo(directRoot)).toEqual({
      root: directRoot,
      selectionRootPath: [],
      map: directRoot,
    });
  });
});
