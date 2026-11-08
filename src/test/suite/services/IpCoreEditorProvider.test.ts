import * as path from 'path';
import * as vscode from 'vscode';
import { IpCoreEditorProvider } from '../../../providers/IpCoreEditorProvider';
import { clearRuntimeBusDefinitionFileCaches } from '../../../services/loadRuntimeBusLibrary';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { normalizeBusLibrary } from '../../../shared/busContracts';
import { ExportTargets } from '../../../providers/imageExport/ExportTargets';
import { RenderAssets } from '../../../services/render/renderResources';
import { DEFAULT_EXPORT_OPTIONS } from '../../../shared/messages/imageExport';
import type { BusDefinitionFile } from '../../../domain/busDefinition.types';

describe('IpCoreEditorProvider bus contract transport', () => {
  beforeEach(() => clearRuntimeBusDefinitionFileCaches());

  it('posts the normalized library unchanged in a revisioned update message', async () => {
    const definitions: BusDefinitionFile = {
      CUSTOM: {
        busType: {
          vendor: 'example.com',
          library: 'interface',
          name: 'custom',
          version: '1.0',
        },
        contract: {
          version: 1,
          interfaceKind: 'conduit',
          modePolicy: { producer: 'master', consumer: 'slave', aliases: {} },
          interfaceProperties: {},
          constraints: [],
        },
        ports: [{ name: 'payload', direction: 'out', role: 'data' }],
      },
    };
    const library = normalizeBusLibrary([
      { sourceFile: '/workspace/custom.yml', sourceKind: 'workspace', definitions },
    ]);
    const repoRoot = path.resolve(__dirname, '../../../..');
    const provider = Object.create(IpCoreEditorProvider.prototype) as IpCoreEditorProvider;
    const logger = { debug: jest.fn(), error: jest.fn() };
    Object.assign(provider as unknown as Record<string, unknown>, {
      logger,
      resourceRoots: devResourceRoots(repoRoot),
      importResolver: { resolveImports: jest.fn().mockResolvedValue({ busLibrary: library }) },
      yamlValidator: {
        validateAgainstSchema: jest.fn().mockReturnValue({ valid: true }),
        findDuplicatePhysicalPrefixes: jest.fn().mockReturnValue([]),
      },
    });
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, fallback?: unknown) => fallback,
    });
    const document = {
      getText: () => 'vlnv:\n  vendor: example.com\n  library: ip\n  name: demo\n  version: 1.0\n',
      version: 7,
      uri: { fsPath: '/workspace/demo.ip.yml' },
    } as unknown as vscode.TextDocument;
    const postUpdate = jest.fn();
    const postNotification = jest.fn();

    await (
      provider as unknown as {
        updateWebview: (
          document: vscode.TextDocument,
          router: { postUpdate: jest.Mock; postNotification: jest.Mock },
          disposed: () => boolean
        ) => Promise<void>;
      }
    ).updateWebview(document, { postUpdate, postNotification }, () => false);

    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ imports: { busLibrary: library } }),
      7
    );
    expect(postUpdate.mock.calls[0][0]).not.toHaveProperty('conformanceReport');
    expect(postNotification).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('IpCoreEditorProvider export image wiring', () => {
  const DOC_TEXT = 'vlnv:\n  vendor: example.com\n  library: ip\n  name: demo\n  version: 1.0\n';

  function setup(stored?: unknown) {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const store = new Map<string, unknown>();
    if (stored !== undefined) {
      store.set('ipcraft.exportImage.ipCore', stored);
    }
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, fallback?: unknown) => fallback,
    });
    const workspaceApi = vscode.workspace as unknown as Record<string, unknown>;
    for (const name of ['onDidChangeConfiguration', 'onDidChangeTextDocument']) {
      workspaceApi[name] ??= jest.fn(() => ({ dispose: jest.fn() }));
    }
    const watcher = {
      onDidCreate: jest.fn(),
      onDidChange: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    };
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue(watcher);
    const provider = new IpCoreEditorProvider(
      {
        extensionUri: { fsPath: '/ext' },
        subscriptions: [],
        workspaceState: { get: (key: string) => store.get(key), update: jest.fn() },
      } as unknown as vscode.ExtensionContext,
      devResourceRoots(repoRoot),
      new ExportTargets(),
      new RenderAssets()
    );
    const library = normalizeBusLibrary([]);
    const exportIpCore = jest.fn().mockResolvedValue(undefined);
    Object.assign(provider as unknown as Record<string, unknown>, {
      htmlGenerator: { generateIpCoreHtml: () => '<html></html>' },
      importResolver: {
        resolveImports: jest.fn().mockResolvedValue({ busLibrary: library }),
        clearCache: jest.fn(),
      },
      imageExport: {
        rememberedOptions: (kind: string) => (kind === 'ipCore' ? stored : undefined),
        exportIpCore,
      },
    });
    (vscode.Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/ext/dist' });
    const posted: unknown[] = [];
    let onMessage: (message: unknown) => Promise<void> = () => Promise.resolve();
    const webviewPanel = {
      active: false,
      webview: {
        options: {},
        html: '',
        postMessage: jest.fn((message: unknown) => {
          posted.push(message);
          return Promise.resolve(true);
        }),
        onDidReceiveMessage: jest.fn((handler: typeof onMessage) => {
          onMessage = handler;
          return { dispose: jest.fn() };
        }),
      },
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.WebviewPanel;
    const document = {
      getText: () => DOC_TEXT,
      version: 1,
      fileName: '/ws/demo.ip.yml',
      uri: { fsPath: '/ws/demo.ip.yml', toString: () => 'file:///ws/demo.ip.yml' },
    } as unknown as vscode.TextDocument;
    provider.resolveCustomTextEditor(document, webviewPanel, {} as vscode.CancellationToken);
    return {
      posted,
      send: (message: unknown) => onMessage(message),
      exportIpCore,
      library,
      document,
    };
  }

  it('posts the options of the last export when the webview is ready', async () => {
    const stored = { ...DEFAULT_EXPORT_OPTIONS, format: 'svg' };
    const { posted, send } = setup(stored);
    await send({ type: 'ready' });
    expect(posted).toContainEqual({ type: 'exportOptions', options: stored });
  });

  it('routes exportImage to the host with the bus library the editor resolved', async () => {
    const { send, exportIpCore, library, document } = setup();
    const message = { type: 'exportImage', options: DEFAULT_EXPORT_OPTIONS, view: {} };
    await send(message);
    expect(exportIpCore).toHaveBeenCalledTimes(1);
    const [doc, getLibrary, sent] = exportIpCore.mock.calls[0] as [
      unknown,
      () => Promise<unknown>,
      unknown,
    ];
    expect(doc).toBe(document);
    expect(sent).toEqual(message);
    await expect(getLibrary()).resolves.toBe(library);
  });
});
