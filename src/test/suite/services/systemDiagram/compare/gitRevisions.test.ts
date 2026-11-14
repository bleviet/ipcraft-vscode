import * as vscode from 'vscode';
import {
  listFileCommits,
  listRevisions,
  openRepository,
  readRevision,
} from '../../../../../services/systemDiagram/compare/gitRevisions';

const uri = { fsPath: '/ws/system.bd' } as vscode.Uri;
const TIP = 'aaaaaaa1111111';
const BASE = 'bbbbbbb2222222';

type Repo = Parameters<typeof listRevisions>[0];

function repo(overrides: Record<string, unknown> = {}): Repo {
  return {
    state: { HEAD: { name: 'feature', commit: TIP }, refs: [] },
    show: jest.fn().mockResolvedValue('text'),
    log: jest.fn().mockResolvedValue([]),
    getMergeBase: jest.fn().mockResolvedValue(BASE),
    getRefs: jest.fn().mockResolvedValue([
      { name: 'feature', type: 0 },
      { name: 'main', type: 0 },
      { name: 'dev', type: 0 },
      { name: 'origin/main', type: 1 },
      { name: 'v1.0', type: 2 },
    ]),
    ...overrides,
  };
}

describe('openRepository', () => {
  const getExtension = vscode.extensions.getExtension as jest.Mock;

  it('returns the repository of the file', async () => {
    const found = {};
    getExtension.mockReturnValue({
      isActive: false,
      activate: jest.fn().mockResolvedValue({
        getAPI: () => ({ state: 'initialized', getRepository: () => found }),
      }),
    });
    expect(await openRepository(uri)).toBe(found);
    expect(getExtension).toHaveBeenCalledWith('vscode.git');
  });

  it('uses the exports of an active extension', async () => {
    const found = {};
    const activate = jest.fn();
    getExtension.mockReturnValue({
      isActive: true,
      exports: { getAPI: () => ({ state: 'initialized', getRepository: () => found }) },
      activate,
    });
    expect(await openRepository(uri)).toBe(found);
    expect(activate).not.toHaveBeenCalled();
  });

  it('returns undefined when the file is in no repository', async () => {
    getExtension.mockReturnValue({
      isActive: true,
      exports: { getAPI: () => ({ state: 'initialized', getRepository: () => null }) },
    });
    expect(await openRepository(uri)).toBeUndefined();
  });

  it('returns undefined when the git extension is missing or disabled', async () => {
    getExtension.mockReturnValue(undefined);
    expect(await openRepository(uri)).toBeUndefined();
    getExtension.mockReturnValue({
      isActive: true,
      exports: {
        getAPI: () => {
          throw new Error('Git model not found');
        },
      },
    });
    expect(await openRepository(uri)).toBeUndefined();
  });
});

describe('openRepository while git starts', () => {
  const getExtension = vscode.extensions.getExtension as jest.Mock;

  function startingGit() {
    const found = {};
    let notify: (state: string) => void = () => undefined;
    const dispose = jest.fn();
    getExtension.mockReturnValue({
      isActive: true,
      exports: {
        getAPI: () => ({
          state: 'uninitialized',
          onDidChangeState: (listener: (state: string) => void) => {
            notify = listener;
            return { dispose };
          },
          getRepository: () => found,
        }),
      },
    });
    return { found, dispose, notify: (state: string) => notify(state) };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for the git extension to initialize', async () => {
    const git = startingGit();
    const opened = openRepository(uri);
    await Promise.resolve();
    git.notify('initialized');
    expect(await opened).toBe(git.found);
    expect(git.dispose).toHaveBeenCalled();
  });

  it('treats the file as in no repository when git does not initialize in time', async () => {
    const git = startingGit();
    const opened = openRepository(uri);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await opened).toBeUndefined();
    expect(git.dispose).toHaveBeenCalled();
  });
});

