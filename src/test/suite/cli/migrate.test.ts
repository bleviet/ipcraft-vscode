import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { runCliMigrate } from '../../../cli/migrate';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { loadRuntimeBusLibrary } from '../../../services/loadRuntimeBusLibrary';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { builtinBusLibrary } from '../../helpers/busLibrary';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/loadRuntimeBusLibrary', () => ({
  loadRuntimeBusLibrary: jest.fn(),
}));

const LEGACY = `# keep me
apiVersion: '1.0'
busInterfaces:
  - name: avalon
    type: ${BUS_VLNV.AVALON_MM}
    mode: master
    useOptionalPorts: [read_n, write_n]
`;

const resourceRoots = devResourceRoots(path.resolve(__dirname, '../../../..'));

describe('runCliMigrate', () => {
  let dir: string;

  beforeEach(() => {
    // resetMocks wipes the mock's default Uri.file implementation before every test.
    (vscode.Uri.file as jest.Mock).mockImplementation((p: string) => ({ fsPath: p }));
    (loadRuntimeBusLibrary as jest.Mock).mockResolvedValue(builtinBusLibrary());
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-migrate-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, content: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content, 'utf-8');
    return file;
  }

  it('rewrites a legacy file in place, then reports it up to date', async () => {
    const file = write('legacy.ip.yml', LEGACY);

    const [first] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
    expect(first).toMatchObject({ status: 'upgraded', fromVersion: '1.0', toVersion: '1.1' });
    const upgraded = fs.readFileSync(file, 'utf-8');
    expect(upgraded).not.toBe(LEGACY);
    expect(upgraded).toContain('# keep me');
    expect(upgraded).toContain('portPolarityOverrides');

    const [second] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
    expect(second).toEqual({ path: file, status: 'upToDate', version: '1.1' });
    expect(upgraded).toContain("apiVersion: '1.1'");
    expect(fs.readFileSync(file, 'utf-8')).toBe(upgraded);
  });

  it('passes the parsed ip core data to the bus library loader', async () => {
    const file = write('legacy.ip.yml', `useBusLibrary: ./lib\n${LEGACY}`);
    await runCliMigrate({ paths: [file], check: true }, resourceRoots);
    expect(loadRuntimeBusLibrary).toHaveBeenCalledWith(
      resourceRoots,
      expect.objectContaining({ fsPath: file }),
      expect.objectContaining({ useBusLibrary: './lib' })
    );
  });

  it('leaves a current file untouched', async () => {
    const source = "apiVersion: '1.1'\nclocks: []\n";
    const file = write('current.ip.yml', source);
    const [result] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
    expect(result.status).toBe('upToDate');
    expect(fs.readFileSync(file, 'utf-8')).toBe(source);
  });

  it('writes nothing with --check and flags files needing an upgrade', async () => {
    const file = write('legacy.ip.yml', LEGACY);
    const [result] = await runCliMigrate({ paths: [file], check: true }, resourceRoots);
    expect(result).toEqual({
      path: file,
      status: 'needsUpgrade',
      fromVersion: '1.0',
      toVersion: '1.1',
    });
    expect(fs.readFileSync(file, 'utf-8')).toBe(LEGACY);
  });

  it('reports a file with a newer format version as an error and leaves it untouched', async () => {
    const newer = "apiVersion: '1.2'\nclocks: []\n";
    const file = write('newer.ip.yml', newer);
    const [result] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
    expect(result).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/apiVersion 1\.2.*up to 1\.1/),
    });
    expect(fs.readFileSync(file, 'utf-8')).toBe(newer);
  });

  it('reports a bad file as an error and still processes the others', async () => {
    const bad = write('bad.ip.yml', 'a: [unclosed');
    const missing = path.join(dir, 'missing.ip.yml');
    const good = write('good.ip.yml', LEGACY);

    const results = await runCliMigrate(
      { paths: [bad, missing, good], check: false },
      resourceRoots
    );

    expect(results.map((r) => r.status)).toEqual(['error', 'error', 'upgraded']);
    expect(fs.readFileSync(good, 'utf-8')).not.toBe(LEGACY);
  });

  describe('.mm.yml files', () => {
    const LEGACY_MM = `# keep
address_blocks:
  - name: A
    base_address: 0x10
    registers:
      - name: R
        address_offset: 0
`;

    it('converts legacy keys without loading a bus library', async () => {
      const file = write('legacy.mm.yml', LEGACY_MM);
      const [result] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
      expect(result).toEqual({ path: file, status: 'upgraded', mutationCount: 3 });
      const text = fs.readFileSync(file, 'utf-8');
      expect(text).toContain('# keep');
      expect(text).toContain('baseAddress: 0x10');
      expect(text).not.toContain('address_blocks');
      expect(loadRuntimeBusLibrary).not.toHaveBeenCalled();

      const [second] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
      expect(second).toEqual({ path: file, status: 'upToDate' });
    });

    it('also accepts the .mm.yaml extension', async () => {
      const file = write('legacy.mm.yaml', LEGACY_MM);
      const [result] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
      expect(result).toMatchObject({ status: 'upgraded' });
      expect(loadRuntimeBusLibrary).not.toHaveBeenCalled();
    });

    it('reports it with --check without writing', async () => {
      const file = write('legacy.mm.yml', LEGACY_MM);
      const [result] = await runCliMigrate({ paths: [file], check: true }, resourceRoots);
      expect(result).toEqual({ path: file, status: 'needsUpgrade' });
      expect(fs.readFileSync(file, 'utf-8')).toBe(LEGACY_MM);
    });
  });

  it('writes a current-version .ip.yml that only has legacy keys', async () => {
    const source = "apiVersion: '1.1'\nfile_sets: []\n";
    const file = write('keys.ip.yml', source);
    const [result] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
    expect(result).toMatchObject({ status: 'upgraded', fromVersion: '1.1', toVersion: '1.1' });
    expect(fs.readFileSync(file, 'utf-8')).toBe("apiVersion: '1.1'\nfileSets: []\n");
  });

  describe('dotted bus types in a current-version file', () => {
    const DOTTED = `apiVersion: '1.1'
busInterfaces:
  - name: S_AXI
    type: ipcraft.busif.axi4_lite.1.0
    mode: slave
`;

    it('flags it with --check without writing', async () => {
      const file = write('dotted.ip.yml', DOTTED);
      const [result] = await runCliMigrate({ paths: [file], check: true }, resourceRoots);
      expect(result).toEqual({
        path: file,
        status: 'needsUpgrade',
        fromVersion: '1.1',
        toVersion: '1.1',
      });
      expect(fs.readFileSync(file, 'utf-8')).toBe(DOTTED);
    });

    it('writes the canonical colon type', async () => {
      const file = write('dotted.ip.yml', DOTTED);
      const [result] = await runCliMigrate({ paths: [file], check: false }, resourceRoots);
      expect(result).toMatchObject({ status: 'upgraded', fromVersion: '1.1', toVersion: '1.1' });
      expect(fs.readFileSync(file, 'utf-8')).toContain(`type: ${BUS_VLNV.AXI4_LITE}`);
    });
  });
});
