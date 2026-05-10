/**
 * Integration-test setup.
 *
 * Extends the standard __mocks__/vscode.ts with a real-filesystem implementation
 * of workspace.fs so that BusLibraryService can read actual bus-definition YAMLs
 * from dist/resources/bus_definitions/ and IpCoreScaffolder can load them.
 *
 * Loaded via jest.integration.js -> setupFiles.
 */

import * as nodefs from 'fs';

// The vscode module is resolved to __mocks__/vscode.ts by moduleNameMapper.
// Use 'vscode' (not a relative path) so Jest's mapper applies the same cache key.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const vscodeMock: typeof import('vscode') = require('vscode');

interface MockWorkspace {
  fs?: {
    readDirectory: (uri: { fsPath: string }) => Promise<[string, 1 | 2][]>;
    readFile: (uri: { fsPath: string }) => Promise<Buffer>;
  };
  getConfiguration: () => { get: (_key: string, defaultValue: unknown) => unknown };
  workspaceFolders: undefined;
}

// Attach workspace.fs backed by Node fs
(vscodeMock.workspace as unknown as MockWorkspace).fs = {
  readDirectory: async (uri: { fsPath: string }) => {
    const entries = nodefs.readdirSync(uri.fsPath, { withFileTypes: true });
    return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1] as [string, 1 | 2]);
  },
  readFile: async (uri: { fsPath: string }) => {
    return nodefs.readFileSync(uri.fsPath) as Buffer;
  },
};

// Return an empty config so IpCoreScaffolder skips busLibraryPaths processing
(vscodeMock.workspace as unknown as MockWorkspace).getConfiguration = () => ({
  get: (_key: string, defaultValue: unknown) => defaultValue ?? [],
});

(vscodeMock.workspace as unknown as MockWorkspace).workspaceFolders = undefined;

// Ensure FileType enum values are present (in case the mock module's enum
// is not fully resolved by the time BusLibraryService accesses it).
interface FileTypeHolder {
  FileType?: { Unknown: number; File: number; Directory: number; SymbolicLink: number };
}
(vscodeMock as unknown as FileTypeHolder).FileType ??= {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};
