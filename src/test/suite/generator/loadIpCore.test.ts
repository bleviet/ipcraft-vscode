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
});
