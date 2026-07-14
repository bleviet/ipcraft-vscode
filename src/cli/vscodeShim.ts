/**
 * Minimal stand-in for the `vscode` module, bundled in place of the real API for the
 * standalone `ipcraft` CLI (issue #72), which runs outside any VS Code host.
 *
 * IpCoreScaffolder / the toolchain scaffolders only touch `vscode.workspace.*` for
 * optional, best-effort features (workspace-configured bus library paths, workspace scaffold
 * packs, workspace-scanned bus definitions) and already wrap every one of those calls in a
 * try/catch with a "test environment" fallback — the exact same code path exercised by
 * `__mocks__/vscode.ts` in the Jest unit tests. This shim mirrors that mock's shape so the
 * CLI takes the same fallback path a unit test does, rather than crashing on a missing API.
 */

import * as fs from 'fs';

const noopOutputChannel = {
  appendLine: (line: string) => console.log(line),
  show: () => {},
  dispose: () => {},
};

export const window = {
  createOutputChannel: () => noopOutputChannel,
  showErrorMessage: (message: string) => console.error(message),
  showWarningMessage: (message: string) => console.warn(message),
  showInformationMessage: (message: string) => console.log(message),
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const workspace = {
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
  applyEdit: async () => true,
  asRelativePath: (p: string) => String(p),
  getConfiguration: () => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  }),
  // Backed by real Node fs (unlike the rest of this shim) — BusLibraryService.loadDefaultLibrary
  // uses vscode.workspace.fs.readDirectory/readFile unconditionally (no test-environment
  // fallback), since loading the built-in bus definitions library isn't optional.
  fs: {
    readDirectory: async (uri: { fsPath: string }): Promise<Array<[string, FileType]>> => {
      const entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
      return entries.map((e) => [e.name, e.isDirectory() ? FileType.Directory : FileType.File]);
    },
    readFile: async (uri: { fsPath: string }): Promise<Uint8Array> => fs.readFileSync(uri.fsPath),
    writeFile: async (uri: { fsPath: string }, content: Uint8Array): Promise<void> => {
      fs.writeFileSync(uri.fsPath, content);
    },
  },
  workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
};

export const commands = {
  executeCommand: async () => undefined,
};

export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => p }),
  from: (parts: { scheme?: string; path?: string }) => ({
    scheme: parts.scheme,
    path: parts.path,
    toString: () => `${parts.scheme ?? ''}:${parts.path ?? ''}`,
  }),
  joinPath: (...paths: unknown[]) => ({
    fsPath: paths.join('/'),
    toString: () => paths.join('/'),
  }),
};

export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

export class WorkspaceEdit {
  replace(): void {}
}

export class EventEmitter<T = unknown> {
  private listeners: Array<(e: T) => void> = [];

  get event(): (listener: (e: T) => void) => { dispose: () => void } {
    return (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter((l) => l !== listener);
        },
      };
    };
  }

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Disposable {
  constructor(private readonly disposeFn: () => void) {}
  dispose(): void {
    this.disposeFn();
  }
}
