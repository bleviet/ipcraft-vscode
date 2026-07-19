import * as vscode from 'vscode';
import { applyPathEdits } from '../yamledit';
import { parseRecipe } from '../dataInspector/recipe';
import { validateDataInspectorRecipe } from '../dataInspector/validateRecipe';
import type {
  DataInspectorToExtensionMessage,
  DataInspectorToWebviewMessage,
} from '../shared/messages/dataInspector';
import { DataInspectorRegisterLayoutReader } from '../services/DataInspectorRegisterLayoutReader';
import { createSharedProviderServices } from './providerServices';
import { Logger } from '../utils/Logger';
import { saveDataInspectorRecipeAs } from '../commands/DataInspectorCommands';
import { WebviewRouter } from '../services/WebviewRouter';

export class DataInspectorRecipeEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('DataInspectorRecipeEditorProvider');
  private readonly services;
  private readonly registerLayouts = new DataInspectorRegisterLayoutReader();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.services = createSharedProviderServices(context);
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.services.htmlGenerator.generateDataInspectorHtml(
      webviewPanel.webview
    );

    const postError = (error: unknown) => {
      const message: DataInspectorToWebviewMessage = {
        type: 'recipeError',
        error: error instanceof Error ? error.message : String(error),
      };
      void webviewPanel.webview.postMessage(message);
    };

    const postRecipe = (sourceEditId?: number, forceResync = false) => {
      try {
        const recipe = this.validate(document.getText());
        const message: DataInspectorToWebviewMessage = {
          type: 'recipe',
          recipe,
          fileName: this.services.documentManager.getRelativePath(document.uri),
          docVersion: document.version,
          sourceEditId,
          forceResync,
        };
        void webviewPanel.webview.postMessage(message);
      } catch (error) {
        postError(error);
      }
    };

    const router = new WebviewRouter<DataInspectorToExtensionMessage>({
      webviewPanel,
      document,
      logger: this.logger,
      onReady: () => postRecipe(),
    });

    router
      .on('requestRegisterLayouts', async () => {
        try {
          const response: DataInspectorToWebviewMessage = {
            type: 'registerLayouts',
            layouts: await this.registerLayouts.load(),
          };
          await webviewPanel.webview.postMessage(response);
        } catch (error) {
          postError(error);
        }
      })
      .on('updateRecipe', async (message) => {
        try {
          this.validateRecipe(message.recipe);
          const nextText = applyPathEdits(document.getText(), [
            { path: [], value: message.recipe },
          ]);
          router.trackSourceEditId(message.editId);
          const result = await this.services.documentManager.updateDocument(
            document,
            nextText,
            message.baseDocVersion
          );
          if (result.type === 'noop') {
            router.forgetSourceEditId(message.editId);
          } else if (result.type === 'rejected') {
            router.forgetSourceEditId(message.editId);
            if (result.reason === 'stale-base') {
              void vscode.window.showWarningMessage(
                `File "${this.services.documentManager.getRelativePath(document.uri)}" has changed on disk. Visual editor has been reloaded.`
              );
            }
            postRecipe(undefined, result.reason === 'stale-base');
          }
        } catch (error) {
          router.forgetSourceEditId(message.editId);
          postError(error);
        }
      })
      .on('saveRecipe', async (message) => {
        try {
          await saveDataInspectorRecipeAs(message.recipe, this.context.extensionPath);
        } catch (error) {
          postError(error);
        }
      });

    const documentChanges = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        postRecipe(router.popSourceEditId());
      }
    });
    webviewPanel.onDidDispose(() => {
      documentChanges.dispose();
      router.dispose();
    });
  }

  private validate(text: string) {
    const recipe = parseRecipe(text);
    this.validateRecipe(recipe);
    return recipe;
  }

  private validateRecipe(recipe: ReturnType<typeof parseRecipe>): void {
    validateDataInspectorRecipe(recipe, this.context.extensionPath, this.services.yamlValidator);
  }
}
