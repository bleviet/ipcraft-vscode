import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const FAKE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cache-test-'));
jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => FAKE_CONFIG_DIR,
}));

import { BusDefScanCache } from '../../../services/BusDefScanCache';

const CACHE_FILE_PATH = path.join(FAKE_CONFIG_DIR, 'bus_definitions', 'scan-cache.json');

function writeCache(content: string): void {
  fs.mkdirSync(path.dirname(CACHE_FILE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_FILE_PATH, content, 'utf8');
}

describe('BusDefScanCache', () => {
  afterEach(() => {
    fs.rmSync(path.dirname(CACHE_FILE_PATH), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(FAKE_CONFIG_DIR, { recursive: true, force: true });
  });

  it.each(['null', '"not a cache"', '42', 'false', '[]', '{"version":1,"entries":null}'])(
    'treats malformed cache root %s as empty',
    async (content) => {
      writeCache(content);
      const cache = new BusDefScanCache();

      await expect(cache.load()).resolves.toBeUndefined();
      expect(cache.get('/workspace/bus.busdef.yml')).toBeUndefined();
    }
  );

  it('loads valid cache entries', async () => {
    writeCache(
      JSON.stringify({
        version: 1,
        entries: {
          '/workspace/bus.busdef.yml': {
            mtimeMs: 123,
            size: 456,
            kind: 'none',
          },
        },
      })
    );
    const cache = new BusDefScanCache();

    await cache.load();

    expect(cache.get('/workspace/bus.busdef.yml')).toEqual({
      mtimeMs: 123,
      size: 456,
      kind: 'none',
    });
  });
});
