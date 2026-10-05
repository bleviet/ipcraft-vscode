import { main } from '../../../cli/index';
import { runCliMigrate } from '../../../cli/migrate';

jest.mock('../../../services/ResourceRoots', () => ({ resolveResourceRoots: jest.fn(() => ({})) }));
jest.mock('../../../cli/migrate', () => ({ runCliMigrate: jest.fn() }));

describe('ipcraft migrate output', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('reports a version upgrade with both versions', async () => {
    (runCliMigrate as jest.Mock).mockResolvedValue([
      {
        path: 'a.ip.yml',
        status: 'upgraded',
        fromVersion: '1.0',
        toVersion: '1.1',
        mutationCount: 3,
      },
    ]);
    expect(await main(['migrate', 'a.ip.yml'])).toBe(0);
    expect(log).toHaveBeenCalledWith('Upgraded a.ip.yml (1.0 -> 1.1, 3 change(s))');
  });

  it('reports a legacy-key-only conversion without a version change', async () => {
    (runCliMigrate as jest.Mock).mockResolvedValue([
      {
        path: 'a.ip.yml',
        status: 'upgraded',
        fromVersion: '1.1',
        toVersion: '1.1',
        mutationCount: 2,
      },
    ]);
    expect(await main(['migrate', 'a.ip.yml'])).toBe(0);
    expect(log).toHaveBeenCalledWith('Converted legacy keys in a.ip.yml (2 change(s))');
  });
});
