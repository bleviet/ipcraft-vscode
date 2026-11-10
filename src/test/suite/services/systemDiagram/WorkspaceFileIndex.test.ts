import * as vscode from 'vscode';
import { WorkspaceFileIndex } from '../../../../services/systemDiagram/WorkspaceFileIndex';
import { buildExcludeGlob } from '../../../../services/systemDiagram/enrichment/excludeGlob';
import { Logger } from '../../../../utils/Logger';

const uri = (fsPath: string) => ({ fsPath }) as unknown as vscode.Uri;

type Excludes = Record<string, Record<string, unknown> | undefined>;

function setup(files: string[], excludes: Excludes = {}) {
  const workspace = vscode.workspace as unknown as {
    findFiles: jest.Mock;
    createFileSystemWatcher: jest.Mock;
    getConfiguration: jest.Mock;
    getWorkspaceFolder: jest.Mock;
    onDidChangeConfiguration: jest.Mock;
  };
  const listener = { dispose: jest.fn() };
  let onConfigChange: (event: vscode.ConfigurationChangeEvent) => void = () => undefined;
  workspace.onDidChangeConfiguration.mockImplementation((handler: typeof onConfigChange) => {
    onConfigChange = handler;
    return listener;
  });
  workspace.getConfiguration.mockImplementation((section: string) => ({
    get: (key: string) => (key === 'exclude' ? excludes[section] : undefined),
  }));
  workspace.createFileSystemWatcher.mockReturnValue({
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  });
  // findFiles honours the exclude it receives, like VS Code does, and the limit.
  workspace.findFiles.mockImplementation(
    (_glob: unknown, exclude: string | undefined, limit: number) => {
      const patterns = (exclude ?? '').replace(/^\{|\}$/g, '').split(',');
      const dirs = patterns
        .filter((pattern) => /^\*\*\/[^*]+\/\*\*$/.test(pattern))
        .map((pattern) => `/${pattern.slice(3, -3)}/`);
      return Promise.resolve(
        files
          .filter((file) => !dirs.some((dir) => file.includes(dir)))
          .slice(0, limit)
          .map(uri)
      );
    }
  );
  const logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  const read = jest.fn((u: vscode.Uri) => Promise.resolve(u.fsPath));
  return {
    workspace,
    listener,
    logger,
    read,
    changeConfig: (...sections: string[]) =>
      onConfigChange({
        affectsConfiguration: (section: string) => sections.includes(section),
      }),
  };
}

