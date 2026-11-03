import * as vscode from 'vscode';
import { SystemDiagramProvider } from '../../../providers/SystemDiagramProvider';
import { fixtureText } from '../webview/systemDiagram/fixtureGraph';

jest.mock('../../../services/HtmlGenerator', () => ({
  HtmlGenerator: class {
    generateSystemDiagramHtml(): string {
      return '<html>system diagram</html>';
    }
  },
}));

type WebviewHandler = (message: unknown) => Promise<void>;
type ChangeHandler = (event: { document: { uri: { toString(): string } } }) => void;

const uri = { toString: () => 'file:///ws/zynq.tcl', fsPath: '/ws/zynq.tcl' };

function setup(text: string, fileName = '/ws/zynq.tcl') {
  const posted: unknown[] = [];
  let webviewHandler: WebviewHandler | undefined;
  let changeHandler: ChangeHandler | undefined;
  let disposeHandler: (() => void) | undefined;
  const changeSubscription = { dispose: jest.fn() };

  (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('zynq.tcl');
  (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockImplementation(
    (handler: ChangeHandler) => {
      changeHandler = handler;
      return changeSubscription;
    }
  );
  (vscode.Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/ext/dist' });

  const document = {
    uri,
    fileName,
    getText: () => text,
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

  new SystemDiagramProvider({
    extensionUri: { fsPath: '/ext' },
  } as unknown as vscode.ExtensionContext).resolveCustomTextEditor(
    document,
    webviewPanel,
    {} as vscode.CancellationToken
  );

  return {
    posted,
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

  it('disposes the document subscription with the panel', () => {
    const { changeSubscription, dispose } = setup(fixtureText);
    dispose();
    expect(changeSubscription.dispose).toHaveBeenCalled();
  });
});
