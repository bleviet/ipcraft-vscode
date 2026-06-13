import * as vscode from 'vscode';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { YamlValidator } from '../services/YamlValidator';
import { DocumentManager } from '../services/DocumentManager';

export interface SharedProviderServices {
  htmlGenerator: HtmlGenerator;
  yamlValidator: YamlValidator;
  documentManager: DocumentManager;
}

export function createSharedProviderServices(
  context: vscode.ExtensionContext
): SharedProviderServices {
  const htmlGenerator = new HtmlGenerator(context);
  const documentManager = new DocumentManager();
  const yamlValidator = new YamlValidator();

  return {
    htmlGenerator,
    yamlValidator,
    documentManager,
  };
}
