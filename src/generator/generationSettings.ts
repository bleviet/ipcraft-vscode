import type * as vscode from 'vscode';
import type { IndentationDefaults } from './reindent';
import { DEFAULT_INDENT_SIZE, DEFAULT_INDENT_STYLE } from './reindent';

export function readGenerationIndentation(
  configuration: vscode.WorkspaceConfiguration
): Required<IndentationDefaults> {
  return {
    style: configuration.get('indentStyle', DEFAULT_INDENT_STYLE),
    size: configuration.get('indentSize', DEFAULT_INDENT_SIZE),
  };
}