describe('listRevisions', () => {
  it('waits for the status when the git extension has not reported HEAD yet', async () => {
    const state: Record<string, unknown> = { refs: [] };
    const status = jest.fn(() => {
      state.HEAD = { name: 'feature', commit: TIP };
      return Promise.resolve();
    });
    const choices = await listRevisions(repo({ state, status }), uri);
    expect(status).toHaveBeenCalledTimes(1);
    expect(choices.filter((c) => c.group === 'branch').map((c) => c.ref)).toEqual(['main', 'dev']);
  });

  it('does not ask for the status when HEAD is known', async () => {
    const status = jest.fn().mockResolvedValue(undefined);
    await listRevisions(repo({ status }), uri);
    expect(status).not.toHaveBeenCalled();
  });

  it('lists HEAD, the merge base, the other branches and the tags in order', async () => {
    const choices = await listRevisions(repo(), uri);
    expect(choices.map((c) => [c.label, c.description, c.ref, c.baseLabel])).toEqual([
      ['HEAD', 'last commit', 'HEAD', 'HEAD'],
      ['Merge base with main', 'bbbbbbb', BASE, 'main (merge base bbbbbbb)'],
      ['main', 'branch', 'main', 'main'],
      ['dev', 'branch', 'dev', 'dev'],
      ['v1.0', 'tag', 'v1.0', 'v1.0'],
    ]);
    expect(choices.map((c) => c.group)).toEqual(['git', 'git', 'branch', 'branch', 'tag']);
  });

  it('asks for the merge base of HEAD and the default branch', async () => {
    const r = repo();
    await listRevisions(r, uri);
    expect(r.getMergeBase).toHaveBeenCalledWith('HEAD', 'main');
  });

  it('falls back to master, then to a remote branch', async () => {
    const master = repo({ getRefs: jest.fn().mockResolvedValue([{ name: 'master', type: 0 }]) });
    await listRevisions(master, uri);
    expect(master.getMergeBase).toHaveBeenCalledWith('HEAD', 'master');
    const remote = repo({
      getRefs: jest.fn().mockResolvedValue([{ name: 'origin/main', type: 1 }]),
    });
    await listRevisions(remote, uri);
    expect(remote.getMergeBase).toHaveBeenCalledWith('HEAD', 'origin/main');
  });

  it('does not take a remote branch below a folder for the default branch', async () => {
    const nested = repo({
      getRefs: jest.fn().mockResolvedValue([
        { name: 'origin/feature/main', type: 1 },
        { name: 'origin/master', type: 1 },
      ]),
    });
    await listRevisions(nested, uri);
    expect(nested.getMergeBase).toHaveBeenCalledWith('HEAD', 'origin/master');
    const named = repo({
      getRefs: jest.fn().mockResolvedValue([
        { name: 'up/stream/main', type: 1, remote: 'up/stream' },
        { name: 'origin/feature/main', type: 1, remote: 'origin' },
      ]),
    });
    await listRevisions(named, uri);
    expect(named.getMergeBase).toHaveBeenCalledWith('HEAD', 'up/stream/main');
  });

  it('reads state.refs when getRefs does not exist', async () => {
    const r = repo({
      getRefs: undefined,
      state: { HEAD: { name: 'feature', commit: TIP }, refs: [{ name: 'dev', type: 0 }] },
    });
    const choices = await listRevisions(r, uri);
    expect(choices.map((c) => c.label)).toEqual(['HEAD', 'dev']);
  });

  it('skips the merge base when HEAD is the tip of the default branch', async () => {
    const choices = await listRevisions(
      repo({ getMergeBase: jest.fn().mockResolvedValue(TIP) }),
      uri
    );
    expect(choices.map((c) => c.label)).not.toContain('Merge base with main');
  });

  it('skips the merge base when none is found or the lookup fails', async () => {
    for (const getMergeBase of [
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockRejectedValue(new Error('no merge base')),
    ]) {
      const choices = await listRevisions(repo({ getMergeBase }), uri);
      expect(choices.map((c) => c.label)).toEqual(['HEAD', 'main', 'dev', 'v1.0']);
    }
  });

  it('skips the merge base without a default branch', async () => {
    const r = repo({ getRefs: jest.fn().mockResolvedValue([{ name: 'dev', type: 0 }]) });
    expect((await listRevisions(r, uri)).map((c) => c.label)).toEqual(['HEAD', 'dev']);
    expect(r.getMergeBase).not.toHaveBeenCalled();
  });

  it('turns a failing git extension into a clear error', async () => {
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('system.bd');
    const r = repo({ getRefs: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(listRevisions(r, uri)).rejects.toThrow(
      'Cannot list the revisions of system.bd: boom'
    );
  });
});

describe('listFileCommits', () => {
  const commit = (overrides: Record<string, unknown> = {}) => ({
    hash: 'abcdef0123456789',
    message: 'Add the DMA\n\nlong body',
    authorDate: new Date(2026, 2, 4, 23, 30),
    authorName: 'Ada',
    ...overrides,
  });

  it('asks for the commits of the file, at most 20', async () => {
    const log = jest.fn().mockResolvedValue([]);
    await listFileCommits(repo({ log }), uri);
    expect(log).toHaveBeenCalledWith({ path: '/ws/system.bd', maxEntries: 20 });
  });

  it('lists the first line of the message, the short hash, the day and the author', async () => {
    const choices = await listFileCommits(
      repo({ log: jest.fn().mockResolvedValue([commit(), commit({ hash: '1234567890' })]) }),
      uri
    );
    expect(choices[0]).toEqual({
      label: 'Add the DMA',
      description: 'abcdef0 · 2026-03-04 · Ada',
      ref: 'abcdef0123456789',
      baseLabel: 'abcdef0 Add the DMA',
      group: 'commit',
    });
    expect(choices[1].description).toBe('1234567 · 2026-03-04 · Ada');
  });

  it('writes the day where the user is, also just before midnight and after it', async () => {
    const days = async (...dates: Date[]) =>
      (
        await listFileCommits(
          repo({
            log: jest.fn().mockResolvedValue(dates.map((authorDate) => commit({ authorDate }))),
          }),
          uri
        )
      ).map((c) => c.description);
    expect(await days(new Date(2026, 0, 9, 23, 59), new Date(2026, 11, 31, 0, 1))).toEqual([
      'abcdef0 · 2026-01-09 · Ada',
      'abcdef0 · 2026-12-31 · Ada',
    ]);
  });

  it('leaves out the date and the author when the commit has none', async () => {
    const choices = await listFileCommits(
      repo({
        log: jest
          .fn()
          .mockResolvedValue([commit({ authorDate: undefined, authorName: undefined })]),
      }),
      uri
    );
    expect(choices[0].description).toBe('abcdef0');
  });

  it('cuts the subject by code points, not in the middle of a surrogate pair', async () => {
    const subject = '😀'.repeat(61);
    const choices = await listFileCommits(
      repo({ log: jest.fn().mockResolvedValue([commit({ message: subject })]) }),
      uri
    );
    expect(choices[0].baseLabel).toBe(`abcdef0 ${'😀'.repeat(60)}…`);
    const exact = await listFileCommits(
      repo({ log: jest.fn().mockResolvedValue([commit({ message: '😀'.repeat(60) })]) }),
      uri
    );
    expect(exact[0].baseLabel).toBe(`abcdef0 ${'😀'.repeat(60)}`);
  });

  it('names a commit without a message', async () => {
    const choices = await listFileCommits(
      repo({ log: jest.fn().mockResolvedValue([commit({ message: '' })]) }),
      uri
    );
    expect(choices[0]).toMatchObject({ label: '(no message)', baseLabel: 'abcdef0 (no message)' });
  });

  it('cuts a long first line to 60 characters in the label of the comparison only', async () => {
    const long = 'x'.repeat(61);
    const choices = await listFileCommits(
      repo({ log: jest.fn().mockResolvedValue([commit({ message: long })]) }),
      uri
    );
    expect(choices[0].label).toBe(long);
    expect(choices[0].baseLabel).toBe(`abcdef0 ${'x'.repeat(60)}…`);
    const exact = await listFileCommits(
      repo({ log: jest.fn().mockResolvedValue([commit({ message: 'y'.repeat(60) })]) }),
      uri
    );
    expect(exact[0].baseLabel).toBe(`abcdef0 ${'y'.repeat(60)}`);
  });

  it('lists nothing when log is not callable or fails', async () => {
    expect(await listFileCommits(repo({ log: undefined }), uri)).toEqual([]);
    expect(
      await listFileCommits(repo({ log: jest.fn().mockRejectedValue(new Error('boom')) }), uri)
    ).toEqual([]);
  });
});

describe('readRevision', () => {
  it('shows the file at the ref', async () => {
    const r = repo();
    expect(await readRevision(r, 'v1.0', uri)).toBe('text');
    expect(r.show).toHaveBeenCalledWith('v1.0', '/ws/system.bd');
  });

  it('adds the first line of the stderr of a failing git command', async () => {
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('system.bd');
    const failure = Object.assign(new Error('Failed to execute git'), {
      stderr: "\nfatal: path 'system.bd' does not exist in 'nope'\nmore\n",
    });
    const r = repo({ show: jest.fn().mockRejectedValue(failure) });
    await expect(readRevision(r, 'nope', uri)).rejects.toThrow(
      "Cannot read system.bd at 'nope': Failed to execute git: fatal: path 'system.bd' does not exist in 'nope'"
    );
  });

  it('refuses a revision that git would take for an option', async () => {
    const r = repo();
    await expect(readRevision(r, '--output=/tmp/x', uri)).rejects.toThrow(
      'A revision cannot start with -'
    );
    await expect(readRevision(r, ' -x', uri)).rejects.toThrow('A revision cannot start with -');
    expect(r.show).not.toHaveBeenCalled();
  });

  it('turns a failing show into a clear error', async () => {
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('system.bd');
    const r = repo({ show: jest.fn().mockRejectedValue(new Error('bad object')) });
    await expect(readRevision(r, 'nope', uri)).rejects.toThrow(
      "Cannot read system.bd at 'nope': bad object"
    );
  });
});
