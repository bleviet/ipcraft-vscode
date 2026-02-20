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
});
