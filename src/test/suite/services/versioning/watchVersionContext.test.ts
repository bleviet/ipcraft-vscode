import * as vscode from 'vscode';
import { watchVersionContext } from '../../../../services/versioning/watchVersionContext';
import type { VersionContext } from '../../../../shared/versioning/versionContext';

type Listener = (arg?: unknown) => void;

const uri = (fsPath: string): vscode.Uri =>
  ({ fsPath, toString: () => `file://${fsPath}` }) as unknown as vscode.Uri;

const ipCoreText = (version: string, scheme = 'major.minor', importPath = './uart.mm.yml') =>
  `vlnv: { vendor: a, library: b, name: c, version: '${version}', versionScheme: ${scheme} }\nmemoryMaps:\n  import: ${importPath}\n`;

describe('watchVersionContext', () => {
  const mmDocument = { uri: uri('/ws/ip/uart.mm.yml') } as unknown as vscode.TextDocument;
  const corePath = '/ws/ip/uart.ip.yml';

  let files: Record<string, string>;
  let posted: VersionContext[];
  let listeners: Record<string, Listener>;
  let disposables: Array<{ dispose: jest.Mock }>;
  let watcher: { dispose: jest.Mock };

  const track = (name: string) =>
    jest.fn((listener: Listener) => {
      listeners[name] = listener;
      const disposable = { dispose: jest.fn() };
      disposables.push(disposable);
      return disposable;
    });

  /** Lets the pending async refresh settle (reads are promise based, timers are fake). */
  const settle = async (): Promise<void> => {
    await jest.advanceTimersByTimeAsync(0);
  };
  const advance = async (ms: number): Promise<void> => {
    await jest.advanceTimersByTimeAsync(ms);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    files = { [corePath]: ipCoreText('1.2') };
    posted = [];
    listeners = {};
    disposables = [];
    watcher = { dispose: jest.fn() };

    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    (vscode.workspace.findFiles as jest.Mock).mockImplementation(() =>
      Promise.resolve(Object.keys(files).map(uri))
    );
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation(
      (target: { fsPath: string }) => target.fsPath.replace('/ws/', '')
    );
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation((target: { fsPath: string }) =>
      Promise.resolve(new TextEncoder().encode(files[target.fsPath]))
    );
    (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockImplementation(track('textChange'));
    (vscode.workspace.onDidSaveTextDocument as jest.Mock).mockImplementation(track('textSave'));
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation(() => ({
      onDidCreate: track('fsCreate'),
      onDidChange: track('fsChange'),
      onDidDelete: track('fsDelete'),
      dispose: watcher.dispose,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const start = () => watchVersionContext(mmDocument, (context) => posted.push(context));

  const resolved = (version: string): VersionContext => ({
    status: 'resolved',
    versionScheme: 'major.minor',
    version,
    ipCorePath: 'ip/uart.ip.yml',
  });

  it('sends the initial context right away', async () => {
    start();
    await settle();
    expect(posted).toEqual([resolved('1.2')]);
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith('**/*.ip.yml');
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.ip.yml', '**/node_modules/**');
  });

  it('sends none when no core owns the map', async () => {
    files = { [corePath]: ipCoreText('1.2', 'major.minor', './other.mm.yml') };
    start();
    await settle();
    expect(posted).toEqual([{ status: 'none' }]);
  });

  it('re-sends, debounced, when an owning ip.yml changes on disk', async () => {
    start();
    await settle();

    files[corePath] = ipCoreText('1.3');
    listeners.fsChange();
    listeners.fsChange();
    await advance(150);
    expect(posted).toHaveLength(1);
    await advance(100);
    expect(posted).toEqual([resolved('1.2'), resolved('1.3')]);
  });

  it('reads the open document, so unsaved edits count', async () => {
    start();
    await settle();

    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [
      { uri: uri(corePath), getText: () => ipCoreText('2.0') },
    ];
    listeners.textChange({ document: { uri: uri(corePath) } });
    await advance(250);
    expect(posted).toEqual([resolved('1.2'), resolved('2.0')]);
  });

  it('reacts to save and to file create / delete', async () => {
    start();
    await settle();

    files[corePath] = ipCoreText('1.4');
    listeners.textSave({ uri: uri(corePath) });
    await advance(250);
    expect(posted[posted.length - 1]).toEqual(resolved('1.4'));

    delete files[corePath];
    listeners.fsDelete();
    await advance(250);
    expect(posted[posted.length - 1]).toEqual({ status: 'none' });

    files['/ws/ip/other.ip.yml'] = ipCoreText('1.0');
    files[corePath] = ipCoreText('1.5');
    listeners.fsCreate();
    await advance(250);
    expect(posted).toHaveLength(4);
    expect(posted[3]).toEqual({
      status: 'ambiguous',
      candidates: ['ip/other.ip.yml', 'ip/uart.ip.yml'],
    });
  });

  it('does not re-send an unchanged context', async () => {
    start();
    await settle();

    listeners.fsChange();
    await advance(250);
    files[corePath] = ipCoreText('1.2') + '# comment\n';
    listeners.textSave({ uri: uri(corePath) });
    await advance(250);
    expect(posted).toEqual([resolved('1.2')]);
  });

  it('ignores edits to documents that are not .ip.yml', async () => {
    start();
    await settle();

    files[corePath] = ipCoreText('9.9');
    listeners.textChange({ document: { uri: uri('/ws/ip/uart.mm.yml') } });
    listeners.textSave({ uri: uri('/ws/notes.md') });
    await advance(500);
    expect(posted).toEqual([resolved('1.2')]);
  });

  it('skips unreadable files', async () => {
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation((target: { fsPath: string }) =>
      target.fsPath === corePath
        ? Promise.resolve(new TextEncoder().encode(files[corePath]))
        : Promise.reject(new Error('gone'))
    );
    files['/ws/ip/gone.ip.yml'] = '';
    start();
    await settle();
    expect(posted).toEqual([resolved('1.2')]);
  });

  it('disposes every subscription and the file watcher, and stops posting', async () => {
    const disposable = start();
    await settle();
    expect(disposables).toHaveLength(5);

    files[corePath] = ipCoreText('3.0');
    listeners.fsChange();
    disposable.dispose();
    await advance(500);

    expect(posted).toEqual([resolved('1.2')]);
    for (const subscription of disposables) {
      expect(subscription.dispose).toHaveBeenCalledTimes(1);
    }
    expect(watcher.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not post a result that finishes after disposal', async () => {
    const disposable = start();
    disposable.dispose();
    await settle();
    expect(posted).toEqual([]);
  });
});
