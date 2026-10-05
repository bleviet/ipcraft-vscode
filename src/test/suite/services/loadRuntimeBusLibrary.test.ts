/* eslint-disable @typescript-eslint/no-require-imports -- jest.isolateModules needs synchronous require */
import type * as VscodeType from 'vscode';
import type { ResourceRoots } from '../../../services/ResourceRoots';
import type { LoadedBusDefinitionSources } from '../../../services/BusLibraryService';

type Modules = {
  runtime: typeof import('../../../services/loadRuntimeBusLibrary');
  vscode: typeof VscodeType;
  normalizeSpy: jest.SpyInstance;
  workspaceResult: { library: Record<string, unknown>; count: number; files: unknown[] };
};

const roots = {
  busDefinitionsDir: '/ext/bus_definitions',
  busDefinitionSchemaPath: '/ext/schema.json',
} as ResourceRoots;

function loadModules(): Modules {
  const state = {
    workspaceResult: { library: {}, count: 0, files: [] as unknown[] },
  };
  let modules!: Modules;
  jest.isolateModules(() => {
    jest.doMock('../../../services/VivadoInterfaceScanner', () => ({
      getVivadoInterfaceCacheDir: () => '/fake/vivado',
      pathExists: () => Promise.resolve(false),
    }));
    jest.doMock('../../../services/WorkspaceBusDefinitionScanner', () => ({
      getWorkspaceBusDefinitionScanner: () => ({
        peekAndScanInBackground: () => state.workspaceResult,
        clearCache: jest.fn(),
        onDidScan: jest.fn(() => ({ dispose: jest.fn() })),
      }),
    }));
    const vscode = require('vscode') as typeof VscodeType;
    const { BusLibraryService } = require('../../../services/BusLibraryService') as {
      BusLibraryService: typeof import('../../../services/BusLibraryService').BusLibraryService;
    };
    const builtin: LoadedBusDefinitionSources = { sources: [], diagnostics: [] };
    jest.spyOn(BusLibraryService.prototype, 'loadDefaultSources').mockResolvedValue(builtin);
    const configuredByKey = new Map<string, LoadedBusDefinitionSources>();
    jest
      .spyOn(BusLibraryService.prototype, 'loadFromUserPaths')
      .mockImplementation((paths: string[]) => {
        const key = JSON.stringify(paths);
        const loaded = configuredByKey.get(key) ?? { sources: [], diagnostics: [] };
        configuredByKey.set(key, loaded);
        return Promise.resolve(loaded);
      });
    const normalizeSpy = jest.spyOn(BusLibraryService.prototype, 'normalizeSources');
    (vscode.Uri.file as jest.Mock).mockImplementation((p: string) => ({ fsPath: p }));
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, d?: unknown) => d,
    });
    modules = {
      runtime: require('../../../services/loadRuntimeBusLibrary'),
      vscode,
      normalizeSpy,
      get workspaceResult() {
        return state.workspaceResult;
      },
      set workspaceResult(value) {
        state.workspaceResult = value;
      },
    };
  });
  return modules;
}

