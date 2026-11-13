import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DEFAULT_EXPORT_OPTIONS } from '../../../shared/messages/imageExport';
import { RenderAssets } from '../../../services/render/renderResources';
import { ExportTargets } from '../../../providers/imageExport/ExportTargets';
import { SWAP_GRACE_MS } from '../../../providers/systemDiagram/DiagramPanels';
import {
  ENRICHMENT_GRACE_MS,
  SystemDiagramProvider,
} from '../../../providers/SystemDiagramProvider';
import { pickCompareBase } from '../../../providers/systemDiagram/pickCompareBase';
import { renderSystemLevelImage } from '../../../services/render/systemLevelImage';
import type { RenderRoots } from '../../../services/render/imageEncoding';
import { changeRows, cellText } from '../../../services/systemDiagram/diff/changeRows';
import { fixtureText, qsysFixtureText } from '../webview/systemDiagram/fixtureGraph';

jest.mock('../../../services/HtmlGenerator', () => ({
  HtmlGenerator: class {
    generateSystemDiagramHtml(): string {
      return '<html>system diagram</html>';
    }
  },
}));

jest.mock('../../../services/render/systemLevelImage', () => ({
  renderSystemLevelImage: jest.fn().mockResolvedValue(new Uint8Array([1])),
}));

jest.mock('../../../providers/systemDiagram/pickCompareBase', () => ({
  pickCompareBase: jest.fn(),
}));

const mockEnrich = jest.fn();
/** The revision of the workspace definitions the mocked enricher reports; a test bumps it. */
let mockEnrichRevision = 1;

jest.mock('../../../services/systemDiagram/SystemDesignEnricher', () => ({
  SystemDesignEnricher: class {
    get revision() {
      return String(mockEnrichRevision);
    }
    enrich = (graph: unknown) => mockEnrich(graph) as Promise<unknown>;
    dispose = jest.fn();
  },
}));

type WebviewHandler = (message: unknown) => Promise<void>;
type ChangeHandler = (event: { document: { uri: { toString(): string } } }) => void;

const uri = { toString: () => 'file:///ws/zynq.tcl', fsPath: '/ws/zynq.tcl' };

function setup(text: string, fileName = '/ws/zynq.tcl', relativeName = 'zynq.tcl') {
  const posted: unknown[] = [];
  let webviewHandler: WebviewHandler | undefined;
  let changeHandler: ChangeHandler | undefined;
  let disposeHandler: (() => void) | undefined;
  const changeSubscription = { dispose: jest.fn() };
  const subscriptions: unknown[] = [];
  mockEnrich.mockImplementation((graph: unknown) => Promise.resolve(graph));
  mockEnrichRevision = 1;
  (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => ({ fsPath }));

  (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue(relativeName);
  let trustHandler: (() => void) | undefined;
  const trustSubscription = { dispose: jest.fn() };
  (vscode.workspace.onDidGrantWorkspaceTrust as jest.Mock).mockImplementation(
    (handler: () => void) => {
      trustHandler = handler;
      return trustSubscription;
    }
  );
  (vscode.Uri.parse as jest.Mock).mockImplementation((text: string) => ({
    fsPath: text.replace('file://', ''),
    parsedFrom: text,
  }));
  (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockImplementation(
    (handler: ChangeHandler) => {
      changeHandler = handler;
      return changeSubscription;
    }
  );
  (vscode.Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/ext/dist' });

  const documentState = { text };
  const document = {
    uri,
    fileName,
    getText: () => documentState.text,
  } as unknown as vscode.TextDocument;
  const webviewPanel = {
    active: true,
    webview: {
      options: {} as vscode.WebviewOptions,
      html: '',
      postMessage: jest.fn((message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      }),
      onDidReceiveMessage: jest.fn((handler: WebviewHandler) => {
        webviewHandler = handler;
        return { dispose: jest.fn() };
      }),
    },
    onDidDispose: jest.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: jest.fn() };
    }),
  } as unknown as vscode.WebviewPanel;

  const workspaceStateStore = new Map<string, unknown>();
  const workspaceState = {
    get: jest.fn((key: string) => workspaceStateStore.get(key)),
    update: jest.fn((key: string, value: unknown) => {
      if (value === undefined) {
        workspaceStateStore.delete(key);
      } else {
        workspaceStateStore.set(key, value);
      }
      return Promise.resolve();
    }),
  };

  const provider = new SystemDiagramProvider(
    {
      extensionUri: { fsPath: '/ext' },
      subscriptions,
      workspaceState,
    } as unknown as vscode.ExtensionContext,
    {} as RenderRoots,
    new ExportTargets(),
    new RenderAssets()
  );
  provider.resolveCustomTextEditor(document, webviewPanel, {} as vscode.CancellationToken);

  return {
    provider,
    posted,
    subscriptions,
    workspaceState,
    workspaceStateStore,
    document: documentState,
    trustSubscription,
    grantTrust: () => {
      // The enricher's revision includes whether the workspace is trusted.
      mockEnrichRevision += 1;
      trustHandler!();
    },
    webviewPanel,
    changeSubscription,
    send: (message: unknown) => webviewHandler!(message),
    change: () => changeHandler!({ document: { uri } }),
    dispose: () => disposeHandler!(),
  };
}

