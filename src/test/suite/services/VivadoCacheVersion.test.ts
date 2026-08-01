import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const FAKE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cache-selection-test-'));
jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => FAKE_CONFIG_DIR,
}));
jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, writeFile: jest.fn(actual.writeFile) };
});

import {
  recordVivadoCacheSelection,
  resolveVivadoCacheVersion,
} from '../../../services/VivadoCacheVersion';
import * as fsPromises from 'fs/promises';

const realFsPromises = jest.requireActual<typeof import('fs/promises')>('fs/promises');
const mockWriteFile = fsPromises.writeFile as jest.Mock;

function resource(fsPath: string): vscode.Uri {
  return { fsPath, toString: () => `file://${fsPath}` } as vscode.Uri;
}

function config(pinnedVersion: string): vscode.WorkspaceConfiguration {
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      (key === 'vivado.pinnedVersion' ? pinnedVersion : defaultValue) as T,
  } as vscode.WorkspaceConfiguration;
}

describe('VivadoCacheVersion', () => {
  beforeEach(() => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    (vscode.workspace as unknown as { getWorkspaceFolder?: jest.Mock }).getWorkspaceFolder =
      jest.fn(() => undefined);
    mockWriteFile.mockImplementation(realFsPromises.writeFile);
  });

  afterEach(() => {
    fs.rmSync(path.join(FAKE_CONFIG_DIR, 'vivado'), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(FAKE_CONFIG_DIR, { recursive: true, force: true });
  });

  it('persists an unpinned picker selection for the same resource', async () => {
    const cfg = config('');
    const uri = resource('/workspace/core.ip.yml');

    await recordVivadoCacheSelection(cfg, 'catalog', { runner: 'local', version: '2024.2' }, uri);

    await expect(resolveVivadoCacheVersion(cfg, 'catalog', uri)).resolves.toBe('2024.2');
  });

  it('uses a stale-pin fallback selection while that pin remains unchanged', async () => {
    const cfg = config('2020.1');
    const uri = resource('/workspace/core.ip.yml');

    await recordVivadoCacheSelection(
      cfg,
      'interfaces',
      { runner: 'local', version: '2024.2' },
      uri
    );

    await expect(resolveVivadoCacheVersion(cfg, 'interfaces', uri)).resolves.toBe('2024.2');
  });

  it('does not invent a version when neither a pin nor scan selection exists', async () => {
    await expect(
      resolveVivadoCacheVersion(config(''), 'catalog', resource('/workspace/core.ip.yml'))
    ).resolves.toBeUndefined();
  });

  it('invalidates an old scan selection when the resource pin changes', async () => {
    const uri = resource('/workspace/core.ip.yml');
    await recordVivadoCacheSelection(
      config(''),
      'catalog',
      { runner: 'local', version: '2024.2' },
      uri
    );

    await expect(resolveVivadoCacheVersion(config('2023.1'), 'catalog', uri)).resolves.toBe(
      '2023.1'
    );
  });

  it('persists an explicit legacy selection instead of a stale raw pin', async () => {
    const cfg = config('2020.1');
    const uri = resource('/workspace/core.ip.yml');
    await recordVivadoCacheSelection(cfg, 'catalog', null, uri);

    await expect(resolveVivadoCacheVersion(cfg, 'catalog', uri)).resolves.toBeUndefined();
  });

  it('keeps an unscoped scan global in a multi-root workspace', async () => {
    const firstFolder = resource('/workspace/first');
    const secondFolder = resource('/workspace/second');
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: firstFolder },
      { uri: secondFolder },
    ];
    (
      vscode.workspace as unknown as {
        getWorkspaceFolder: jest.Mock;
      }
    ).getWorkspaceFolder.mockImplementation((uri: vscode.Uri) =>
      uri.fsPath.startsWith('/workspace/first') ? { uri: firstFolder } : { uri: secondFolder }
    );
    const cfg = config('');

    await recordVivadoCacheSelection(cfg, 'catalog', {
      runner: 'local',
      version: '2024.2',
    });

    await expect(resolveVivadoCacheVersion(cfg, 'catalog')).resolves.toBe('2024.2');
    await expect(
      resolveVivadoCacheVersion(cfg, 'catalog', resource('/workspace/first/core.ip.yml'))
    ).resolves.toBeUndefined();
  });

  it('keeps the previous valid selection and removes staged metadata when a replacement write fails', async () => {
    const cfg = config('');
    const uri = resource('/workspace/core.ip.yml');
    await recordVivadoCacheSelection(cfg, 'catalog', { runner: 'local', version: '2024.2' }, uri);
    mockWriteFile.mockImplementationOnce(async (file: unknown) => {
      fs.writeFileSync(String(file), '{', 'utf8');
      throw new Error('disk full');
    });

    await expect(
      recordVivadoCacheSelection(cfg, 'catalog', { runner: 'local', version: '2025.1' }, uri)
    ).rejects.toThrow('disk full');

    await expect(resolveVivadoCacheVersion(cfg, 'catalog', uri)).resolves.toBe('2024.2');
    const selectionDir = path.join(FAKE_CONFIG_DIR, 'vivado', 'cache-selections');
    expect(fs.readdirSync(selectionDir).some((name) => name.includes('.tmp-'))).toBe(false);
  });
});
