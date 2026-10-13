import * as vscode from 'vscode';
import { startRegisterSetVersioning } from '../../../commands/StartRegisterSetVersioningCommand';
import { readVersionContext } from '../../../services/versioning/watchVersionContext';
import { buildMapReleases } from '../../../services/versioning/releaseFiles';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/versioning/watchVersionContext', () => ({
  readVersionContext: jest.fn(),
  watchVersionContext: jest.fn(),
}));

jest.mock('../../../utils/ErrorHandler', () => ({
  handleErrorWithUserNotification: jest.fn().mockResolvedValue(undefined),
}));

const IP = '/proj/core.ip.yml';
const MM = '/proj/regs.mm.yml';

const core = (memoryMaps = 'memoryMaps:\n  import: regs.mm.yml\n', version = '1.4.1'): string =>
  `vlnv:\n  vendor: acme\n  library: lib\n  name: core\n  version: ${version}\n  versionScheme: major.minor.patch\n${memoryMaps}`;

const MAP = `# map\nname: CSR_MAP\naddressBlocks:\n  - name: REGS\n    offset: 0x0\n    registers:\n      - name: R\n        offset: 0\n`;
const RECORDED = `${MAP}versionHistory:\n  registerSets:\n    rs1-aaaaaaaaaaaaaaaa:\n      addressBlocks: []\n  versions:\n    - version: 1.0.0\n      registerSet: rs1-aaaaaaaaaaaaaaaa\n`;

interface Store {
  texts: Record<string, string>;
  save: jest.Mock;
  applied: string[];
}