describe('SystemDiagramProvider', () => {
  it('limits resources to dist and sets the system diagram html', () => {
    const { webviewPanel } = setup(fixtureText);
    expect(webviewPanel.webview.options.enableScripts).toBe(true);
    expect(webviewPanel.webview.options.localResourceRoots).toEqual([{ fsPath: '/ext/dist' }]);
    expect(vscode.Uri.joinPath).toHaveBeenCalledWith({ fsPath: '/ext' }, 'dist');
    expect(webviewPanel.webview.html).toBe('<html>system diagram</html>');
  });

  it('posts the graph when the webview is ready', async () => {
    const { posted, send } = setup(fixtureText);
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: 'graph',
      graph: { name: 'zynq_dma_system', source: { fileName: 'zynq.tcl' } },
    });
  });

  it('posts a qsys graph for a Platform Designer document', async () => {
    const { posted, send } = setup(qsysFixtureText, '/ws/nios.qsys', 'nios.qsys');
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: 'graph',
      graph: { name: 'nios', source: { fileName: 'nios.qsys', format: 'qsys' } },
    });
  });

  it('posts notRecognized for scripts that are not block designs', async () => {
    const { posted, send } = setup('puts hello\n');
    await send({ type: 'ready' });
    expect(posted).toEqual([{ type: 'notRecognized', fileName: 'zynq.tcl' }]);
  });

  it('posts notRecognized for Platform Designer _hw.tcl files', async () => {
    const { posted, send } = setup(fixtureText, '/ws/ip_hw.tcl');
    await send({ type: 'ready' });
    expect(posted[0]).toMatchObject({ type: 'notRecognized' });
  });

  it('re-posts when the document changes and ignores other documents', async () => {
    const { posted, send, change, webviewPanel } = setup(fixtureText);
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    change();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.map((message) => (message as { type: string }).type)).toEqual(['graph', 'graph']);
    expect(webviewPanel.webview.postMessage).toHaveBeenCalledTimes(2);
  });

  it('posts an error when reading throws', async () => {
    const { posted, send } = setup(fixtureText);
    const original = jest.requireActual<typeof import('../../../parser/system/BdTclReader')>(
      '../../../parser/system/BdTclReader'
    );
    const spy = jest.spyOn(original, 'readBdTcl').mockImplementation(() => {
      throw new Error('bad script');
    });
    try {
      await send({ type: 'ready' });
    } finally {
      spy.mockRestore();
    }
    expect(posted).toEqual([{ type: 'error', message: 'bad script' }]);
  });

  it('posts the enriched graph and disposes the enricher with the context', async () => {
    const { posted, send, subscriptions } = setup(fixtureText);
    const definition = {
      kind: 'hdl',
      file: '/ws/pulse.vhd',
      uri: 'file:///ws/pulse.vhd',
      displayName: 'pulse.vhd',
    };
    mockEnrich.mockImplementation((graph: { instances: Record<string, object> }) =>
      Promise.resolve({
        ...graph,
        instances: {
          ...graph.instances,
          '/axi_dma_0': { ...graph.instances['/axi_dma_0'], definition },
        },
      })
    );
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: 'graph',
      graph: { instances: { '/axi_dma_0': { definition } } },
    });
    expect(subscriptions).toHaveLength(1);
  });

  it('drops a stale enrichment that resolves after a newer one', async () => {
    const { posted, send, change } = setup(fixtureText);
    const resolvers: ((graph: unknown) => void)[] = [];
    mockEnrich.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    await send({ type: 'ready' });
    change();
    resolvers[1]({ name: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolvers[0]({ name: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toEqual([{ type: 'graph', graph: { name: 'second' } }]);
  });

  it('opens an ip.yml definition in the IP core editor beside, and ignores unknown instances', async () => {
    const { send } = setup(fixtureText);
    mockEnrich.mockImplementation((graph: { instances: Record<string, object> }) =>
      Promise.resolve({
        ...graph,
        instances: {
          ...graph.instances,
          '/axi_dma_0': {
            ...graph.instances['/axi_dma_0'],
            definition: {
              kind: 'ip.yml',
              file: '/ws/dma.ip.yml',
              uri: 'file:///ws/dma.ip.yml',
              displayName: 'dma.ip.yml',
            },
          },
        },
      })
    );
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await send({ type: 'openDefinition', instance: '/ghost' });
    await send({ type: 'openDefinition', instance: '/axi_gpio_0' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    await send({ type: 'openDefinition', instance: '/axi_dma_0' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      expect.objectContaining({ parsedFrom: 'file:///ws/dma.ip.yml' }),
      'fpgaIpCore.editor',
      vscode.ViewColumn.Beside
    );
  });

  it('opens an HDL definition in a text editor beside', async () => {
    const { send } = setup(fixtureText);
    mockEnrich.mockImplementation((graph: { instances: Record<string, object> }) =>
      Promise.resolve({
        ...graph,
        instances: {
          ...graph.instances,
          '/axi_dma_0': {
            ...graph.instances['/axi_dma_0'],
            definition: {
              kind: 'hdl',
              file: '/ws/dma.vhd',
              uri: 'file:///ws/dma.vhd',
              displayName: 'dma.vhd',
            },
          },
        },
      })
    );
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await send({ type: 'openDefinition', instance: '/axi_dma_0' });
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ parsedFrom: 'file:///ws/dma.vhd' }),
      { viewColumn: vscode.ViewColumn.Beside }
    );
  });

  it('opens a definition by its URI, not a local path', async () => {
    const { send } = setup(fixtureText);
    mockEnrich.mockImplementation((graph: { instances: Record<string, object> }) =>
      Promise.resolve({
        ...graph,
        instances: {
          ...graph.instances,
          '/axi_dma_0': {
            ...graph.instances['/axi_dma_0'],
            definition: {
              kind: 'hdl',
              file: '/remote/dma.vhd',
              uri: 'vscode-remote://host/remote/dma.vhd',
              displayName: 'dma.vhd',
            },
          },
        },
      })
    );
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await send({ type: 'openDefinition', instance: '/axi_dma_0' });
    expect(vscode.Uri.parse).toHaveBeenCalledWith('vscode-remote://host/remote/dma.vhd');
    expect(vscode.Uri.file).not.toHaveBeenCalled();
  });

  it('re-posts the graph when workspace trust is granted and disposes the listener', async () => {
    const { posted, send, grantTrust, dispose, trustSubscription } = setup(fixtureText);
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    grantTrust();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockEnrich).toHaveBeenCalledTimes(2);
    expect(posted.map((message) => (message as { type: string }).type)).toEqual(['graph', 'graph']);
    dispose();
    expect(trustSubscription.dispose).toHaveBeenCalled();
  });

  it('drops a pending enrichment when a later edit is not recognized', async () => {
    const { posted, send, change, document } = setup(fixtureText);
    let resolvePending: (graph: unknown) => void = () => undefined;
    mockEnrich.mockImplementation(() => new Promise((resolve) => (resolvePending = resolve)));
    await send({ type: 'ready' });
    document.text = 'puts hello\n';
    change();
    resolvePending({ name: 'stale' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toEqual([{ type: 'notRecognized', fileName: 'zynq.tcl' }]);
  });

  it('posts the un-enriched graph when enrichment rejects', async () => {
    const { posted, send } = setup(fixtureText);
    mockEnrich.mockImplementation(() => Promise.reject(new Error('index failed')));
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'graph', graph: { name: 'zynq_dma_system' } });
  });

  describe('slow enrichment', () => {
    const storageKey = 'ipcraft.systemDiagram.highlights:file:///ws/zynq.tcl';
    const types = (posted: unknown[]) =>
      posted.map((message) => (message as { type: string }).type);
    const resolvers: ((graph: unknown) => void)[] = [];

    beforeEach(() => {
      jest.useFakeTimers();
      resolvers.length = 0;
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const slowEnrichment = () =>
      mockEnrich.mockImplementation(
        (graph: object) =>
          new Promise((resolve) => resolvers.push(() => resolve({ ...graph, name: 'enriched' })))
      );

    it('posts the parsed graph with an info diagnostic after the grace period, then the enriched one', async () => {
      const { posted, send } = setup(fixtureText);
      slowEnrichment();
      const ready = send({ type: 'ready' });
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS - 1);
      expect(posted).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        type: 'graph',
        graph: {
          name: 'zynq_dma_system',
          diagnostics: expect.arrayContaining([
            { severity: 'info', message: 'Resolving workspace definitions…' },
          ]),
        },
      });
      resolvers[0](undefined);
      await ready;
      await jest.advanceTimersByTimeAsync(0);
      expect(types(posted)).toEqual(['graph', 'graph']);
      expect(posted[1]).toMatchObject({ graph: { name: 'enriched' } });
      const final = posted[1] as { graph: { diagnostics: { message: string }[] } };
      expect(final.graph.diagnostics.map((d) => d.message)).not.toContain(
        'Resolving workspace definitions…'
      );
    });

    it('posts exactly one graph when enrichment beats the grace period', async () => {
      const { posted, send } = setup(fixtureText);
      await send({ type: 'ready' });
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS * 2);
      expect(types(posted)).toEqual(['graph']);
    });

    it('posts no stale graph when a document edit overtakes a slow enrichment', async () => {
      const { posted, send, change, document } = setup(fixtureText);
      slowEnrichment();
      void send({ type: 'ready' });
      document.text = 'puts hello\n';
      change();
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS * 2);
      resolvers[0](undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(posted).toEqual([{ type: 'notRecognized', fileName: 'zynq.tcl' }]);
    });

    it('does not write workspaceState on the early post, only on the final one', async () => {
      const { posted, send, workspaceState, workspaceStateStore } = setup(fixtureText);
      workspaceStateStore.set(storageKey, {
        'instance:/axi_dma_0': 'red',
        'instance:/vanished_ip': 'yellow',
      });
      slowEnrichment();
      void send({ type: 'ready' });
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS);
      expect(posted[0]).toMatchObject({
        type: 'graph',
        highlights: { 'instance:/axi_dma_0': 'red' },
      });
      expect(workspaceState.update).not.toHaveBeenCalled();
      resolvers[0](undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(workspaceState.update).toHaveBeenCalledWith(storageKey, {
        'instance:/axi_dma_0': 'red',
      });
    });

    it('posts the plain parsed graph and persists when enrichment rejects after the early post', async () => {
      const { posted, send, workspaceState, workspaceStateStore } = setup(fixtureText);
      workspaceStateStore.set(storageKey, {
        'instance:/axi_dma_0': 'red',
        'instance:/vanished_ip': 'yellow',
      });
      const rejecters: ((error: Error) => void)[] = [];
      mockEnrich.mockImplementation(
        () => new Promise((_resolve, reject) => rejecters.push(reject))
      );
      void send({ type: 'ready' });
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS);
      rejecters[0](new Error('index failed'));
      await jest.advanceTimersByTimeAsync(0);
      expect(types(posted)).toEqual(['graph', 'graph']);
      const final = posted[1] as { graph: { name: string; diagnostics: { message: string }[] } };
      expect(final.graph.name).toBe('zynq_dma_system');
      expect(final.graph.diagnostics.map((d) => d.message)).not.toContain(
        'Resolving workspace definitions…'
      );
      expect(workspaceState.update).toHaveBeenCalledWith(storageKey, {
        'instance:/axi_dma_0': 'red',
      });
    });

    it('drops the first run final post when a document edit follows the early post', async () => {
      const { posted, send, change } = setup(fixtureText);
      slowEnrichment();
      void send({ type: 'ready' });
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS);
      change();
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS);
      resolvers[0](undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(types(posted)).toEqual(['graph', 'graph']);
      resolvers[1](undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(types(posted)).toEqual(['graph', 'graph', 'graph']);
      expect(posted[2]).toMatchObject({ graph: { name: 'enriched' } });
    });

    it('keeps stored highlights on enrichment-only instances across a grace-window edit', async () => {
      const { posted, send, workspaceStateStore } = setup(fixtureText);
      workspaceStateStore.set(storageKey, {
        'instance:/axi_dma_0': 'red',
        'instance:/sub_0/inner': 'green',
      });
      mockEnrich.mockImplementation(
        (graph: { instances: Record<string, object> }) =>
          new Promise((resolve) =>
            resolvers.push(() =>
              resolve({
                ...graph,
                instances: { ...graph.instances, '/sub_0/inner': graph.instances['/axi_dma_0'] },
              })
            )
          )
      );
      void send({ type: 'ready' });
      await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS);
      // The early message hides the enrichment-only key from the webview.
      expect(posted[0]).toMatchObject({ highlights: { 'instance:/axi_dma_0': 'red' } });
      expect((posted[0] as { highlights: object }).highlights).not.toHaveProperty(
        'instance:/sub_0/inner'
      );
      await send({
        type: 'setHighlights',
        highlights: { 'instance:/axi_dma_0': 'red', 'instance:/axi_gpio_0': 'yellow' },
      });
      expect(workspaceStateStore.get(storageKey)).toEqual({
        'instance:/axi_dma_0': 'red',
        'instance:/axi_gpio_0': 'yellow',
        'instance:/sub_0/inner': 'green',
      });
      resolvers[0](undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(posted[1]).toMatchObject({
        highlights: {
          'instance:/axi_dma_0': 'red',
          'instance:/axi_gpio_0': 'yellow',
          'instance:/sub_0/inner': 'green',
        },
      });
    });
  });

  it('reveals the requested line in a text editor beside the diagram', async () => {
    const { send } = setup(fixtureText);
    await send({ type: 'revealSource', line: 42 });
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
    const [, options] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0] as [
      unknown,
      { viewColumn: number; selection: vscode.Range; preserveFocus: boolean },
    ];
    expect(options.viewColumn).toBe(vscode.ViewColumn.Beside);
    expect(options.preserveFocus).toBe(false);
    expect(options.selection).toMatchObject({ startLine: 41, endLine: 41, startCharacter: 0 });
  });

  describe('revealSource with a uri', () => {
    const subUri = 'file:///ws/lib/sub_system.qsys';
    const openSubsystemDocument = async (requested: string) => {
      const ctx = setup(fixtureText);
      mockEnrich.mockImplementation((graph: { levels: Record<string, unknown> }) =>
        Promise.resolve({
          ...graph,
          levels: {
            ...graph.levels,
            '/sub_0': {
              path: '/sub_0',
              name: 'sub_0',
              boundaryPins: [],
              instances: [],
              source: { fileName: 'lib/sub_system.qsys', uri: subUri },
            },
          },
        })
      );
      const subDocument = { uri: { toString: () => subUri } };
      const openTextDocument = jest.fn().mockResolvedValue(subDocument);
      (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument =
        openTextDocument;
      await ctx.send({ type: 'ready' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await ctx.send({ type: 'revealSource', line: 7, uri: requested });
      return { openTextDocument, subDocument };
    };

    it('opens a file that a graph level was read from', async () => {
      const { openTextDocument, subDocument } = await openSubsystemDocument(subUri);
      expect(openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ parsedFrom: subUri })
      );
      const [document, options] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0] as [
        unknown,
        { selection: vscode.Range },
      ];
      expect(document).toBe(subDocument);
      expect(options.selection).toMatchObject({ startLine: 6, endLine: 6 });
    });

    it('ignores a uri that no level was read from', async () => {
      const { openTextDocument } = await openSubsystemDocument('file:///etc/passwd');
      expect(openTextDocument).not.toHaveBeenCalled();
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });
  });

  it('disposes the document subscription with the panel', () => {
    const { changeSubscription, dispose } = setup(fixtureText);
    dispose();
    expect(changeSubscription.dispose).toHaveBeenCalled();
  });

  describe('highlight persistence in workspaceState', () => {
    const storageKey = 'ipcraft.systemDiagram.highlights:file:///ws/zynq.tcl';

    it('restores valid highlights on ready and prunes vanished entries from workspaceState', async () => {
      const { posted, send, workspaceState, workspaceStateStore } = setup(fixtureText);
      workspaceStateStore.set(storageKey, {
        'instance:/axi_dma_0': 'red',
        'net:/::axi_dma_0_M_AXIS_MM2S': 'cyan',
        'instance:/vanished_ip': 'yellow',
      });

      await send({ type: 'ready' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(posted[0]).toMatchObject({
        type: 'graph',
        highlights: {
          'instance:/axi_dma_0': 'red',
          'net:/::axi_dma_0_M_AXIS_MM2S': 'cyan',
        },
      });
      expect(workspaceState.update).toHaveBeenCalledWith(storageKey, {
        'instance:/axi_dma_0': 'red',
        'net:/::axi_dma_0_M_AXIS_MM2S': 'cyan',
      });
    });

    it('saves pruned highlights on setHighlights and removes the key when cleared', async () => {
      const { send, workspaceState, workspaceStateStore } = setup(fixtureText);
      await send({ type: 'ready' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      await send({
        type: 'setHighlights',
        highlights: {
          'instance:/axi_dma_0': 'green',
          'instance:/ghost': 'red',
        },
      });
      expect(workspaceStateStore.get(storageKey)).toEqual({
        'instance:/axi_dma_0': 'green',
      });

      await send({ type: 'setHighlights', highlights: {} });
      expect(workspaceState.update).toHaveBeenLastCalledWith(storageKey, undefined);
      expect(workspaceStateStore.has(storageKey)).toBe(false);
    });
  });
});

describe('SystemDiagramProvider export image', () => {
  const stored = { ...DEFAULT_EXPORT_OPTIONS, format: 'svg', theme: 'dark' };

  it('sends the options of the last export before the graph', async () => {
    const { posted, send, workspaceStateStore } = setup(fixtureText);
    workspaceStateStore.set('ipcraft.exportImage.systemDiagram', stored);
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.map((message) => (message as { type: string }).type)).toEqual([
      'exportOptions',
      'graph',
    ]);
    expect(posted[0]).toEqual({ type: 'exportOptions', options: stored });
  });

  it('renders the graph the viewer has for an exportImage message', async () => {
    const { send } = setup(fixtureText);
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined);
    await send({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await send({
      type: 'exportImage',
      options: { ...stored, area: 'whole' },
      view: { levelPath: '/', expanded: [], clocks: false, selectedNodeIds: [] },
    });
    expect(renderSystemLevelImage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'zynq_dma_system' }),
      expect.objectContaining({ level: '/' }),
      expect.objectContaining({ theme: 'dark' }),
      expect.objectContaining({ format: 'svg' }),
      expect.anything(),
      expect.anything()
    );
  });

  describe('comparison', () => {
    const oldUri = { fsPath: '/ws/old.tcl', toString: () => 'file:///ws/old.tcl' };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const pick = pickCompareBase as jest.Mock;
    const editedText = (text: string) => text.split('axi_dma:7.1').join('axi_dma:7.2');
    type Posted = {
      type: string;
      compare?: { baseLabel: string; diff: { summary: unknown }; findings: unknown };
    };

    async function ready() {
      const context = setup(fixtureText);
      await context.send({ type: 'ready' });
      await flush();
      context.posted.length = 0;
      return context;
    }

    it('publishes the graph again with the changes when a picked revision is read', async () => {
      const { posted, send } = await ready();
      pick.mockResolvedValue({ text: editedText(fixtureText), label: 'HEAD' });
      await send({ type: 'startCompare' });
      expect(posted).toHaveLength(1);
      const message = posted[0] as Posted;
      expect(message.type).toBe('graph');
      expect(message.compare?.baseLabel).toBe('HEAD');
      expect(message.compare?.diff.summary).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        renamed: 0,
        version: 1,
      });
      // The findings of the two revisions travel with the changes.
      expect(message.compare?.findings).toEqual({ new: [], resolved: [] });
    });

    it('updates the changes when the document is edited', async () => {
      const { posted, send, change, document } = await ready();
      pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
      await send({ type: 'startCompare' });
      expect((posted[0] as Posted).compare?.diff.summary).toMatchObject({ version: 0 });
      document.text = editedText(fixtureText);
      change();
      await flush();
      expect(posted).toHaveLength(2);
      expect((posted[1] as Posted).compare).toMatchObject({
        baseLabel: 'HEAD',
        diff: { summary: { version: 1 } },
      });
    });

    it('publishes without the changes after stopCompare', async () => {
      const { posted, send } = await ready();
      pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
      await send({ type: 'startCompare' });
      await send({ type: 'stopCompare' });
      expect(posted).toHaveLength(2);
      expect(posted[1]).not.toHaveProperty('compare');
      expect(posted[1]).toMatchObject({ type: 'graph' });
    });

    describe('when the document stopped reading as a design', () => {
      const storageKey = 'ipcraft.systemDiagram.highlights:file:///ws/zynq.tcl';
      type Problem = { type: 'notRecognized' | 'error' };

      /** Starts a comparison, then lets `breakIt` make the next read fail; it may return an undo. */
      async function comparingWithProblem(
        breakIt: (document: { text: string }) => (() => void) | void,
        problem: Problem
      ) {
        const context = await ready();
        pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
        await context.send({ type: 'startCompare' });
        context.workspaceStateStore.set(storageKey, {
          'instance:/axi_dma_0': 'red',
          'instance:/vanished_ip': 'yellow',
        });
        context.posted.length = 0;
        const undo = breakIt(context.document);
        context.change();
        await flush();
        undo?.();
        expect(context.posted).toMatchObject([problem]);
        context.posted.length = 0;
        context.workspaceState.update.mockClear();
        return context;
      }

      const expectGraphThenProblem = (posted: unknown[], problem: Problem) => {
        expect(posted).toHaveLength(2);
        expect(posted[0]).toMatchObject({ type: 'graph' });
        expect(posted[0]).not.toHaveProperty('compare');
        expect(posted[1]).toMatchObject(problem);
      };

      it('keeps the problem when the comparison is stopped after the document was not recognized', async () => {
        const { posted, send } = await comparingWithProblem(
          (document) => {
            document.text = 'puts hello\n';
          },
          { type: 'notRecognized' }
        );
        await send({ type: 'stopCompare' });
        expectGraphThenProblem(posted, { type: 'notRecognized' });
      });

      it('keeps the problem when the comparison is stopped after a read threw', async () => {
        const original = jest.requireActual<typeof import('../../../parser/system/BdTclReader')>(
          '../../../parser/system/BdTclReader'
        );
        const { posted, send } = await comparingWithProblem(
          () => {
            const spy = jest.spyOn(original, 'readBdTcl').mockImplementation(() => {
              throw new Error('bad script');
            });
            return () => spy.mockRestore();
          },
          { type: 'error' }
        );
        await send({ type: 'stopCompare' });
        expectGraphThenProblem(posted, { type: 'error' });
        expect(posted[1]).toEqual({ type: 'error', message: 'bad script' });
      });

      it('keeps the problem when another comparison is started', async () => {
        const { posted, send } = await comparingWithProblem(
          (document) => {
            document.text = 'puts hello\n';
          },
          { type: 'notRecognized' }
        );
        pick.mockResolvedValue({ text: editedText(fixtureText), label: 'B' });
        await send({ type: 'startCompare' });
        expect(posted).toHaveLength(2);
        expect((posted[0] as Posted).compare?.baseLabel).toBe('B');
        expect(posted[1]).toMatchObject({ type: 'notRecognized' });
      });

      it('posts the problem again when it arrives while the comparison waits for its base', async () => {
        const { posted, send, change, document } = await ready();
        pick.mockResolvedValue({ text: fixtureText, label: 'A' });
        await send({ type: 'startCompare' });
        posted.length = 0;
        let release: () => void = () => undefined;
        // The base of the next comparison is enriched only when released.
        mockEnrich.mockImplementationOnce(
          (graph: unknown) => new Promise((resolve) => (release = () => resolve(graph)))
        );
        pick.mockResolvedValue({ text: editedText(fixtureText), label: 'B' });
        const started = send({ type: 'startCompare' });
        await flush();
        document.text = 'puts hello\n';
        change();
        await flush();
        expect(posted).toMatchObject([{ type: 'notRecognized' }]);
        release();
        await started;
        expect(posted).toHaveLength(3);
        expect((posted[1] as Posted).compare?.baseLabel).toBe('B');
        expect(posted[2]).toMatchObject({ type: 'notRecognized' });
      });

      it('does not prune the stored highlights against the outdated graph', async () => {
        const { send, workspaceState, workspaceStateStore } = await comparingWithProblem(
          (document) => {
            document.text = 'puts hello\n';
          },
          { type: 'notRecognized' }
        );
        await send({ type: 'stopCompare' });
        expect(workspaceState.update).not.toHaveBeenCalled();
        expect(workspaceStateStore.get(storageKey)).toEqual({
          'instance:/axi_dma_0': 'red',
          'instance:/vanished_ip': 'yellow',
        });
      });
    });

    it('shows the error and keeps the running comparison when a read fails', async () => {
      const { posted, send, change } = await ready();
      pick.mockResolvedValueOnce({ text: fixtureText, label: 'HEAD' });
      await send({ type: 'startCompare' });
      posted.length = 0;
      pick.mockRejectedValueOnce(new Error("Cannot read zynq.tcl at 'nope': bad object"));
      await send({ type: 'startCompare' });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Compare failed: Cannot read zynq.tcl at 'nope': bad object"
      );
      expect(posted).toEqual([]);
      pick.mockResolvedValueOnce({ text: 'puts hi', label: 'main' });
      await send({ type: 'startCompare' });
      expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
        "Compare failed: 'main' is not a recognized system design"
      );
      change();
      await flush();
      expect((posted[0] as Posted).compare?.baseLabel).toBe('HEAD');
    });

    it('posts nothing when the picker is cancelled', async () => {
      const { posted, send } = await ready();
      pick.mockResolvedValue(undefined);
      await send({ type: 'startCompare' });
      expect(posted).toEqual([]);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    describe('with workspace definitions', () => {
      type Graph = { instances: Record<string, { pins: object[] }> };
      /** What an enricher with a definition for the DMA does: it adds a pin the file does not list. */
      const withDefinition = (graph: unknown): Graph => {
        const copy = JSON.parse(JSON.stringify(graph)) as Graph;
        copy.instances['/axi_dma_0'].pins.push({
          name: 'M_ST',
          isInterface: false,
          direction: 'out',
          directionSource: 'declared',
          parameters: {},
        });
        return copy;
      };
      const noChanges = (message: unknown) =>
        expect((message as Posted).compare?.diff).toMatchObject({
          instances: [],
          ports: [],
          segments: [],
        });

      it('shows no phantom pin once trust is granted and both sides get the definition', async () => {
        const { posted, send, grantTrust } = await ready();
        pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
        await send({ type: 'startCompare' });
        posted.length = 0;
        mockEnrich.mockImplementation((graph: unknown) => Promise.resolve(withDefinition(graph)));
        grantTrust();
        await flush();
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ graph: { instances: { '/axi_dma_0': {} } } });
        noChanges(posted[0]);
      });

      it('compares read against read while enriching, then enriched against enriched', async () => {
        const { posted, send, change } = await ready();
        pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
        await send({ type: 'startCompare' });
        posted.length = 0;
        let calls = 0;
        let release: () => void = () => undefined;
        mockEnrich.mockImplementation((graph: unknown) => {
          calls += 1;
          return calls === 1
            ? new Promise((resolve) => (release = () => resolve(withDefinition(graph))))
            : Promise.resolve(withDefinition(graph));
        });
        // A definition changed, so the base is enriched anew too.
        mockEnrichRevision += 1;
        change();
        await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_GRACE_MS + 50));
        expect(posted).toHaveLength(1);
        expect(calls).toBe(1);
        noChanges(posted[0]);
        release();
        await flush();
        expect(posted).toHaveLength(2);
        expect(calls).toBe(2);
        noChanges(posted[1]);
        expect(posted[1]).toMatchObject({ graph: { instances: { '/axi_dma_0': {} } } });
      });

      it('enriches the current side again when the document is edited, the base only once', async () => {
        const { posted, send, change, document } = await ready();
        pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
        await send({ type: 'startCompare' });
        posted.length = 0;
        mockEnrich.mockClear();
        document.text = editedText(fixtureText);
        change();
        await flush();
        expect(mockEnrich).toHaveBeenCalledTimes(1);
        expect((posted[0] as Posted).compare?.diff.summary).toMatchObject({ version: 1 });
      });

      it('enriches both sides again when a definition changed and the document is edited', async () => {
        const { posted, send, change, document } = await ready();
        pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
        await send({ type: 'startCompare' });
        posted.length = 0;
        mockEnrich.mockClear();
        mockEnrichRevision += 1;
        document.text = editedText(fixtureText);
        change();
        await flush();
        expect(mockEnrich).toHaveBeenCalledTimes(2);
        expect((posted[0] as Posted).compare?.diff.summary).toMatchObject({ version: 1 });
      });
    });

    it('keeps the comparison when the base is replaced while a publish waits for the old base', async () => {
      const { posted, send, change, document } = await ready();
      pick.mockResolvedValueOnce({ text: fixtureText, label: 'A' });
      await send({ type: 'startCompare' });
      posted.length = 0;
      let calls = 0;
      let release: () => void = () => undefined;
      mockEnrich.mockImplementation((graph: unknown) => {
        calls += 1;
        // The 1st call is the current side, the 2nd the base of the edit's publish.
        return calls === 2
          ? new Promise((resolve) => (release = () => resolve(graph)))
          : Promise.resolve(graph);
      });
      // A definition changed, so the edit's publish enriches the base anew.
      mockEnrichRevision += 1;
      document.text = editedText(fixtureText);
      change();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(2);
      pick.mockResolvedValueOnce({ text: editedText(fixtureText), label: 'B' });
      await send({ type: 'startCompare' });
      release();
      await flush();
      await flush();
      const last = posted.at(-1) as Posted;
      expect(last.type).toBe('graph');
      expect(last.compare?.baseLabel).toBe('B');
      expect(last.compare?.diff.summary).toMatchObject({ version: 0 });
    });

    it('compares as read when the current enrichment fails and the base would succeed', async () => {
      const { posted, send, grantTrust } = await ready();
      pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
      await send({ type: 'startCompare' });
      posted.length = 0;
      let calls = 0;
      mockEnrich.mockImplementation((graph: unknown) => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(graph);
      });
      grantTrust();
      await flush();
      expect(calls).toBe(1);
      expect(posted).toHaveLength(1);
      expect((posted[0] as Posted).compare?.diff).toMatchObject({ instances: [] });
    });

    it('publishes nothing when the panel is disposed while the picker is open', async () => {
      const { posted, send, dispose } = await ready();
      let choose: (base: unknown) => void = () => undefined;
      pick.mockReturnValue(new Promise((resolve) => (choose = resolve)));
      const started = send({ type: 'startCompare' });
      dispose();
      choose({ text: fixtureText, label: 'HEAD' });
      await started;
      await flush();
      expect(posted).toEqual([]);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('starts the comparison of the active panel for the command', async () => {
      const { provider, posted } = await ready();
      pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
      expect(provider.compareActive()).toBe(true);
      await flush();
      expect((posted[0] as Posted).compare?.baseLabel).toBe('HEAD');
    });

    it('has no active panel when the panel is hidden or disposed', async () => {
      const { provider, webviewPanel, dispose } = await ready();
      (webviewPanel as { active: boolean }).active = false;
      expect(provider.compareActive()).toBe(false);
      (webviewPanel as { active: boolean }).active = true;
      expect(provider.compareActive()).toBe(true);
      await flush();
      dispose();
      expect(provider.compareActive()).toBe(false);
    });

    it('reads a picked file in its own format, and a revision in the format of the document', async () => {
      const bd = fs.readFileSync(
        path.resolve(__dirname, '../../fixtures/system-design/diff/zynq_gpio_base.bd'),
        'utf8'
      );
      const { posted, send } = await ready();
      pick.mockResolvedValue({ text: bd, label: 'other.bd', file: { fsPath: '/ws/other.bd' } });
      await send({ type: 'startCompare' });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ compare: { baseLabel: 'other.bd' } });
      expect(
        (posted[0] as { compare: { diff: { formatsDiffer: boolean } } }).compare.diff.formatsDiffer
      ).toBe(true);
      pick.mockResolvedValue({ text: bd, label: 'main' });
      await send({ type: 'startCompare' });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Compare failed: 'main' is not a recognized system design"
      );
    });

    it('names the open document as the current side and tells whether the base can be swapped', async () => {
      const { posted, send } = await ready();
      pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
      await send({ type: 'startCompare' });
      expect((posted[0] as Posted).compare).toMatchObject({
        baseLabel: 'HEAD',
        currentLabel: 'zynq.tcl',
        canSwap: false,
      });
      pick.mockResolvedValue({ text: fixtureText, label: 'old.tcl', file: oldUri });
      await send({ type: 'startCompare' });
      expect((posted[1] as Posted).compare).toMatchObject({
        baseLabel: 'old.tcl',
        currentLabel: 'zynq.tcl',
        canSwap: true,
      });
      await send({ type: 'stopCompare' });
      expect(posted[2]).not.toHaveProperty('compare');
    });

    describe('swapCompare', () => {
      type Compared = {
        type: string;
        compare?: { baseLabel: string; currentLabel: string; canSwap: boolean; diff: never };
      };
      const versionOf = (message: unknown, side: 'base' | 'current') => {
        const diff = (message as Compared).compare!.diff;
        const row = changeRows(diff, { ignoreVersionOnly: false }).find((r) => r.sign === 'v');
        return cellText(row![side]);
      };
      const executeCommand = vscode.commands.executeCommand as jest.Mock;
      const showError = vscode.window.showErrorMessage as jest.Mock;
      const OPEN_WITH = ['vscode.openWith', oldUri, 'ipcraft.systemDiagram'];

      /** Opens another panel of the same provider, as the custom editor does for a file. */
      function openPanel(
        provider: SystemDiagramProvider,
        text: string,
        fsPath: string,
        visible = true
      ) {
        const posted: unknown[] = [];
        let handler: WebviewHandler | undefined;
        let dispose: () => void = () => undefined;
        const document = {
          uri: { fsPath, toString: () => `file://${fsPath}` },
          fileName: fsPath,
          getText: () => text,
        } as unknown as vscode.TextDocument;
        const panel = {
          active: false,
          visible,
          viewColumn: 2,
          reveal: jest.fn(),
          webview: {
            options: {},
            html: '',
            postMessage: jest.fn((message: unknown) => {
              posted.push(message);
              return Promise.resolve(true);
            }),
            onDidReceiveMessage: jest.fn((h: WebviewHandler) => {
              handler = h;
              return { dispose: jest.fn() };
            }),
          },
          onDidDispose: jest.fn((h: () => void) => {
            dispose = h;
            return { dispose: jest.fn() };
          }),
        } as unknown as vscode.WebviewPanel;
        provider.resolveCustomTextEditor(document, panel, {} as vscode.CancellationToken);
        return {
          posted,
          panel,
          dispose: () => dispose(),
          send: (message: unknown) => handler!(message),
        };
      }
      const baseText = () => editedText(fixtureText);
      type Opened = ReturnType<typeof openPanel>;

      /** The first document compares with the second file. */
      async function comparing(base: Record<string, unknown> = { file: oldUri }) {
        const context = await ready();
        (vscode.workspace.asRelativePath as jest.Mock).mockImplementation(
          (file: { fsPath: string }) => file.fsPath.replace('/ws/', '')
        );
        pick.mockResolvedValue({ text: baseText(), label: 'old.tcl', ...base });
        await context.send({ type: 'startCompare' });
        context.posted.length = 0;
        return context;
      }

      /** openWith creates the panel of the base file, as VS Code does before the command resolves. */
      function openWithCreatesPanel(provider: SystemDiagramProvider): { opened?: Opened } {
        const result: { opened?: Opened } = {};
        executeCommand.mockImplementation(() => {
          result.opened = openPanel(provider, baseText(), '/ws/old.tcl');
          return Promise.resolve();
        });
        return result;
      }

      it('opens the base as a diagram and compares it with the first document once it is ready', async () => {
        const { provider, send, posted } = await comparing();
        const created = openWithCreatesPanel(provider);
        await send({ type: 'swapCompare' });
        expect(executeCommand).toHaveBeenCalledWith(...OPEN_WITH);
        expect(posted).toEqual([]);

        const second = created.opened!;
        await second.send({ type: 'ready' });
        await flush();
        const message = second.posted.at(-1) as Compared;
        expect(message.compare).toMatchObject({
          baseLabel: 'zynq.tcl',
          currentLabel: 'old.tcl',
          canSwap: true,
        });
        // The first document has 7.1 and the base 7.2: from the second panel it is the other way round.
        expect(versionOf(message, 'base')).toContain('7.1');
        expect(versionOf(message, 'current')).toContain('7.2');
        expect(posted).toEqual([]);
      });

      it('reveals the open diagram of the base instead of opening another, and compares there', async () => {
        const { provider, send } = await comparing();
        const second = openPanel(provider, baseText(), '/ws/old.tcl');
        await second.send({ type: 'ready' });
        await flush();
        second.posted.length = 0;
        await send({ type: 'swapCompare' });
        await flush();
        expect(executeCommand).not.toHaveBeenCalled();
        expect(second.panel.reveal).toHaveBeenCalledWith(2);
        expect((second.posted.at(-1) as Compared).compare).toMatchObject({
          baseLabel: 'zynq.tcl',
          canSwap: true,
        });
      });

      it('prefers the visible panel when several show the base', async () => {
        const { provider, send } = await comparing();
        const hidden = openPanel(provider, baseText(), '/ws/old.tcl', false);
        const shown = openPanel(provider, baseText(), '/ws/old.tcl', true);
        for (const panel of [hidden, shown]) {
          await panel.send({ type: 'ready' });
        }
        await flush();
        hidden.posted.length = 0;
        shown.posted.length = 0;
        await send({ type: 'swapCompare' });
        await flush();
        expect(shown.panel.reveal).toHaveBeenCalled();
        expect(hidden.panel.reveal).not.toHaveBeenCalled();
        expect(shown.posted.at(-1)).toHaveProperty('compare');
        expect(hidden.posted).toEqual([]);
      });

      it('replaces a comparison that runs on the diagram of the base', async () => {
        const { provider, send } = await comparing();
        const second = openPanel(provider, baseText(), '/ws/old.tcl');
        await second.send({ type: 'ready' });
        await flush();
        pick.mockResolvedValue({ text: fixtureText, label: 'HEAD' });
        await second.send({ type: 'startCompare' });
        expect((second.posted.at(-1) as Compared).compare?.baseLabel).toBe('HEAD');
        await send({ type: 'swapCompare' });
        await flush();
        expect((second.posted.at(-1) as Compared).compare?.baseLabel).toBe('zynq.tcl');
      });

      it('does nothing for a revision as the base, or without a comparison', async () => {
        const { send } = await comparing({ file: undefined, label: 'HEAD' });
        await send({ type: 'swapCompare' });
        await send({ type: 'stopCompare' });
        await send({ type: 'swapCompare' });
        expect(executeCommand).not.toHaveBeenCalled();
      });

      it('drops the request and reports the failure when the base cannot be opened', async () => {
        const { provider, send } = await comparing();
        executeCommand.mockRejectedValue(new Error('no such file'));
        await send({ type: 'swapCompare' });
        expect(showError).toHaveBeenCalledWith('Cannot open old.tcl: no such file');
        const second = openPanel(provider, baseText(), '/ws/old.tcl');
        await second.send({ type: 'ready' });
        await flush();
        expect(second.posted.at(-1)).not.toHaveProperty('compare');
      });

      it('drops the request when the requesting panel is disposed before the base opens', async () => {
        const { provider, send, dispose } = await comparing();
        let opened: () => void = () => undefined;
        executeCommand.mockReturnValue(new Promise<void>((resolve) => (opened = resolve)));
        const swapping = send({ type: 'swapCompare' });
        dispose();
        opened();
        await swapping;
        const second = openPanel(provider, baseText(), '/ws/old.tcl');
        await second.send({ type: 'ready' });
        await flush();
        expect(second.posted.at(-1)).not.toHaveProperty('compare');
      });

      it('keeps a newer base when one is chosen before the panel that waited for a swap is ready', async () => {
        const { provider, send } = await comparing();
        const created = openWithCreatesPanel(provider);
        await send({ type: 'swapCompare' });
        const second = created.opened!;
        pick.mockResolvedValue({ text: baseText(), label: 'HEAD' });
        await second.send({ type: 'startCompare' });
        await second.send({ type: 'ready' });
        await flush();
        expect((second.posted.at(-1) as Compared).compare).toMatchObject({
          baseLabel: 'HEAD',
          canSwap: false,
        });
      });

      it('does not start a stale comparison on a later panel when the target closed before it was ready', async () => {
        const { provider, send } = await comparing();
        const created = openWithCreatesPanel(provider);
        await send({ type: 'swapCompare' });
        created.opened!.dispose();
        const later = openPanel(provider, baseText(), '/ws/old.tcl');
        await later.send({ type: 'ready' });
        await flush();
        expect(later.posted.at(-1)).not.toHaveProperty('compare');
      });

      describe('when openWith resolved before the panel registered', () => {
        afterEach(() => jest.useRealTimers());

        /** Swaps with fake timers; the target panel does not exist when openWith resolves. */
        async function swappedWithoutPanel() {
          const context = await comparing();
          jest.useFakeTimers();
          executeCommand.mockResolvedValue(undefined);
          await context.send({ type: 'swapCompare' });
          return context;
        }
        const readyPanel = async (provider: SystemDiagramProvider) => {
          const panel = openPanel(provider, baseText(), '/ws/old.tcl');
          await panel.send({ type: 'ready' });
          await jest.advanceTimersByTimeAsync(ENRICHMENT_GRACE_MS + 1);
          return panel;
        };

        it('starts the comparison on a panel that registers within the grace period', async () => {
          const { provider } = await swappedWithoutPanel();
          await jest.advanceTimersByTimeAsync(SWAP_GRACE_MS - 1);
          const later = await readyPanel(provider);
          expect((later.posted.at(-1) as Compared).compare?.baseLabel).toBe('zynq.tcl');
          expect(jest.getTimerCount()).toBe(0);
        });

        it('starts a panel that registers after the grace period without a comparison', async () => {
          const { provider } = await swappedWithoutPanel();
          await jest.advanceTimersByTimeAsync(SWAP_GRACE_MS);
          const later = await readyPanel(provider);
          expect(later.posted.at(-1)).not.toHaveProperty('compare');
        });

        it('cancels the request and clears the timer when the requesting panel is disposed', async () => {
          const { provider, dispose } = await swappedWithoutPanel();
          expect(jest.getTimerCount()).toBe(1);
          dispose();
          expect(jest.getTimerCount()).toBe(0);
          const later = await readyPanel(provider);
          expect(later.posted.at(-1)).not.toHaveProperty('compare');
        });
      });
    });
  });
});
