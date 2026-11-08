import { main } from '../../../cli/index';
import { runCliMigrate } from '../../../cli/migrate';
import { runCliRender } from '../../../cli/render';

jest.mock('../../../services/ResourceRoots', () => ({ resolveResourceRoots: jest.fn(() => ({})) }));
jest.mock('../../../cli/migrate', () => ({ runCliMigrate: jest.fn() }));
jest.mock('../../../cli/render', () => ({ runCliRender: jest.fn() }));

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

describe('ipcraft render output', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  it('prints one result line on success and exits 0', async () => {
    (runCliRender as jest.Mock).mockResolvedValue({ success: true, outputPath: '/out/a.svg' });
    expect(await main(['render', 'a.tcl', '--out', '/out/a.svg'])).toBe(0);
    expect(log.mock.calls).toEqual([['Rendered /out/a.svg']]);
    expect(error).not.toHaveBeenCalled();
  });

  it('prints the failure on stderr and exits 1, with nothing on stdout', async () => {
    (runCliRender as jest.Mock).mockResolvedValue({
      success: false,
      error: "Unknown level '/x'",
      outputPath: '/out/a.svg',
    });
    expect(await main(['render', 'a.tcl', '--out', '/out/a.svg'])).toBe(1);
    expect(error).toHaveBeenCalledWith("Render failed: Unknown level '/x'");
    expect(log).not.toHaveBeenCalled();
  });

  it('exits 1 on an argument error without rendering', async () => {
    (runCliRender as jest.Mock).mockClear();
    expect(await main(['render', 'a.tcl', '--out', 'a.txt'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the extension must be .svg'));
    expect(runCliRender).not.toHaveBeenCalled();
  });
});
