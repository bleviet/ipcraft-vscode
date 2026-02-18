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
};

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path, toString: () => path })),
  joinPath: jest.fn((...paths: any[]) => ({
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
