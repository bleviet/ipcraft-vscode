import type * as vscode from 'vscode';
import type { GenerateOptions } from './types';
import { DEFAULT_INDENT_SIZE, DEFAULT_INDENT_STYLE } from './reindent';

export function readGenerationIndentation(
  configuration: vscode.WorkspaceConfiguration
): Required<Pick<GenerateOptions, 'indentStyle' | 'indentSize'>> {
  return {
    indentStyle: configuration.get('indentStyle', DEFAULT_INDENT_STYLE),
    indentSize: configuration.get('indentSize', DEFAULT_INDENT_SIZE),
  };
}
