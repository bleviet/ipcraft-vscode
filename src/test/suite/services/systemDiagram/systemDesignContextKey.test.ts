import * as vscode from 'vscode';
import { registerSystemDesignContextKey } from '../../../../services/systemDiagram/systemDesignContextKey';
import { fixtureText } from '../../webview/systemDiagram/fixtureGraph';

type EditorHandler = (editor: unknown) => void;
type DocumentHandler = (event: { document: unknown }) => void;

function editorFor(fileName: string, text: string) {
  return { document: { fileName, getText: () => text } };
}

function setActive(editor: unknown): void {
  (vscode.window as { activeTextEditor: unknown }).activeTextEditor = editor;
}

function lastContextValue(): unknown {
  const calls = (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(
    (call) => call[0] === 'setContext'
  );
  expect(calls.at(-1)?.[1]).toBe('ipcraft.isSystemDesignScript');
  return calls.at(-1)?.[2];
}

describe('registerSystemDesignContextKey', () => {
  let onEditor: EditorHandler;
  let onDocument: DocumentHandler;

  beforeEach(() => {
    (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mockImplementation(
      (handler: EditorHandler) => {
        onEditor = handler;
        return { dispose: jest.fn() };
      }
    );
    (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockImplementation(
      (handler: DocumentHandler) => {
        onDocument = handler;
        return { dispose: jest.fn() };
      }
    );
  });

  afterEach(() => setActive(undefined));

  function register(): vscode.Disposable[] {
    const subscriptions: vscode.Disposable[] = [];
    registerSystemDesignContextKey({ subscriptions } as unknown as vscode.ExtensionContext);
    return subscriptions;
  }

  it('is false at activation without an active editor', () => {
    const subscriptions = register();
    expect(lastContextValue()).toBe(false);
    expect(subscriptions).toHaveLength(2);
  });

  it('is true at activation for a block design script', () => {
    setActive(editorFor('/ws/system.tcl', fixtureText));
    register();
    expect(lastContextValue()).toBe(true);
  });

  it('follows the active editor', () => {
    register();
    onEditor(editorFor('/ws/system.tcl', fixtureText));
    expect(lastContextValue()).toBe(true);
    onEditor(editorFor('/ws/ip_hw.tcl', fixtureText));
    expect(lastContextValue()).toBe(false);
    onEditor(editorFor('/ws/notes.txt', fixtureText));
    expect(lastContextValue()).toBe(false);
    onEditor(editorFor('/ws/build.tcl', 'puts hello'));
    expect(lastContextValue()).toBe(false);
    onEditor(undefined);
    expect(lastContextValue()).toBe(false);
  });

  it('re-evaluates when the active document changes but not others', () => {
    register();
    const active = editorFor('/ws/system.tcl', 'puts hello');
    setActive(active);
    onDocument({ document: active.document });
    expect(lastContextValue()).toBe(false);

    const callsBefore = (vscode.commands.executeCommand as jest.Mock).mock.calls.length;
    onDocument({ document: editorFor('/ws/other.tcl', fixtureText).document });
    expect((vscode.commands.executeCommand as jest.Mock).mock.calls).toHaveLength(callsBefore);

    const edited = editorFor('/ws/system.tcl', fixtureText);
    setActive(edited);
    onDocument({ document: edited.document });
    expect(lastContextValue()).toBe(true);
  });
});
