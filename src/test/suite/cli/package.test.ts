import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseArgs } from '../../../cli/argv';
import { main } from '../../../cli/index';
import { runCliPackage } from '../../../cli/package';

describe('parseArgs package', () => {
  it('parses a valid command', () => {
    expect(parseArgs(['package', 'a.ip.yml', '--out', 'o', '--zip'])).toEqual({
      kind: 'package',
      args: { ipYamlPath: 'a.ip.yml', out: 'o.zip', zip: true },
    });
    expect(parseArgs(['package', 'a.ip.yml', '--out', 'o'])).toEqual({
      kind: 'package',
      args: { ipYamlPath: 'a.ip.yml', out: 'o', zip: false },
    });
  });

  it('rejects extra positionals and appends .zip to --out', () => {
    expect(parseArgs(['package', 'a.ip.yml', 'b.ip.yml', '--out', 'o'])).toEqual({
      kind: 'error',
      message: "Unexpected argument 'b.ip.yml'",
    });
    const out = (o: string): unknown =>
      (parseArgs(['package', 'a.ip.yml', '--out', o, '--zip']) as { args: { out: string } }).args
        .out;
    expect(out('o')).toBe('o.zip');
    expect(out('o.zip')).toBe('o.zip');
    expect(out('x.ZIP')).toBe('x.ZIP');
  });

  it('rejects a missing --out, a missing ip.yml and unknown options', () => {
    expect(parseArgs(['package', 'a.ip.yml']).kind).toBe('error');
    expect(parseArgs(['package', '--out', 'o']).kind).toBe('error');
    expect(parseArgs(['package', 'a.ip.yml', '--out', 'o', '--bogus']).kind).toBe('error');
  });
});

describe('runCliPackage', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-cli-pkg-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('packages into a folder, and refuses to overwrite a zip', async () => {
    await fs.mkdir(path.join(tmp, 'ip'));
    await fs.mkdir(path.join(tmp, 'c'));
    await fs.writeFile(path.join(tmp, 'c/p.vhd'), 'p');
    const ip = path.join(tmp, 'ip/a.ip.yml');
    await fs.writeFile(ip, 'fileSets:\n  - name: r\n    files:\n      - path: ../c/p.vhd\n');

    const out = path.join(tmp, 'out');
    const result = await runCliPackage({ ipYamlPath: ip, out, zip: false });
    expect(result).toMatchObject({ success: true, fileCount: 2, outputPath: out });
    expect(await fs.readFile(path.join(out, 'deps/c/p.vhd'), 'utf8')).toBe('p');

    const zip = path.join(tmp, 'a.zip');
    expect((await runCliPackage({ ipYamlPath: ip, out: zip, zip: true })).success).toBe(true);
    // `--out a --zip` becomes a.zip, which already exists here.
    const parsed = parseArgs(['package', ip, '--out', path.join(tmp, 'a'), '--zip']);
    expect(parsed).toMatchObject({ args: { out: zip } });
    const again = await runCliPackage({ ipYamlPath: ip, out: zip, zip: true });
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/already exists/);
  });
});

describe('main package dispatch', () => {
  let tmp: string;
  let spies: jest.SpyInstance[];
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-cli-main-'));
    spies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
  });
  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns 0 on success and 1 on error', async () => {
    const ip = path.join(tmp, 'a.ip.yml');
    await fs.writeFile(ip, 'name: a\n');
    const out = path.join(tmp, 'out');
    expect(await main(['package', ip, '--out', out])).toBe(0);
    expect(await fs.readFile(path.join(out, 'a.ip.yml'), 'utf8')).toBe('name: a\n');
    expect(await main(['package', ip, '--out', out])).toBe(1);
  });
});
