/**
 * Mock VS Code API for testing
 */

// Create persistent mock output channel
const mockOutputChannel = {
  appendLine: jest.fn(),
  show: jest.fn(),
  dispose: jest.fn(),
};

export const window = {
  createOutputChannel: jest.fn(() => mockOutputChannel),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInformationMessage: jest.fn(),
};

export const workspace = {
  onDidChangeTextDocument: jest.fn(),
  applyEdit: jest.fn(),
  asRelativePath: jest.fn((path) => path.toString()),
  getConfiguration: jest.fn(() => ({
    get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
  })),
  fs: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const commands = {
  executeCommand: jest.fn(),
};

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path, toString: () => path })),
  from: jest.fn((parts: { scheme?: string; path?: string }) => ({
    scheme: parts.scheme,
    path: parts.path,
    toString: () => `${parts.scheme ?? ''}:${parts.path ?? ''}`,
  })),
  joinPath: jest.fn((...paths: unknown[]) => ({
    fsPath: paths.join('/'),
    toString: () => paths.join('/'),
  })),
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
  replace = jest.fn();
}

/**
 * Minimal EventEmitter stub for tests of services that expose VS Code events
 * (e.g. WorkspaceBusDefinitionScanner.onDidScan). Real VS Code's EventEmitter
 * stores a listener list and fires on demand — this stub does the same.
 */
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
  private disposeFn: () => void;
  constructor(disposeFn: () => void) {
    this.disposeFn = disposeFn;
  }
  dispose(): void {
    this.disposeFn();
  }
}
