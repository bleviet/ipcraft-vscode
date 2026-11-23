import * as vscode from 'vscode';
import { ensureRegisterSetsReleased } from '../../../../services/versioning/RegisterSetReleaseService';
import { buildMapReleases } from '../../../../services/versioning/releaseFiles';
import * as versionGate from '../../../../services/versioning/versionGate';
import { crc16, crc8 } from '../../../../shared/versioning/versionCrc';

jest.mock('../../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

/** What is saved on disk, per file: the text generation (and the `$version` gate) reads. */
const mockDisk: Record<string, string> = {};

jest.mock('fs/promises', () => ({
  ...jest.requireActual<typeof import('fs/promises')>('fs/promises'),
  // A plain function: `resetMocks` would clear a `jest.fn` implementation before each test.
  readFile: async (file: string) => {
    if (!(file in mockDisk)) {
      throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    }
    return mockDisk[file];
  },
}));

const IP = '/proj/core.ip.yml';
const MM = '/proj/regs.mm.yml';

const core = (version: string, memoryMaps = 'memoryMaps:\n  import: regs.mm.yml\n'): string =>
  `# core\napiVersion: '1.3'\nvlnv:\n  vendor: acme\n  library: lib\n  name: core\n  version: ${version}\n  versionScheme: major.minor.patch\n${memoryMaps}`;

const map = (extraRegister = ''): string => `# register map
name: CSR_MAP
addressBlocks:
  - name: REGS
    offset: 0x0
    registers:
      - name: VERSION
        offset: 0
        resetValue: $version
${extraRegister}`;

const EXTRA = '      - name: EXTRA\n        offset: 4\n';

interface Store {
  texts: Record<string, string>;
  dirty: Set<string>;
  save: jest.Mock;
  applied: Array<{ file: string; text: string }>;
  /** Everything that touched a file, in order: `edit:<file>` and `save:<file>`. */
  events: string[];
}

interface InstallOptions {
  /** Reject every edit. */
  reject?: boolean;
  /** Reject the edits of these files only. */
  rejectFor?: string[];
  /** Files that are open with unsaved changes. */
  dirty?: string[];
  /** Saved text of files whose editor text differs (default: the editor text). */
  disk?: Record<string, string>;
  /** Files whose save fails. */
  saveFails?: string[];
  /** Rewrites a file's text when it is saved (a save participant). */
  onSave?: Record<string, (text: string) => string>;
}

function install(texts: Record<string, string>, options: InstallOptions = {}): Store {
  for (const file of Object.keys(mockDisk)) {
    delete mockDisk[file];
  }
  Object.assign(mockDisk, texts, options.disk);
  const store: Store = {
    texts: { ...texts },
    dirty: new Set(options.dirty),
    save: jest.fn(async (file: string) => {
      if (options.saveFails?.includes(file)) {
        return false;
      }
      store.events.push(`save:${file}`);
      store.dirty.delete(file);
      const transform = options.onSave?.[file];
      if (transform) {
        store.texts[file] = transform(store.texts[file]);
      }
      mockDisk[file] = store.texts[file];
      return true;
    }),
    applied: [],
    events: [],
  };
  const documentFor = (file: string): vscode.TextDocument =>
    ({
      uri: { fsPath: file },
      getText: () => store.texts[file],
      get isDirty() {
        return store.dirty.has(file);
      },
      get lineCount() {
        return store.texts[file].split('\n').length;
      },
      lineAt: (line: number) => ({ lineNumber: line, text: store.texts[file].split('\n')[line] }),
      save: () => store.save(file) as Promise<boolean>,
    }) as unknown as vscode.TextDocument;
  (vscode.Uri.file as jest.Mock).mockImplementation((p: string) => ({ fsPath: p }));
  (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest
    .fn()
    .mockImplementation(async (uri: { fsPath: string }) => documentFor(uri.fsPath));
  (vscode.workspace.applyEdit as jest.Mock).mockImplementation(
    async (edit: { edits: Array<{ file: string; text: string }> }) => {
      if (options.reject || edit.edits.some(({ file }) => options.rejectFor?.includes(file))) {
        return false;
      }
      for (const { file, text } of edit.edits) {
        store.texts[file] = text;
        store.dirty.add(file);
        store.applied.push({ file, text });
        store.events.push(`edit:${file}`);
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

const showWarning = (): jest.Mock => vscode.window.showWarningMessage as jest.Mock;
const showInput = (): jest.Mock => vscode.window.showInputBox as jest.Mock;
const showError = (): jest.Mock => vscode.window.showErrorMessage as jest.Mock;
const uri = { fsPath: IP } as vscode.Uri;

function historyOf(text: string): {
  versions: Array<{ version: string; registerSet: string }>;
  sets: string[];
} {
  const [release] = buildMapReleases(text);
  return {
    versions: release.input.history?.versions ?? [],
    sets: Object.keys(release.input.history?.registerSets ?? {}),
  };
}

/** A map file that already records 1.4.1 for the layout without EXTRA. */
async function released(): Promise<string> {
  const store = install({ [IP]: core('1.4.1'), [MM]: map() });
  await ensureRegisterSetsReleased(uri);
  return store.texts[MM];
}

describe('ensureRegisterSetsReleased', () => {
  it('proceeds without prompting or writing when no map is versioned', async () => {
    const store = install({ [IP]: core('1.4.1'), [MM]: 'name: PLAIN\naddressBlocks: []\n' });
    await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
    expect(showWarning()).not.toHaveBeenCalled();
    expect(store.applied).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('leaves a design without a versioned map to generation: a broken map is not gated', async () => {
    const gate = jest.spyOn(versionGate, 'hasVersionGateErrors');
    const store = install({ [IP]: core('1.4.1'), [MM]: '- ~\n' });
    await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
    expect(gate).not.toHaveBeenCalled();
    expect(showWarning()).not.toHaveBeenCalled();
    expect(showError()).not.toHaveBeenCalled();
    expect(store.applied).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
    gate.mockRestore();
  });

  it('skips inline-only cores silently', async () => {
    const store = install({
      [IP]: core('1.4.1', 'memoryMaps:\n  - name: INLINE\n    addressBlocks: []\n'),
    });
    await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
    expect(store.applied).toEqual([]);
  });

  it('records the initial history of a versioned map in one edit and saves the map file only', async () => {
    const store = install({ [IP]: core('1.4.1'), [MM]: map() });
    const outcome = await ensureRegisterSetsReleased(uri);

    expect(outcome).toEqual({ proceed: true, written: [MM] });
    expect(showWarning()).not.toHaveBeenCalled();
    expect(store.applied.map((a) => a.file)).toEqual([MM]);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(historyOf(store.texts[MM]).versions).toEqual([
      {
        version: '1.4.1',
        registerSet: expect.any(String),
        crc8: crc8([1, 4, 1]),
        crc16: crc16([1, 4, 1]),
      },
    ]);
    expect(store.texts[MM]).toContain('# register map');
    expect(store.texts[MM]).toContain('resetValue: $version');
    expect(store.texts[IP]).toBe(core('1.4.1'));
  });

  it('writes nothing when the map is up to date', async () => {
    const recorded = await released();
    const store = install({ [IP]: core('1.4.1'), [MM]: recorded });
    await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true, written: [] });
    expect(store.applied).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
    expect(showWarning()).not.toHaveBeenCalled();
  });

  it('appends a version-bump-only release without prompting', async () => {
    const recorded = await released();
    const store = install({ [IP]: core('1.4.2'), [MM]: recorded });
    await ensureRegisterSetsReleased(uri);
    expect(showWarning()).not.toHaveBeenCalled();
    const { versions, sets } = historyOf(store.texts[MM]);
    expect(versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
    expect(sets).toHaveLength(1);
  });

  describe('layout changed', () => {
    let recorded: string;
    const changed = (): string =>
      recorded.replace('        resetValue: $version\n', `        resetValue: $version\n${EXTRA}`);
    beforeEach(async () => {
      recorded = await released();
    });

    it('prompts modally once and offers only Adopt when the core version is not recorded', async () => {
      install({ [IP]: core('1.4.2'), [MM]: changed() });
      showWarning().mockResolvedValue(undefined);
      await ensureRegisterSetsReleased(uri);

      expect(showWarning()).toHaveBeenCalledTimes(1);
      const [message, options, ...buttons] = showWarning().mock.calls[0] as [
        string,
        { modal: boolean; detail: string },
        ...string[],
      ];
      expect(message).toBe('Register layout changed since version 1.4.1 (CSR_MAP).');
      expect(options.modal).toBe(true);
      expect(options.detail).toContain('Overwrite is not offered');
      expect(buttons).toEqual(['Adopt as version 1.4.2']);
    });

    it('offers Overwrite of the core version when it is recorded in every pending map', async () => {
      install({ [IP]: core('1.4.1'), [MM]: changed() });
      showWarning().mockResolvedValue(undefined);
      await ensureRegisterSetsReleased(uri);
      const [, options, ...buttons] = showWarning().mock.calls[0] as [
        string,
        { detail: string },
        ...string[],
      ];
      expect(options.detail).toContain('Overwrite: replace the layout recorded for version 1.4.1');
      expect(buttons).toEqual(['Adopt as new version...', 'Overwrite version 1.4.1']);
    });

    it('cancel writes nothing and does not proceed', async () => {
      const store = install({ [IP]: core('1.4.2'), [MM]: changed() });
      showWarning().mockResolvedValue(undefined);
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(store.applied).toEqual([]);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('adopt records the core version as a new entry and keeps the old layout', async () => {
      const store = install({ [IP]: core('1.4.2'), [MM]: changed() });
      showWarning().mockResolvedValue('Adopt as version 1.4.2');
      const outcome = await ensureRegisterSetsReleased(uri);

      expect(outcome).toEqual({ proceed: true, written: [MM] });
      expect(showInput()).not.toHaveBeenCalled();
      const { versions, sets } = historyOf(store.texts[MM]);
      expect(versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
      expect(sets).toHaveLength(2);
      expect(store.applied).toHaveLength(1);
    });

    it('overwrite with the version already recorded re-points that entry', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: changed() });
      showWarning().mockResolvedValue('Overwrite version 1.4.1');
      await ensureRegisterSetsReleased(uri);
      const { versions, sets } = historyOf(store.texts[MM]);
      expect(versions.map((v) => v.version)).toEqual(['1.4.1']);
      expect(sets).toHaveLength(1);
    });

    it('overwrite re-points the entry of the core version, not the latest one', async () => {
      // 1.4.1 -> layout A, 1.4.2 -> layout B, then the core is back at 1.4.1 with layout C.
      const store = install({ [IP]: core('1.4.2'), [MM]: changed() });
      showWarning().mockResolvedValue('Adopt as version 1.4.2');
      await ensureRegisterSetsReleased(uri);
      const adopted = historyOf(store.texts[MM]);

      const layoutC = store.texts[MM].replace(
        `${EXTRA}`,
        `${EXTRA}      - name: EXTRA2\n        offset: 8\n`
      );
      const again = install({ [IP]: core('1.4.1'), [MM]: layoutC });
      showWarning().mockResolvedValue('Overwrite version 1.4.1');
      await ensureRegisterSetsReleased(uri);

      const { versions } = historyOf(again.texts[MM]);
      const [current] = buildMapReleases(again.texts[MM]);
      expect(versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
      // 1.4.1 now holds the current layout, 1.4.2 keeps layout B; generation and history agree.
      expect(versions[0].registerSet).toBe(current.input.currentHash);
      expect(versions[1]).toEqual(adopted.versions[1]);
      expect(versions[0].registerSet).not.toBe(adopted.versions[0].registerSet);
    });

    describe('core version already recorded', () => {
      it('offers a new version instead and writes it to the core and the map, one edit each', async () => {
        const store = install({ [IP]: core('1.4.1'), [MM]: changed() });
        showWarning().mockResolvedValue('Adopt as new version...');
        showInput().mockResolvedValue('1.5.0');
        const outcome = await ensureRegisterSetsReleased(uri);

        expect((showWarning().mock.calls[0] as unknown[]).slice(2)).toEqual([
          'Adopt as new version...',
          'Overwrite version 1.4.1',
        ]);
        expect(showInput()).toHaveBeenCalledWith(
          expect.objectContaining({
            value: '1.4.1',
            title: expect.stringContaining('major.minor.patch'),
          })
        );
        expect(outcome).toEqual({ proceed: true, written: [IP, MM] });
        expect(store.applied.map((a) => a.file)).toEqual([IP, MM]);
        expect(store.texts[IP]).toContain('version: 1.5.0');
        expect(store.texts[IP]).toContain('# core');
        expect(historyOf(store.texts[MM]).versions.map((v) => v.version)).toEqual([
          '1.4.1',
          '1.5.0',
        ]);
        expect(store.save).toHaveBeenCalledTimes(2);
      });

      it('trims the entered version before validating and writing it', async () => {
        const store = install({ [IP]: core('1.4.1'), [MM]: changed() });
        showWarning().mockResolvedValue('Adopt as new version...');
        showInput().mockResolvedValue(' 1.5.0 ');
        await ensureRegisterSetsReleased(uri);

        const { validateInput } = showInput().mock.calls[0][0] as {
          validateInput: (value: string) => string | null;
        };
        expect(validateInput(' 1.5.0 ')).toBeNull();
        expect(validateInput(' 1.4.1 ')).toBe('Version 1.4.1 is already recorded');
        expect(store.texts[IP]).toContain('version: 1.5.0\n');
        expect(historyOf(store.texts[MM]).versions.map((v) => v.version)).toEqual([
          '1.4.1',
          '1.5.0',
        ]);
      });

      it('validates the entered version against the scheme and the recorded versions', async () => {
        install({ [IP]: core('1.4.1'), [MM]: changed() });
        showWarning().mockResolvedValue('Adopt as new version...');
        showInput().mockResolvedValue(undefined);
        await ensureRegisterSetsReleased(uri);

        const { validateInput } = showInput().mock.calls[0][0] as {
          validateInput: (value: string) => string | null;
        };
        expect(validateInput('1.5.0')).toBeNull();
        expect(validateInput('abc')).toEqual(expect.any(String));
        expect(validateInput('1.4.1')).toBe('Version 1.4.1 is already recorded');
      });

      it('cancelling the input box cancels generation without writes', async () => {
        const store = install({ [IP]: core('1.4.1'), [MM]: changed() });
        showWarning().mockResolvedValue('Adopt as new version...');
        showInput().mockResolvedValue(undefined);
        await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
        expect(store.applied).toEqual([]);
        expect(store.save).not.toHaveBeenCalled();
      });
    });
  });

  it('names the maps as generation does: an array-entry override renames the first map', async () => {
    const recorded = await released();
    const changed = recorded.replace(
      '        resetValue: $version\n',
      `        resetValue: $version\n${EXTRA}`
    );
    install({
      [IP]: core('1.4.2', 'memoryMaps:\n  - import: regs.mm.yml\n    name: RENAMED\n'),
      [MM]: changed,
    });
    showWarning().mockResolvedValue(undefined);
    await ensureRegisterSetsReleased(uri);
    expect(showWarning().mock.calls[0][0]).toBe(
      'Register layout changed since version 1.4.1 (RENAMED).'
    );
  });

  it('covers every pending map with one prompt', async () => {
    const recorded = await released();
    const changed = recorded.replace(
      '        resetValue: $version\n',
      `        resetValue: $version\n${EXTRA}`
    );
    const second = '/proj/second.mm.yml';
    install({
      [IP]: core('1.4.2', 'memoryMaps:\n  - import: regs.mm.yml\n  - import: second.mm.yml\n'),
      [MM]: changed,
      [second]: changed.replace('CSR_MAP', 'SECOND_MAP'),
    });
    showWarning().mockResolvedValue(undefined);
    await ensureRegisterSetsReleased(uri);
    expect(showWarning()).toHaveBeenCalledTimes(1);
    expect(showWarning().mock.calls[0][0]).toContain('(CSR_MAP, SECOND_MAP)');
  });

  it('offers Overwrite only when the core version is recorded in every pending map', async () => {
    const recorded = await released();
    const changed = recorded.replace(
      '        resetValue: $version\n',
      `        resetValue: $version\n${EXTRA}`
    );
    const second = '/proj/second.mm.yml';
    install({
      [IP]: core('1.4.1', 'memoryMaps:\n  - import: regs.mm.yml\n  - import: second.mm.yml\n'),
      [MM]: changed,
      // The second map never recorded 1.4.1 (it records 1.3.0 only).
      [second]: changed
        .replace('CSR_MAP', 'SECOND_MAP')
        .replace(/version: 1\.4\.1/, 'version: 1.3.0'),
    });
    showWarning().mockResolvedValue(undefined);
    await ensureRegisterSetsReleased(uri);
    expect((showWarning().mock.calls[0] as unknown[]).slice(2)).toEqual([
      'Adopt as new version...',
    ]);
  });

  describe('unsaved files', () => {
    const SAVE = 'Save and Continue';

    it('asks once before saving a dirty versioned map, then plans from the saved text', async () => {
      const store = install(
        { [IP]: core('1.4.1'), [MM]: map() },
        // A save participant changes the layout: planning must use what is on disk now.
        {
          dirty: [MM],
          onSave: { [MM]: (text) => text.replace('        offset: 0\n', '        offset: 12\n') },
        }
      );
      showWarning().mockResolvedValue(SAVE);
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [MM],
      });

      expect(showWarning()).toHaveBeenCalledTimes(1);
      expect(showWarning()).toHaveBeenCalledWith(
        'regs.mm.yml has unsaved changes. Generation reads memory maps from disk, so they must be saved before the register-set release can be recorded.',
        { modal: true },
        SAVE
      );
      expect(store.events).toEqual([`save:${MM}`, `edit:${MM}`, `save:${MM}`]);
      const [saved] = buildMapReleases(store.texts[MM]);
      expect(saved.input.history?.versions[0].registerSet).toBe(saved.input.currentHash);
      expect(store.texts[MM]).toContain('offset: 12');
    });

    it('names every dirty versioned map in the one modal', async () => {
      const second = '/proj/second.mm.yml';
      install(
        {
          [IP]: core('1.4.1', 'memoryMaps:\n  - import: regs.mm.yml\n  - import: second.mm.yml\n'),
          [MM]: map(),
          [second]: map().replace('CSR_MAP', 'SECOND_MAP'),
        },
        { dirty: [MM, second] }
      );
      showWarning().mockResolvedValue(undefined);
      await ensureRegisterSetsReleased(uri);
      expect(showWarning()).toHaveBeenCalledTimes(1);
      expect(showWarning().mock.calls[0][0]).toMatch(
        /^regs\.mm\.yml, second\.mm\.yml have unsaved changes\./
      );
    });

    it('cancel writes and saves nothing and does not proceed', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: map() }, { dirty: [MM] });
      showWarning().mockResolvedValue(undefined);
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(store.applied).toEqual([]);
      expect(store.save).not.toHaveBeenCalled();
      expect(store.texts[MM]).toBe(map());
    });

    it('does not ask for a dirty map that is not versioned', async () => {
      const store = install(
        { [IP]: core('1.4.1'), [MM]: 'name: PLAIN\naddressBlocks: []\n' },
        { dirty: [MM] }
      );
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      expect(showWarning()).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    });

    it('asks before editing a dirty core for adopt-as-new, and cancel leaves everything alone', async () => {
      const recorded = await released();
      const changed = recorded.replace(
        '        resetValue: $version\n',
        `        resetValue: $version\n${EXTRA}`
      );
      const store = install({ [IP]: core('1.4.1'), [MM]: changed }, { dirty: [IP] });
      const editsAtPrompt: number[] = [];
      showWarning().mockImplementation(async (message: string) => {
        editsAtPrompt.push(store.applied.length);
        return message.startsWith('Register layout') ? 'Adopt as new version...' : undefined;
      });
      showInput().mockResolvedValue('1.5.0');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });

      expect(showWarning()).toHaveBeenCalledTimes(2);
      expect(showWarning().mock.calls[1]).toEqual([
        'core.ip.yml has unsaved changes that will be saved together with the new version.',
        { modal: true },
        SAVE,
      ]);
      expect(editsAtPrompt).toEqual([0, 0]);
      expect(store.applied).toEqual([]);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('saves the dirty core together with the new version after the user agrees', async () => {
      const recorded = await released();
      const changed = recorded.replace(
        '        resetValue: $version\n',
        `        resetValue: $version\n${EXTRA}`
      );
      const store = install({ [IP]: core('1.4.1'), [MM]: changed }, { dirty: [IP] });
      showWarning().mockImplementation(async (message: string) =>
        message.startsWith('Register layout') ? 'Adopt as new version...' : SAVE
      );
      showInput().mockResolvedValue('1.5.0');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [IP, MM],
      });
      expect(store.texts[IP]).toContain('version: 1.5.0');
      expect(store.events).toEqual([`edit:${IP}`, `edit:${MM}`, `save:${IP}`, `save:${MM}`]);
    });

    it('does not ask about a dirty core when the core is not edited', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: map() }, { dirty: [IP] });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [MM],
      });
      expect(showWarning()).not.toHaveBeenCalled();
      expect(store.events).toEqual([`edit:${MM}`, `save:${MM}`]);
    });
  });

  describe('partial failure', () => {
    const changedFrom = (recorded: string): string =>
      recorded.replace('        resetValue: $version\n', `        resetValue: $version\n${EXTRA}`);

    it('names the core edit that stays unsaved when the map edit is rejected', async () => {
      const recorded = await released();
      const store = install(
        { [IP]: core('1.4.1'), [MM]: changedFrom(recorded) },
        { rejectFor: [MM] }
      );
      showWarning().mockResolvedValue('Adopt as new version...');
      showInput().mockResolvedValue('1.5.0');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });

      expect(showError()).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Register-set versioning failed: .*rejected the edit of \/proj\/regs\.mm\.yml\. core\.ip\.yml was changed to version 1\.5\.0 and is unsaved\.$/
        )
      );
      expect(store.save).not.toHaveBeenCalled();
      expect(store.dirty.has(IP)).toBe(true);
      expect(store.texts[IP]).toContain('version: 1.5.0');
    });

    it('detects the left-over core edit on the next run and does not treat the map as up to date', async () => {
      const recorded = await released();
      const failed = install(
        { [IP]: core('1.4.1'), [MM]: changedFrom(recorded) },
        { rejectFor: [MM] }
      );
      showWarning().mockResolvedValue('Adopt as new version...');
      showInput().mockResolvedValue('1.5.0');
      await ensureRegisterSetsReleased(uri);

      // Next run: the core buffer (dirty, 1.5.0) and the unchanged map on disk.
      const next = install({ [IP]: failed.texts[IP], [MM]: failed.texts[MM] }, { dirty: [IP] });
      showWarning().mockClear();
      showWarning().mockResolvedValue('Adopt as version 1.5.0');
      await ensureRegisterSetsReleased(uri);

      expect(showWarning()).toHaveBeenCalledTimes(1);
      expect(showWarning().mock.calls[0][0]).toMatch(/^Register layout changed since version/);
      expect(historyOf(next.texts[MM]).versions.map((v) => v.version)).toEqual(['1.4.1', '1.5.0']);
    });

    it('reports the map that stays unsaved when its save fails, and asks again on the next run', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: map() }, { saveFails: [MM] });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(showError()).toHaveBeenCalledWith(
        expect.stringMatching(
          /regs\.mm\.yml could not be saved\. regs\.mm\.yml was changed and is unsaved\.$/
        )
      );
      expect(store.dirty.has(MM)).toBe(true);

      // The buffer now records 1.4.1, but disk does not: the next run must not trust it.
      const next = install({ [IP]: core('1.4.1'), [MM]: store.texts[MM] }, { dirty: [MM] });
      showWarning().mockResolvedValue(undefined);
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(showWarning().mock.calls[0][0]).toMatch(/^regs\.mm\.yml has unsaved changes/);
      expect(next.applied).toEqual([]);
    });

    it('lists every file that remains unsaved when a later save fails', async () => {
      const recorded = await released();
      const store = install(
        { [IP]: core('1.4.1'), [MM]: changedFrom(recorded) },
        { saveFails: [MM] }
      );
      showWarning().mockResolvedValue('Adopt as new version...');
      showInput().mockResolvedValue('1.5.0');
      await ensureRegisterSetsReleased(uri);
      expect(showError()).toHaveBeenCalledWith(
        expect.stringMatching(/regs\.mm\.yml was changed and is unsaved\.$/)
      );
      expect(store.events).toEqual([`edit:${IP}`, `edit:${MM}`, `save:${IP}`]);
      expect(showError().mock.calls[0][0]).not.toContain('core.ip.yml was changed');
    });
  });

  describe('invalid core version', () => {
    it('is never recorded: an error names the version and the scheme', async () => {
      // No live `$version` reference, so the generation gate does not report the version itself.
      const recorded = (await released()).replace('resetValue: $version\n', 'resetValue: 0\n');
      const store = install({ [IP]: core('1.x'), [MM]: recorded });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(showError()).toHaveBeenCalledWith(
        expect.stringMatching(/'1\.x' is not valid for version scheme major\.minor\.patch/)
      );
      expect(showWarning()).not.toHaveBeenCalled();
      expect(store.applied).toEqual([]);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('does not block a map that is up to date', async () => {
      const recorded = await released();
      install({ [IP]: core('1.4.1'), [MM]: recorded });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [],
      });
    });
  });

  describe('$version gate', () => {
    /** `$version.feature` does not exist in major.minor.patch: a gate error generation reports. */
    const gated = (text: string): string =>
      text.replace('resetValue: $version\n', 'resetValue: $version.feature\n');

    it('records nothing and prompts for nothing when the gate would block generation', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: gated(map()) });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      expect(showWarning()).not.toHaveBeenCalled();
      expect(showError()).not.toHaveBeenCalled();
      expect(store.applied).toEqual([]);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('does not offer a release for a changed layout that the gate blocks', async () => {
      const recorded = await released();
      const store = install({
        [IP]: core('1.4.2'),
        [MM]: gated(recorded).replace('resetValue: $version.feature\n', `$&${EXTRA}`),
      });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      expect(showWarning()).not.toHaveBeenCalled();
      expect(showInput()).not.toHaveBeenCalled();
      expect(store.applied).toEqual([]);
    });

    it('asks to save an unsaved versioned map first, then the gate blocks on the saved file', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: gated(map()) }, { dirty: [MM] });
      showWarning().mockResolvedValue('Save and Continue');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      expect(showWarning()).toHaveBeenCalledTimes(1);
      expect(store.events).toEqual([`save:${MM}`]);
      expect(store.applied).toEqual([]);
    });

    it('does not proceed when the user declines to save an unsaved map that has gate errors', async () => {
      const store = install({ [IP]: core('1.4.1'), [MM]: gated(map()) }, { dirty: [MM] });
      showWarning().mockResolvedValue(undefined);
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(store.save).not.toHaveBeenCalled();
    });

    it('gates the saved file, not the editor text: an editor-only gate error does not hide a layout change', async () => {
      const recorded = await released();
      const savedChanged = recorded.replace(
        '        resetValue: $version\n',
        `        resetValue: $version\n${EXTRA}`
      );
      // The editor text has a gate error; the saved file is valid and has a changed layout.
      // Saving writes the editor text, so the gate then blocks and nothing is recorded.
      const store = install(
        { [IP]: core('1.4.2'), [MM]: gated(savedChanged) },
        { dirty: [MM], disk: { [MM]: savedChanged } }
      );
      showWarning().mockResolvedValue('Save and Continue');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      // The save prompt is shown (the saved file is versioned) and the gate sees what was saved.
      expect(showWarning()).toHaveBeenCalledTimes(1);
      expect(showWarning().mock.calls[0][0]).toMatch(/^regs\.mm\.yml has unsaved changes/);
      expect(store.events).toEqual([`save:${MM}`]);
    });

    it('plans from the saved text after saving a map whose saved file had a gate error', async () => {
      const recorded = await released();
      const savedChanged = recorded.replace(
        '        resetValue: $version\n',
        `        resetValue: $version\n${EXTRA}`
      );
      // The user fixed the gate error in the editor, but the buffer is still unsaved; the saved
      // file has the gate error (editor valid, disk gated).
      const store = install(
        { [IP]: core('1.4.2'), [MM]: savedChanged },
        { dirty: [MM], disk: { [MM]: gated(savedChanged) } }
      );
      showWarning().mockImplementation(async (message: string) =>
        message.startsWith('Register layout') ? 'Adopt as version 1.4.2' : 'Save and Continue'
      );
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [MM],
      });
      expect(showWarning().mock.calls[0][0]).toMatch(/^regs\.mm\.yml has unsaved changes/);
      expect(store.events).toEqual([`save:${MM}`, `edit:${MM}`, `save:${MM}`]);
      expect(historyOf(store.texts[MM]).versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
    });

    it('asks to save a dirty map whose saved file is versioned although the editor text is not', async () => {
      // The unsaved edit removed every reference; the saved file still has the gate error.
      const store = install(
        {
          [IP]: core('1.4.1', 'memoryMaps:\n  - import: regs.mm.yml\n  - import: other.mm.yml\n'),
          [MM]: 'name: PLAIN\naddressBlocks: []\n',
          '/proj/other.mm.yml': map().replace('CSR_MAP', 'OTHER_MAP'),
        },
        { dirty: [MM], disk: { [MM]: gated(map()) } }
      );
      showWarning().mockResolvedValue(undefined);
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
      expect(showWarning().mock.calls[0][0]).toMatch(/^regs\.mm\.yml has unsaved changes/);
      expect(store.applied).toEqual([]);
    });

    it('after saving that map, the gate and the plan see the saved text', async () => {
      const other = '/proj/other.mm.yml';
      const store = install(
        {
          [IP]: core('1.4.1', 'memoryMaps:\n  - import: regs.mm.yml\n  - import: other.mm.yml\n'),
          [MM]: 'name: PLAIN\naddressBlocks: []\n',
          [other]: map().replace('CSR_MAP', 'OTHER_MAP'),
        },
        { dirty: [MM], disk: { [MM]: gated(map()) } }
      );
      showWarning().mockResolvedValue('Save and Continue');
      // The saved text has no reference left, so generation passes the gate: the other map is released.
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [other],
      });
      expect(store.events).toEqual([`save:${MM}`, `edit:${other}`, `save:${other}`]);
    });

    it('after saving, a gate error that is only in the saved text blocks every history write', async () => {
      const other = '/proj/other.mm.yml';
      const store = install(
        {
          [IP]: core('1.4.1', 'memoryMaps:\n  - import: regs.mm.yml\n  - import: other.mm.yml\n'),
          [MM]: gated(map()),
          [other]: map().replace('CSR_MAP', 'OTHER_MAP'),
        },
        { dirty: [MM] }
      );
      showWarning().mockResolvedValue('Save and Continue');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      expect(store.events).toEqual([`save:${MM}`]);
      expect(store.applied).toEqual([]);
    });

    it('gates on the core version too: an invalid version with a reference is left to generation', async () => {
      const store = install({ [IP]: core('1.x'), [MM]: map() });
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
      expect(showError()).not.toHaveBeenCalled();
      expect(store.applied).toEqual([]);
    });

    it('still records when the gate only has warnings (a moved version register)', async () => {
      const recorded = await released();
      const moved = recorded.replace(
        '        offset: 0\n        resetValue: $version\n',
        '        offset: 8\n        resetValue: $version\n'
      );
      expect(moved).not.toBe(recorded);
      const store = install({ [IP]: core('1.4.2'), [MM]: moved });
      showWarning().mockResolvedValue('Adopt as version 1.4.2');
      await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({
        proceed: true,
        written: [MM],
      });
      expect(showWarning()).toHaveBeenCalledTimes(1);
      expect(historyOf(store.texts[MM]).versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
    });
  });

  it('shows an error and does not proceed when the editor rejects the edit', async () => {
    install({ [IP]: core('1.4.1'), [MM]: map() }, { reject: true });
    await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: false });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Register-set versioning failed')
    );
  });

  it('proceeds when the imported map file cannot be opened', async () => {
    install({ [IP]: core('1.4.1'), [MM]: map() });
    delete mockDisk[MM];
    const open = vscode.workspace.openTextDocument as jest.Mock;
    const original = open.getMockImplementation() as (u: { fsPath: string }) => Promise<unknown>;
    open.mockImplementation(async (u: { fsPath: string }) => {
      if (u.fsPath === MM) {
        throw new Error('missing');
      }
      return original(u);
    });
    await expect(ensureRegisterSetsReleased(uri)).resolves.toEqual({ proceed: true });
    // Nothing is versioned, so the `$version` gate (which would warn about the failed import) is
    // not run: generation reports the missing map itself.
    expect(console.warn).not.toHaveBeenCalled();
  });
});
