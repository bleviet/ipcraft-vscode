import {
  generateIpCoreTemplate,
  generateIpCoreWithMemoryMapTemplate,
} from '../../../commands/FileCreationCommands';
import { IP_CORE_FORMAT_VERSION, migrateIpCoreYaml } from '../../../shared/ipCoreFormat';
import { builtinBusLibrary } from '../../helpers/busLibrary';

describe('new .ip.yml templates', () => {
  it.each([
    ['plain', generateIpCoreTemplate('acme', 'core')],
    ['with memory map', generateIpCoreWithMemoryMapTemplate('acme', 'core', 'core.mm.yml')],
  ])('%s template declares the current format version and is up to date', (_n, text) => {
    expect(text).toContain(`apiVersion: '${IP_CORE_FORMAT_VERSION}'`);
    const result = migrateIpCoreYaml(text, builtinBusLibrary());
    expect(result).toMatchObject({ changed: false, fromVersion: IP_CORE_FORMAT_VERSION });
  });
});
