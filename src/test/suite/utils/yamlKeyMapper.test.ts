import { toSnakeCase, toCamelCase } from '../../../webview/shared/utils/yamlKeyMapper';

describe('yamlKeyMapper', () => {
  it('converts between camel and snake case', () => {
    expect(toSnakeCase('physicalPort')).toBe('physical_port');
    expect(toCamelCase('memory_map_ref')).toBe('memoryMapRef');
  });
});
