/** @jest-environment node */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { main } from '../../../cli/index';

describe('ipcraft vhdl-ls', () => {
  let root: string;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  let stdout: jest.SpyInstance;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-vhdl-ls-'));
    fs.writeFileSync(path.join(root, 'a.vhd'), 'entity a is\nend entity;\n');
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    stdout.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes the file and exits 0, then reports it up to date', async () => {
    expect(await main(['vhdl-ls', '--root', root])).toBe(0);
    expect(fs.existsSync(path.join(root, 'vhdl_ls.toml'))).toBe(true);
    expect(log).toHaveBeenCalledWith(`Wrote ${path.join(root, 'vhdl_ls.toml')}: 1 library, 1 file`);
    expect(await main(['vhdl-ls', '--root', root])).toBe(0);
    expect(log).toHaveBeenCalledWith(`Up to date: ${path.join(root, 'vhdl_ls.toml')}`);
  });

  it('prints the file text on --dry-run and writes nothing', async () => {
    expect(await main(['vhdl-ls', '--root', root, '--dry-run'])).toBe(0);
    expect(fs.existsSync(path.join(root, 'vhdl_ls.toml'))).toBe(false);
    expect(String(stdout.mock.calls[0][0])).toContain("libraries.defaultlib.files = [\n  'a.vhd'");
  });

  it('exits 2 for a foreign file unless --force is given', async () => {
    fs.writeFileSync(path.join(root, 'vhdl_ls.toml'), '# mine\n');
    expect(await main(['vhdl-ls', '--root', root])).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Re-run with --force'));
    error.mockClear();
    expect(fs.readFileSync(path.join(root, 'vhdl_ls.toml'), 'utf8')).toBe('# mine\n');
    expect(await main(['vhdl-ls', '--root', root, '--force'])).toBe(0);
    expect(fs.readdirSync(path.join(root, '.ipcraft', 'backup'))).toHaveLength(1);
  });

  it('exits 1 when the user section is not valid TOML', async () => {
    expect(await main(['vhdl-ls', '--root', root])).toBe(0);
    fs.appendFileSync(path.join(root, 'vhdl_ls.toml'), '[lint\n');
    expect(await main(['vhdl-ls', '--root', root])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not valid TOML'));
    error.mockClear();
  });

  it('exits 1 on an unknown option', async () => {
    expect(await main(['vhdl-ls', '--bogus'])).toBe(1);
    expect(error).toHaveBeenCalledWith("Unknown option '--bogus' for 'vhdl-ls'");
    error.mockClear();
  });
});
