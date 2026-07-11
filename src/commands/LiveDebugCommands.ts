import * as vscode from 'vscode';
import { parseMemoryMap } from '../domain/parse';
import { LiveRegisterSession } from '../services/LiveRegisterSession';
import { SystemConsoleTransport } from '../services/transport/SystemConsoleTransport';
import { RegisterTransportError } from '../services/transport/RegisterTransport';
import { getRegisterDebugOutputChannel } from '../services/transport/registerDebugOutputChannel';
import { isMmFile } from '../utils/fileExtensions';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

const sessions = new Map<string, LiveRegisterSession>();

/** The live register session for `.mm.yml` document `uri`, if a Connect command has established one. */
export function getLiveRegisterSession(uri: vscode.Uri): LiveRegisterSession | undefined {
  return sessions.get(uri.toString());
}

function getActiveMmFile(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && isMmFile(editor.document.fileName)) {
    return editor.document.uri;
  }
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab?.input instanceof vscode.TabInputCustom) {
    const { uri } = activeTab.input;
    if (isMmFile(uri.fsPath)) {
      return uri;
    }
  }
  return undefined;
}

export function registerLiveDebugCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'fpga-ip-core.connectLiveRegistersSystemConsole',
      () => void connectSystemConsole()
    ),
    vscode.commands.registerCommand('fpga-ip-core.disconnectLiveRegisters', () =>
      disconnectActive()
    ),
    vscode.commands.registerCommand('fpga-ip-core.showRegisterDebugOutput', () =>
      getRegisterDebugOutputChannel().show()
    )
  );
}

async function connectSystemConsole(): Promise<void> {
  const uri = getActiveMmFile();
  if (!uri) {
    void vscode.window.showErrorMessage(
      'Connect Live Registers: no active Memory Map (.mm.yml) file.'
    );
    return;
  }

  const key = uri.toString();
  sessions.get(key)?.dispose();
  sessions.delete(key);

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const { map } = parseMemoryMap(Buffer.from(raw).toString('utf8'));

    const transport = new SystemConsoleTransport({
      outputChannel: getRegisterDebugOutputChannel(),
    });
    const session = new LiveRegisterSession(transport, [map]);
    await session.connect();

    sessions.set(key, session);
    void vscode.window.showInformationMessage(
      `Connected to System Console — ${session.registerNames().length} register(s) available.`
    );
  } catch (err) {
    if (err instanceof RegisterTransportError) {
      void vscode.window.showErrorMessage(
        `Connect Live Registers failed (${err.category}): ${err.message}`
      );
      getRegisterDebugOutputChannel().appendLine(`[${err.category}] ${err.message}`);
      return;
    }
    void handleErrorWithUserNotification(
      err,
      'connectSystemConsole',
      'Connect Live Registers failed'
    );
  }
}

function disconnectActive(): void {
  const uri = getActiveMmFile();
  if (!uri) {
    void vscode.window.showErrorMessage('Disconnect Live Registers: no active Memory Map file.');
    return;
  }
  const key = uri.toString();
  const session = sessions.get(key);
  if (!session) {
    void vscode.window.showInformationMessage('No live register session for this file.');
    return;
  }
  session.dispose();
  sessions.delete(key);
  void vscode.window.showInformationMessage('Live register session disconnected.');
}
