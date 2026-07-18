import * as vscode from 'vscode';
import type {
  DataInspectorToExtensionMessage,
  DataInspectorToWebviewMessage,
} from '../shared/messages/dataInspector';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { Logger } from '../utils/Logger';
import { DataInspectorRegisterLayoutReader } from '../services/DataInspectorRegisterLayoutReader';
import type { RegisterLayoutCopy } from '../shared/messages/dataInspector';
import { saveDataInspectorRecipeAs } from '../commands/DataInspectorCommands';

export class DataInspectorPanel {
  private static instance: DataInspectorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly logger = new Logger('DataInspectorPanel');
  private readonly registerLayouts = new DataInspectorRegisterLayoutReader();
  private ready = false;
  private pendingLayout: RegisterLayoutCopy | undefined;

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      'ipcraft.dataInspector',
      'IPCraft: Data Inspector',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons'),
        ],
      }
    );
    this.panel.webview.html = new HtmlGenerator(context).generateDataInspectorHtml(
      this.panel.webview
    );
    this.panel.webview.onDidReceiveMessage(
      (message: DataInspectorToExtensionMessage) => {
        void this.handleMessage(message);
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(
      () => {
        this.disposables.forEach((disposable) => {
          disposable.dispose();
        });
        DataInspectorPanel.instance = undefined;
      },
      undefined,
      this.disposables
    );
  }

  static show(context: vscode.ExtensionContext): DataInspectorPanel {
    if (DataInspectorPanel.instance === undefined) {
      DataInspectorPanel.instance = new DataInspectorPanel(context);
    } else {
      DataInspectorPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    return DataInspectorPanel.instance;
  }

  applyRegisterLayout(layout: RegisterLayoutCopy): void {
    if (!this.ready) {
      this.pendingLayout = layout;
      return;
    }
    const message: DataInspectorToWebviewMessage = { type: 'applyRegisterLayout', layout };
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: DataInspectorToExtensionMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      if (this.pendingLayout) {
        const layout = this.pendingLayout;
        this.pendingLayout = undefined;
        this.applyRegisterLayout(layout);
      }
      return;
    }
    if (message.type === 'saveRecipe') {
      await saveDataInspectorRecipeAs(message.recipe);
      return;
    }
    if (message.type !== 'requestRegisterLayouts') {
      return;
    }
    try {
      const response: DataInspectorToWebviewMessage = {
        type: 'registerLayouts',
        layouts: await this.registerLayouts.load(),
      };
      await this.panel.webview.postMessage(response);
    } catch (error) {
      this.logger.error('Failed to read register layouts', error as Error);
    }
  }
}
