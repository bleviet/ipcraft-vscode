import * as path from 'path';
import { IpCoreSchemaValidationError, loadIpCoreData } from '../../../generator/loadIpCore';
import { devResourceRoots } from '../../../services/ResourceRoots';

describe('loadIpCoreData schema diagnostics', () => {
  it('preserves structured schema paths for unified issue reporting', async () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const sourceText = [
      'vlnv:',
      '  vendor: acme',
      '  library: ip',
      '  name: demo',
      "  version: '1.0'",
      'simulation:',
      '  engine: typo',
      '',
    ].join('\n');

    await expect(
      loadIpCoreData('/tmp/demo.ip.yml', devResourceRoots(repoRoot), sourceText)
    ).rejects.toMatchObject({
      name: 'IpCoreSchemaValidationError',
      issues: [
        expect.objectContaining({
          source: 'schema',
          path: ['simulation', 'engine'],
          severity: 'error',
        }),
      ],
    } satisfies Partial<IpCoreSchemaValidationError>);
  });

  it('rejects a newer format version before schema validation', async () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const sourceText =
      "apiVersion: '1.2'\nvlnv:\n  vendor: acme\n  library: ip\n  name: demo\n  version: '1.0'\n";

    await expect(
      loadIpCoreData('/tmp/demo.ip.yml', devResourceRoots(repoRoot), sourceText)
    ).rejects.toThrow(/apiVersion 1\.2.*up to 1\.1/);
  });
});
