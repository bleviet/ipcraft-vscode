import * as vscode from 'vscode';
import { SystemDiagramProvider } from '../../../providers/SystemDiagramProvider';
import { fixtureText, qsysFixtureText } from '../webview/systemDiagram/fixtureGraph';

jest.mock('../../../services/HtmlGenerator', () => ({
  HtmlGenerator: class {
    generateSystemDiagramHtml(): string {
      return '<html>system diagram</html>';
    }
  },
}));

const mockEnrich = jest.fn();

jest.mock('../../../services/systemDiagram/SystemDesignEnricher', () => ({
  SystemDesignEnricher: class {
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

  new SystemDiagramProvider({
    extensionUri: { fsPath: '/ext' },
    subscriptions,
    workspaceState,
  } as unknown as vscode.ExtensionContext).resolveCustomTextEditor(
    document,
    webviewPanel,
    {} as vscode.CancellationToken
  );

  return {
    posted,
    subscriptions,
    workspaceState,
    workspaceStateStore,
    document: documentState,
    trustSubscription,
    grantTrust: () => trustHandler!(),
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
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: 'graph',
      graph: { name: 'zynq_dma_system', source: { fileName: 'zynq.tcl' } },
    });
  });

  it('posts a qsys graph for a Platform Designer document', async () => {
    const { posted, send } = setup(qsysFixtureText, '/ws/nios.qsys', 'nios.qsys');
    await send({ type: 'ready' });
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