describe('loadRuntimeBusLibrary caching', () => {
  const uri = { fsPath: '/project/a.ip.yml' } as VscodeType.Uri;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('../../../services/VivadoInterfaceScanner');
    jest.dontMock('../../../services/WorkspaceBusDefinitionScanner');
  });

  it('returns the same library and normalizes once for repeated calls', async () => {
    const m = loadModules();
    const first = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    const second = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    expect(second).toBe(first);
    expect(m.normalizeSpy).toHaveBeenCalledTimes(1);
  });

  it('re-normalizes after clearRuntimeBusDefinitionFileCaches', async () => {
    const m = loadModules();
    const first = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    m.runtime.clearRuntimeBusDefinitionFileCaches();
    const second = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    expect(second).not.toBe(first);
    expect(m.normalizeSpy).toHaveBeenCalledTimes(2);
  });

  it('re-normalizes when the workspace scan library changes', async () => {
    const m = loadModules();
    const first = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    m.workspaceResult = { library: {}, count: 0, files: [] };
    const second = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    expect(second).not.toBe(first);
  });

  it('keeps a separate memo entry per useBusLibrary', async () => {
    const m = loadModules();
    const stat = jest.fn().mockResolvedValue({ type: m.vscode.FileType.File });
    (m.vscode.workspace as unknown as { fs: unknown }).fs = {
      stat,
      readFile: jest.fn().mockResolvedValue(Buffer.from('{}')),
    };
    const plain = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    const local = await m.runtime.loadRuntimeBusLibrary(roots, uri, { useBusLibrary: './lib.yml' });
    expect(local).not.toBe(plain);
    expect(await m.runtime.loadRuntimeBusLibrary(roots, uri)).toBe(plain);
    expect(await m.runtime.loadRuntimeBusLibrary(roots, uri, { useBusLibrary: './lib.yml' })).toBe(
      local
    );
  });

  it('invalidates on non-IPCraft yaml changes only', async () => {
    const m = loadModules();
    const handlers: Array<(u: { fsPath: string }) => void> = [];
    const watcher = {
      onDidCreate: (h: (u: { fsPath: string }) => void) => handlers.push(h),
      onDidChange: (h: (u: { fsPath: string }) => void) => handlers.push(h),
      onDidDelete: (h: (u: { fsPath: string }) => void) => handlers.push(h),
      dispose: jest.fn(),
    };
    (m.vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue(watcher);
    const context = { subscriptions: [] as unknown[] } as unknown as VscodeType.ExtensionContext;
    m.runtime.registerRuntimeBusLibraryInvalidation(context);
    expect(context.subscriptions).toContain(watcher);
    expect(handlers).toHaveLength(3);

    const first = await m.runtime.loadRuntimeBusLibrary(roots, uri);
    handlers[1]({ fsPath: '/project/x.ip.yml' });
    handlers[1]({ fsPath: '/project/x.mm.yml' });
    expect(await m.runtime.loadRuntimeBusLibrary(roots, uri)).toBe(first);
    handlers[1]({ fsPath: '/project/foo.yml' });
    expect(await m.runtime.loadRuntimeBusLibrary(roots, uri)).not.toBe(first);
  });

  describe('out-of-workspace definition roots', () => {
    function setup(m: Modules, busLibraryPaths: string[]) {
      (m.vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: (key: string, d?: unknown) => (key === 'busLibraryPaths' ? [...busLibraryPaths] : d),
      });
      (m.vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
        { uri: { fsPath: '/project' } },
      ];
      const changeHandlers: Array<() => void> = [];
      const create = m.vscode.workspace.createFileSystemWatcher as jest.Mock;
      create.mockImplementation(() => ({
        onDidCreate: jest.fn(),
        onDidChange: (h: () => void) => changeHandlers.push(h),
        onDidDelete: jest.fn(),
        dispose: jest.fn(),
      }));
      const context = { subscriptions: [] as unknown[] } as unknown as VscodeType.ExtensionContext;
      return { create, changeHandlers, context };
    }

    it('does not watch before registration', async () => {
      const m = loadModules();
      const { create } = setup(m, ['/shared/buses']);
      await m.runtime.loadRuntimeBusLibrary(roots, uri);
      expect(create).not.toHaveBeenCalled();
    });

    it('watches an outside root once and its change clears the cache', async () => {
      const m = loadModules();
      const { create, changeHandlers, context } = setup(m, ['/shared/buses']);
      m.runtime.registerRuntimeBusLibraryInvalidation(context);
      create.mockClear();
      changeHandlers.length = 0;

      const first = await m.runtime.loadRuntimeBusLibrary(roots, uri);
      await m.runtime.loadRuntimeBusLibrary(roots, uri);
      expect(create).toHaveBeenCalledTimes(1);
      const pattern = create.mock.calls[0][0] as { base: { fsPath: string }; pattern: string };
      expect(pattern.base.fsPath).toBe('/shared/buses');
      expect(pattern.pattern).toBe('**/*.{yml,yaml}');

      changeHandlers[0]();
      expect(await m.runtime.loadRuntimeBusLibrary(roots, uri)).not.toBe(first);
    });

    it('adds no extra watcher for a root inside a workspace folder', async () => {
      const m = loadModules();
      const { create, context } = setup(m, ['/project/buses']);
      m.runtime.registerRuntimeBusLibraryInvalidation(context);
      create.mockClear();
      await m.runtime.loadRuntimeBusLibrary(roots, uri);
      expect(create).not.toHaveBeenCalled();
    });

    it('re-normalizes when busLibraryPaths changes', async () => {
      const m = loadModules();
      setup(m, ['/project/a']);
      const first = await m.runtime.loadRuntimeBusLibrary(roots, uri);
      setup(m, ['/project/b']);
      expect(await m.runtime.loadRuntimeBusLibrary(roots, uri)).not.toBe(first);
    });
  });
});
