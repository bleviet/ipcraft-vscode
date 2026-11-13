/** The system designs open in editor tabs: the files the comparison offers as a base. */

import * as path from 'path';
import * as vscode from 'vscode';

function isDesignFile(fsPath: string): boolean {
  const name = path.basename(fsPath).toLowerCase();
  return /\.(bd|qsys)$/.test(name) || (name.endsWith('.tcl') && !name.endsWith('_hw.tcl'));
}

/** The design files (of the document's scheme, so no `git:` or `untitled:` tab next to a file) of all open tabs except `document`, once each, in tab order. */
export function openDesignTabs(document: vscode.TextDocument): vscode.Uri[] {
  const seen = new Set([document.uri.toString()]);
  const found: vscode.Uri[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const { input } of group.tabs) {
      if (!(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)) {
        continue;
      }
      const key = input.uri.toString();
      if (
        input.uri.scheme === document.uri.scheme &&
        isDesignFile(input.uri.fsPath) &&
        !seen.has(key)
      ) {
        seen.add(key);
        found.push(input.uri);
      }
    }
  }
  return found;
}