describe('WorkspaceFileIndex', () => {
  it('passes the exclude glob built from the ignored directories and search.exclude (VS Code adds files.exclude)', async () => {
    const { workspace, logger, read } = setup([], {
      files: { '**/build': true },
      search: { '**/dist': true, '**/keep': false },
    });
    await new WorkspaceFileIndex('**/*.vhd', 10, read, logger).get();
    const expected = buildExcludeGlob({ '**/dist': true }).glob;
    expect((workspace.findFiles.mock.calls as unknown[][])[0]).toEqual(['**/*.vhd', expected, 10]);
    expect(expected).toContain('**/node_modules/**');
    expect(expected).not.toContain('**/build');
    expect(expected).toContain('**/dist');
    expect(expected).not.toContain('**/keep');
  });

  it('does not read or count excluded files against the limit', async () => {
    const files = [
      '/ws/node_modules/a.vhd',
      '/ws/node_modules/b.vhd',
      '/ws/.git/c.vhd',
      '/ws/rtl/d.vhd',
      '/ws/rtl/e.vhd',
    ];
    const { read, logger } = setup(files);
    const result = await new WorkspaceFileIndex('**/*.vhd', 2, read, logger).get();
    expect(result.sort()).toEqual(['/ws/rtl/d.vhd', '/ws/rtl/e.vhd']);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('still drops ignored paths that the search returns anyway', async () => {
    const { workspace, read, logger } = setup([]);
    workspace.findFiles.mockResolvedValue([uri('/ws/node_modules/a.vhd'), uri('/ws/ok.vhd')]);
    const result = await new WorkspaceFileIndex('**/*.vhd', 10, read, logger).get();
    expect(result).toEqual(['/ws/ok.vhd']);
  });

  it('rebuilds after files.exclude or search.exclude changes and ignores other settings', async () => {
    const { workspace, read, logger, changeConfig } = setup(['/ws/a.vhd']);
    const index = new WorkspaceFileIndex('**/*.vhd', 10, read, logger);
    await index.get();
    await index.get();
    expect(workspace.findFiles).toHaveBeenCalledTimes(1);
    changeConfig('editor.fontSize');
    await index.get();
    expect(workspace.findFiles).toHaveBeenCalledTimes(1);
    changeConfig('files.exclude');
    await index.get();
    expect(workspace.findFiles).toHaveBeenCalledTimes(2);
    changeConfig('search.exclude');
    await index.get();
    expect(workspace.findFiles).toHaveBeenCalledTimes(3);
  });

  it('disposes the configuration listener with the index', async () => {
    const { listener, read, logger } = setup([]);
    const index = new WorkspaceFileIndex('**/*.vhd', 10, read, logger);
    await index.get();
    index.dispose();
    expect(listener.dispose).toHaveBeenCalled();
  });

  it('warns naming the glob and the limit when the search is truncated', async () => {
    const { read, logger } = setup(['/ws/a.vhd', '/ws/b.vhd', '/ws/c.vhd']);
    await new WorkspaceFileIndex('**/*.vhd', 2, read, logger).get();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('**/*.vhd'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('2'));
  });

  it('does not warn when fewer files than the limit are found', async () => {
    const { read, logger } = setup(['/ws/a.vhd']);
    await new WorkspaceFileIndex('**/*.vhd', 2, read, logger).get();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a pattern with nested braces once and leaves it out', async () => {
    const { workspace, read, logger, changeConfig } = setup([], {
      search: { '**/{a,{b,c}}': true },
    });
    const index = new WorkspaceFileIndex('**/*.vhd', 10, read, logger);
    await index.get();
    changeConfig('files.exclude');
    await index.get();
    const exclude = (workspace.findFiles.mock.calls as string[][])[0][1];
    expect(exclude).not.toContain('{a,{b,c}}');
    const skipWarnings = (logger.warn as jest.Mock).mock.calls.filter(([m]: [string]) =>
      m.includes('**/{a,{b,c}}')
    );
    expect(skipWarnings).toHaveLength(1);
  });

  describe('watched file visibility', () => {
    const watcherHandlers = (workspace: ReturnType<typeof setup>['workspace']) =>
      (
        workspace.createFileSystemWatcher.mock.results[0].value as {
          onDidChange: jest.Mock;
        }
      ).onDidChange.mock.calls[0][0] as (u: vscode.Uri) => void;

    it('checks a changed file by its workspace-relative path and passes the exclude', async () => {
      const { workspace, read, logger } = setup(['/ws/a.vhd']);
      workspace.getWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/ws' } });
      const index = new WorkspaceFileIndex('**/*.vhd', 10, read, logger);
      await index.get();
      watcherHandlers(workspace)(uri('/ws/sub dir/a[1]!b.vhd'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const call = (workspace.findFiles.mock.calls as unknown[][]).at(-1) as [
        { base: unknown; pattern: string },
        string,
        number,
      ];
      expect(call[0].base).toEqual({ uri: { fsPath: '/ws' } });
      expect(call[0].pattern).toBe('sub dir/a[[]1[]]!b.vhd');
      expect(call[1]).toBe(buildExcludeGlob(undefined).glob);
      expect(call[2]).toBe(1);
    });

    it('falls back to the file directory outside any workspace folder', async () => {
      const { workspace, read, logger } = setup(['/ws/a.vhd']);
      workspace.getWorkspaceFolder.mockReturnValue(undefined);
      await new WorkspaceFileIndex('**/*.vhd', 10, read, logger).get();
      watcherHandlers(workspace)(uri('/elsewhere/b.vhd'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const call = (workspace.findFiles.mock.calls as unknown[][]).at(-1) as [
        { base: unknown; pattern: string },
      ];
      expect(call[0]).toMatchObject({ base: '/elsewhere', pattern: 'b.vhd' });
    });
  });
});
