import * as path from 'path';
import * as vscode from 'vscode';
import { applyPathEdits } from '../yamledit';
import { parseRecipe, validateRecipeSemantics } from '../dataInspector/recipe';
import type {
  DataInspectorToExtensionMessage,
  DataInspectorToWebviewMessage,
} from '../shared/messages/dataInspector';
import { DataInspectorRegisterLayoutReader } from '../services/DataInspectorRegisterLayoutReader';
import { createSharedProviderServices } from './providerServices';
import { Logger } from '../utils/Logger';
import { saveDataInspectorRecipeAs } from '../commands/DataInspectorCommands';

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
    const disposables: vscode.Disposable[] = [];
    let ready = false;

    const postRecipe = () => {
      if (!ready) {
        return;
      }
      try {
        const recipe = this.validate(document.getText());
        const message: DataInspectorToWebviewMessage = {
          type: 'recipe',
          recipe,
          fileName: this.services.documentManager.getRelativePath(document.uri),
          docVersion: document.version,
        };
        void webviewPanel.webview.postMessage(message);
      } catch (error) {
        const message: DataInspectorToWebviewMessage = {
          type: 'recipeError',
          error: error instanceof Error ? error.message : String(error),
        };
        void webviewPanel.webview.postMessage(message);
      }
    };

    webviewPanel.webview.onDidReceiveMessage(
      (message: DataInspectorToExtensionMessage) => {
        void (async () => {
          if (message.type === 'ready') {
            ready = true;
            postRecipe();
          } else if (message.type === 'requestRegisterLayouts') {
            const response: DataInspectorToWebviewMessage = {
              type: 'registerLayouts',
              layouts: await this.registerLayouts.load(),
            };
            await webviewPanel.webview.postMessage(response);
          } else if (message.type === 'updateRecipe') {
            this.validateRecipe(message.recipe);
            const nextText = applyPathEdits(document.getText(), [
              { path: [], value: message.recipe },
            ]);
            const result = await this.services.documentManager.updateDocument(
              document,
              nextText,
              message.baseDocVersion
            );
            if (result.type === 'rejected') {
              postRecipe();
            }
          } else if (message.type === 'saveRecipe') {
            await saveDataInspectorRecipeAs(message.recipe);
          }
        })().catch((error: unknown) => {
          this.logger.error('Recipe editor message failed', error as Error);
          const response: DataInspectorToWebviewMessage = {
            type: 'recipeError',
            error: error instanceof Error ? error.message : String(error),
          };
          void webviewPanel.webview.postMessage(response);
        });
      },
      undefined,
      disposables
    );

    const documentChanges = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        postRecipe();
      }
    });
    disposables.push(documentChanges);
    webviewPanel.onDidDispose(() => {
      disposables.forEach((disposable) => {
        disposable.dispose();
      });
    });
  }

  private validate(text: string) {
    const recipe = parseRecipe(text);
    this.validateRecipe(recipe);
    return recipe;
  }

  private validateRecipe(recipe: ReturnType<typeof parseRecipe>): void {
    const schemaPath = path.join(
      this.context.extensionPath,
      'dist',
      'resources',
      'schemas',
      'data_inspector.schema.json'
    );
    const schemaResult = this.services.yamlValidator.validateAgainstSchema(recipe, schemaPath);
    if (!schemaResult.valid) {
      throw new Error(schemaResult.error ?? 'Recipe schema validation failed');
    }
    const semanticErrors = validateRecipeSemantics(recipe);
    if (semanticErrors.length > 0) {
      throw new Error(semanticErrors.join('; '));
    }
  }
}
