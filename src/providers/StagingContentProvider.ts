import * as vscode from 'vscode';

export const STAGING_SCHEME = 'ipcraft-staging';

const contentMap = new Map<string, string>();

export function setStagingContent(key: string, content: string): void {
  contentMap.set(key, content);
}

export function clearStagingContent(): void {
  contentMap.clear();
}

export const stagingContentProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return contentMap.get(uri.path) ?? '';
  },
};