function install(texts: Record<string, string>, dirty: string[] = []): Store {
  const store: Store = {
    texts: { ...texts },
    save: jest.fn().mockResolvedValue(true),
    applied: [],
  };
  (vscode.Uri.file as jest.Mock).mockImplementation((p: string) => ({ fsPath: p }));
  (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(
    Object.keys(texts)
      .filter((file) => file.endsWith('.ip.yml'))
      .map((fsPath) => ({ fsPath }))
  );
  (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((uri: { fsPath: string }) =>
    uri.fsPath.split('/').pop()
  );
  (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest
    .fn()
    .mockImplementation(async ({ fsPath }: { fsPath: string }) => ({
      uri: { fsPath },
      isDirty: dirty.includes(fsPath),
      getText: () => store.texts[fsPath],
      lineCount: store.texts[fsPath].split('\n').length,
      lineAt: (line: number) => ({
        lineNumber: line,
        text: store.texts[fsPath].split('\n')[line],
      }),
      save: store.save,
    }));
  (vscode.workspace.applyEdit as jest.Mock).mockImplementation(
    async (edit: { edits: Array<{ file: string; text: string }> }) => {
      for (const { file, text } of edit.edits) {
        store.texts[file] = text;
        store.applied.push(file);
      }
      return true;
    }
  );
  jest.spyOn(vscode, 'WorkspaceEdit').mockImplementation(() => {
    const edits: Array<{ file: string; text: string }> = [];
    return {
      edits,
      replace: (uri: { fsPath: string }, _range: unknown, text: string) => {
        edits.push({ file: uri.fsPath, text });
      },
    } as unknown as vscode.WorkspaceEdit;
  });
  return store;
}

const uriFor = (fsPath: string): vscode.Uri => ({ fsPath }) as vscode.Uri;
const info = (): jest.Mock => vscode.window.showInformationMessage as jest.Mock;
const error = (): jest.Mock => vscode.window.showErrorMessage as jest.Mock;
const versionsOf = (text: string): string[] =>
  (buildMapReleases(text)[0].input.history?.versions ?? []).map((v) => v.version);

const RESOLVED = { status: 'resolved', ipCorePath: 'core.ip.yml' };

describe('startRegisterSetVersioning', () => {
  afterEach(() => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
  });

  it('records the initial history of an imported map when run on the .ip.yml, in one edit and save', async () => {
    const store = install({ [IP]: core(), [MM]: MAP });
    await startRegisterSetVersioning(uriFor(IP));

    expect(store.applied).toEqual([MM]);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(versionsOf(store.texts[MM])).toEqual(['1.4.1']);
    expect(store.texts[MM]).toContain('# map');
    expect(store.texts[IP]).toBe(core());
    expect(info()).toHaveBeenCalledWith(expect.stringContaining('CSR_MAP: recorded version 1.4.1'));
  });

  it('uses the owning core version when run on the .mm.yml', async () => {
    const store = install({ [IP]: core(undefined, '2.0.0'), [MM]: MAP });
    (readVersionContext as jest.Mock).mockResolvedValue(RESOLVED);
    await startRegisterSetVersioning(uriFor(MM));
    expect(versionsOf(store.texts[MM])).toEqual(['2.0.0']);
  });

  it('works on the active editor when invoked without a uri', async () => {
    const store = install({ [IP]: core(), [MM]: MAP });
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { fileName: IP, uri: uriFor(IP) },
    };
    await startRegisterSetVersioning();
    expect(versionsOf(store.texts[MM])).toEqual(['1.4.1']);
  });

  it('records only the maps without a history and leaves the others alone', async () => {
    const store = install({
      [IP]: core(),
      [MM]: `- name: OLD\n  addressBlocks: []\n  versionHistory:\n    registerSets:\n      rs1-aaaaaaaaaaaaaaaa:\n        addressBlocks: []\n    versions:\n      - version: 1.0.0\n        registerSet: rs1-aaaaaaaaaaaaaaaa\n- name: NEW\n  addressBlocks: []\n`,
    });
    (readVersionContext as jest.Mock).mockResolvedValue(RESOLVED);
    await startRegisterSetVersioning(uriFor(MM));

    const releases = buildMapReleases(store.texts[MM]);
    expect(releases[0].input.history?.versions.map((v) => v.version)).toEqual(['1.0.0']);
    expect(releases[1].input.history?.versions.map((v) => v.version)).toEqual(['1.4.1']);
    expect(store.applied).toEqual([MM]);
  });

  describe.each([
    ['.ip.yml', IP],
    ['.mm.yml', MM],
  ])('an array-entry import with a name override, run on the %s', (_name, target) => {
    it('versions only the first map of the file, under the name generation uses', async () => {
      const store = install({
        [IP]: core('memoryMaps:\n  - import: regs.mm.yml\n    name: RENAMED\n'),
        [MM]: '- name: FIRST\n  addressBlocks: []\n- name: SECOND\n  addressBlocks: []\n',
      });
      (readVersionContext as jest.Mock).mockResolvedValue(RESOLVED);
      await startRegisterSetVersioning(uriFor(target));

      const releases = buildMapReleases(store.texts[MM]);
      expect(releases[0].input.history?.versions.map((v) => v.version)).toEqual(['1.4.1']);
      expect(releases[1].input.history).toBeUndefined();
      expect(info()).toHaveBeenCalledWith(expect.stringContaining('RENAMED: recorded version'));
    });
  });

  it('versions every map of a list file imported with the shortcut', async () => {
    const store = install({
      [IP]: core(),
      [MM]: '- name: FIRST\n  addressBlocks: []\n- name: SECOND\n  addressBlocks: []\n',
    });
    (readVersionContext as jest.Mock).mockResolvedValue(RESOLVED);
    await startRegisterSetVersioning(uriFor(MM));
    const releases = buildMapReleases(store.texts[MM]);
    expect(releases.map((r) => r.input.history?.versions.length)).toEqual([1, 1]);
  });

  it.each([
    ['.ip.yml', IP],
    ['.mm.yml', MM],
  ])('refuses a core version that is invalid for its scheme, run on the %s', async (_n, target) => {
    const store = install({ [IP]: core(undefined, '1.x'), [MM]: MAP });
    (readVersionContext as jest.Mock).mockResolvedValue(RESOLVED);
    await startRegisterSetVersioning(uriFor(target));
    expect(error()).toHaveBeenCalledWith(
      expect.stringMatching(/'1\.x' is not valid for version scheme major\.minor\.patch/)
    );
    expect(store.applied).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('reports an owning core that cannot be read', async () => {
    const store = install({ [MM]: MAP });
    (readVersionContext as jest.Mock).mockResolvedValue(RESOLVED);
    await startRegisterSetVersioning(uriFor(MM));
    expect(error()).toHaveBeenCalledWith(
      expect.stringContaining('core.ip.yml imports regs.mm.yml')
    );
    expect(store.applied).toEqual([]);
  });

  it('says versioning is already active when every map has a history', async () => {
    const store = install({ [IP]: core(), [MM]: RECORDED });
    await startRegisterSetVersioning(uriFor(IP));
    expect(store.applied).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
    expect(info()).toHaveBeenCalledWith('Register-set versioning is already active.');
  });

  it('does not save a file that already had unsaved changes', async () => {
    const store = install({ [IP]: core(), [MM]: MAP }, [MM]);
    await startRegisterSetVersioning(uriFor(IP));
    expect(store.applied).toEqual([MM]);
    expect(store.save).not.toHaveBeenCalled();
    expect(info()).toHaveBeenCalledWith(expect.stringContaining('Left unsaved'));
  });

  it.each([
    ['none', { status: 'none' }, /No IP core imports regs\.mm\.yml/],
    [
      'ambiguous',
      { status: 'ambiguous', candidates: ['a.ip.yml', 'b.ip.yml'] },
      /several IP cores \(a\.ip\.yml, b\.ip\.yml\)/,
    ],
  ])('names the problem and writes nothing for a %s owner', async (_name, context, message) => {
    const store = install({ [MM]: MAP });
    (readVersionContext as jest.Mock).mockResolvedValue(context);
    await startRegisterSetVersioning(uriFor(MM));
    expect(error()).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(store.applied).toEqual([]);
  });

  it('refuses an inline-only core', async () => {
    const store = install({
      [IP]: core('memoryMaps:\n  - name: INLINE\n    addressBlocks: []\n'),
    });
    await startRegisterSetVersioning(uriFor(IP));
    expect(error()).toHaveBeenCalledWith(
      'Register-set versioning needs an imported .mm.yml; this IP core has none.'
    );
    expect(store.applied).toEqual([]);
  });

  it('reports when no spec file is active', async () => {
    await startRegisterSetVersioning();
    expect(error()).toHaveBeenCalledWith('No active .ip.yml or .mm.yml file. Please open one.');
  });
});
