import {
  toSnakeCase,
  toCamelCase,
  mapKeysToSnakeCase,
  mapKeysToCamelCase,
} from '../../../webview/shared/utils/yamlKeyMapper';

describe('yamlKeyMapper', () => {
  it('converts between camel and snake case', () => {
    expect(toSnakeCase('physicalPort')).toBe('physical_port');
    expect(toCamelCase('memory_map_ref')).toBe('memoryMapRef');
  });

  it('round-trips nested object keys', () => {
    const original = {
      apiVersion: 'ipcore/v1',
      busInterfaces: [{ physicalPrefix: 'S_AXI' }],
      memoryMaps: [{ addressBlocks: [{ baseAddress: 0 }] }],
    };

    const snake = mapKeysToSnakeCase(original);
    const camel = mapKeysToCamelCase(snake) as typeof original;

    expect((snake as Record<string, unknown>).bus_interfaces).toBeDefined();
    expect(camel.busInterfaces[0].physicalPrefix).toBe('S_AXI');
    expect(camel.memoryMaps[0].addressBlocks[0].baseAddress).toBe(0);
  });
});
