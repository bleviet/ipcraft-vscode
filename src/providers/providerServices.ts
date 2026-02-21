import * as vscode from 'vscode';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { MessageHandler } from '../services/MessageHandler';
import { YamlValidator } from '../services/YamlValidator';
import { DocumentManager } from '../services/DocumentManager';

export interface SharedProviderServices {
  htmlGenerator: HtmlGenerator;
  messageHandler: MessageHandler;
  documentManager: DocumentManager;
}

export function createSharedProviderServices(
  context: vscode.ExtensionContext
): SharedProviderServices {
  const htmlGenerator = new HtmlGenerator(context);
  const documentManager = new DocumentManager();
  const yamlValidator = new YamlValidator();
  const messageHandler = new MessageHandler(yamlValidator, documentManager);

  return {
    htmlGenerator,
    messageHandler,
    documentManager,
  };
}
