import * as vscode from 'vscode';
import {
  listFileCommits,
  listRevisions,
  openRepository,
  readFileAt,
  readRevision,
  resolveCommit,
  revisionFileReader,
} from '../../../../../services/systemDiagram/compare/gitRevisions';

const uri = { fsPath: '/ws/system.bd' } as vscode.Uri;
const TIP = 'aaaaaaa1111111';
const BASE = 'bbbbbbb2222222';

type Repo = Parameters<typeof listRevisions>[0];

function repo(overrides: Record<string, unknown> = {}): Repo {
  return {
    state: { HEAD: { name: 'feature', commit: TIP }, refs: [] },
    show: jest.fn().mockResolvedValue('text'),
    diffWith: jest.fn().mockResolvedValue([]),
    getObjectDetails: jest.fn().mockResolvedValue({}),
    getCommit: jest.fn().mockResolvedValue({ hash: BASE }),
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
    expect(await readRevision(r, 'v1.0', uri)).toEqual({ text: 'text' });
    expect(r.diffWith).not.toHaveBeenCalled();
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

  describe('when the file is not at the ref under its path', () => {
    const notThere = new Error('Failed to execute git');
    const unknownPath = Object.assign(new Error('Path not known by git'), {
      gitErrorCode: 'UnknownPath',
    });
    const at = (fsPath: string) => ({ fsPath }) as vscode.Uri;
    const renamedTo = (to: string, from = '/ws/old/system.bd') => ({
      status: 3,
      uri: at(to),
      originalUri: at(from),
    });
    beforeEach(() => {
      (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((target: vscode.Uri) =>
        target.fsPath.replace('/ws/', '')
      );
    });

    it('reads it under the old path that git found for the rename', async () => {
      const showOnlyOld = jest
        .fn()
        .mockImplementation((ref: string, path: string) =>
          path === '/ws/old/system.bd' ? Promise.resolve('old text') : Promise.reject(notThere)
        );
      const r = repo({
        show: showOnlyOld,
        diffWith: jest
          .fn()
          .mockResolvedValue([
            { status: 5, uri: at('/ws/other.bd'), originalUri: at('/ws/other.bd') },
            renamedTo('/ws/system.bd'),
          ]),
      });
      expect(await readRevision(r, 'v1.0', uri)).toEqual({
        text: 'old text',
        renamedFrom: 'old/system.bd',
      });
      expect(r.diffWith).toHaveBeenCalledWith('v1.0');
      expect(showOnlyOld).toHaveBeenLastCalledWith('v1.0', '/ws/old/system.bd');
    });

    it('ignores the rename of another file and a change that is not a rename', async () => {
      const r = repo({
        show: jest.fn().mockRejectedValue(notThere),
        diffWith: jest
          .fn()
          .mockResolvedValue([
            renamedTo('/ws/other.bd'),
            { status: 1, uri: at('/ws/system.bd'), originalUri: at('/ws/system.bd') },
          ]),
        getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
      });
      expect(await readRevision(r, 'v1.0', uri)).toEqual({ missing: true });
    });

    it('reports the file as missing when git does not know the path at the ref', async () => {
      const r = repo({
        show: jest.fn().mockRejectedValue(notThere),
        getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
      });
      expect(await readRevision(r, 'v1.0', uri)).toEqual({ missing: true });
      expect(r.getObjectDetails).toHaveBeenCalledWith('v1.0', '/ws/system.bd');
    });

    it('keeps the error of show when the path is known or git fails for another reason', async () => {
      (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('system.bd');
      const known = repo({ show: jest.fn().mockRejectedValue(new Error('bad object')) });
      await expect(readRevision(known, 'v1.0', uri)).rejects.toThrow(
        "Cannot read system.bd at 'v1.0': bad object"
      );
      const unrelated = repo({
        show: jest.fn().mockRejectedValue(new Error('bad object')),
        getObjectDetails: jest.fn().mockRejectedValue(new Error('not a valid object name')),
      });
      await expect(readRevision(unrelated, 'nope', uri)).rejects.toThrow(
        "Cannot read system.bd at 'nope': bad object"
      );
    });

    it('treats a failing diff as no rename', async () => {
      const r = repo({
        show: jest.fn().mockRejectedValue(notThere),
        diffWith: jest.fn().mockRejectedValue(new Error('boom')),
        getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
      });
      expect(await readRevision(r, 'v1.0', uri)).toEqual({ missing: true });
    });

    it('fails when the file cannot be read under the old path either', async () => {
      (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('system.bd');
      const r = repo({
        show: jest.fn().mockRejectedValue(new Error('gone')),
        diffWith: jest.fn().mockResolvedValue([renamedTo('/ws/system.bd')]),
      });
      await expect(readRevision(r, 'v1.0', uri)).rejects.toThrow(
        "Cannot read system.bd at 'v1.0': gone"
      );
    });
  });
});

describe('resolveCommit', () => {
  it('gives the hash the ref names now', async () => {
    const r = repo({ getCommit: jest.fn().mockResolvedValue({ hash: TIP }) });
    expect(await resolveCommit(r, 'HEAD')).toBe(TIP);
    // The ref is peeled to a commit: a tag message cannot put another hash in the output.
    expect(r.getCommit).toHaveBeenCalledWith('HEAD^{commit}');
  });

  it('refuses a ref that git would take for an option, without running git', async () => {
    const r = repo();
    await expect(resolveCommit(r, ' --output=x')).rejects.toThrow('A revision cannot start with -');
    expect(r.getCommit).not.toHaveBeenCalled();
  });

  it('explains a ref that git cannot resolve', async () => {
    const r = repo({
      getCommit: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('git failed'), { stderr: 'fatal: bad revision\n' })
        ),
    });
    await expect(resolveCommit(r, 'nope')).rejects.toThrow(
      "Cannot resolve 'nope': git failed: fatal: bad revision"
    );
  });
});

describe('readFileAt', () => {
  const unknownPath = Object.assign(new Error('Path not known by git'), {
    gitErrorCode: 'UnknownPath',
  });
  const defined = { fsPath: '/ws/ip/core.ip.yml' } as vscode.Uri;

  beforeEach(() => {
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((u: vscode.Uri) =>
      u.fsPath.replace('/ws/', '')
    );
  });

  it('reads the file at the ref with one git call', async () => {
    const r = repo({ show: jest.fn().mockResolvedValue('vlnv: x') });
    expect(await readFileAt(r, 'v1.0', defined)).toBe('vlnv: x');
    expect(r.show).toHaveBeenCalledWith('v1.0', '/ws/ip/core.ip.yml');
    expect(r.getObjectDetails).not.toHaveBeenCalled();
  });

  it('is undefined when git does not know the path at the ref', async () => {
    const r = repo({
      show: jest.fn().mockRejectedValue(new Error('Failed to execute git')),
      getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
    });
    expect(await readFileAt(r, 'v1.0', defined)).toBeUndefined();
    expect(r.getObjectDetails).toHaveBeenCalledWith('v1.0', '/ws/ip/core.ip.yml');
  });

  it("fails with git's reason when the path is known or git fails for another reason", async () => {
    const known = repo({ show: jest.fn().mockRejectedValue(new Error('bad object')) });
    await expect(readFileAt(known, 'v1.0', defined)).rejects.toThrow(
      "Cannot read ip/core.ip.yml at 'v1.0': bad object"
    );
    const unrelated = repo({
      show: jest.fn().mockRejectedValue(new Error('bad object')),
      getObjectDetails: jest.fn().mockRejectedValue(new Error('not a valid object name')),
    });
    await expect(readFileAt(unrelated, 'nope', defined)).rejects.toThrow(
      "Cannot read ip/core.ip.yml at 'nope': bad object"
    );
  });

  it('reads the old path that oldPathOf gives when the path is not at the ref', async () => {
    const old = { fsPath: '/ws/old/core.ip.yml' } as vscode.Uri;
    const r = repo({
      show: jest
        .fn()
        .mockImplementation((_ref: string, p: string) =>
          p === old.fsPath ? Promise.resolve('old text') : Promise.reject(new Error('nope'))
        ),
      getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
    });
    expect(await readFileAt(r, 'v1.0', defined, async () => old)).toBe('old text');
    expect(await readFileAt(r, 'v1.0', defined, async () => undefined)).toBeUndefined();
  });

  it('fails when the old path cannot be read either', async () => {
    const old = { fsPath: '/ws/old/core.ip.yml' } as vscode.Uri;
    const r = repo({
      show: jest.fn().mockRejectedValue(new Error('gone')),
      getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
    });
    await expect(readFileAt(r, 'v1.0', defined, async () => old)).rejects.toThrow(
      "Cannot read old/core.ip.yml at 'v1.0': gone"
    );
  });
});

describe('revisionFileReader', () => {
  const unknownPath = Object.assign(new Error('Path not known by git'), {
    gitErrorCode: 'UnknownPath',
  });
  const at = (fsPath: string) => ({ fsPath }) as vscode.Uri;
  const moved = at('/ws/lib/core.ip.yml');
  const renamed = { status: 3, uri: moved, originalUri: at('/ws/ip/core.ip.yml') };

  beforeEach(() => {
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((u: vscode.Uri) =>
      u.fsPath.replace('/ws/', '')
    );
  });

  /** A tree with only `files` (path -> text) at the commit. */
  const tree = (files: Record<string, string>, overrides: Record<string, unknown> = {}) =>
    repo({
      show: jest
        .fn()
        .mockImplementation((_ref: string, p: string) =>
          p in files ? Promise.resolve(files[p]) : Promise.reject(new Error('not there'))
        ),
      getObjectDetails: jest.fn().mockRejectedValue(unknownPath),
      diffWith: jest.fn().mockResolvedValue([renamed]),
      ...overrides,
    });

  it('reads at the commit it was given, not at a ref', async () => {
    const r = tree({ '/ws/a.ip.yml': 'text' });
    expect(await revisionFileReader(r, BASE)(at('/ws/a.ip.yml'))).toBe('text');
    expect(r.show).toHaveBeenCalledWith(BASE, '/ws/a.ip.yml');
  });

  it('reads a file that was moved since under its old path, with one diff for all files', async () => {
    const r = tree({ '/ws/ip/core.ip.yml': 'old text' });
    const read = revisionFileReader(r, BASE);
    expect(await read(moved)).toBe('old text');
    expect(await read(at('/ws/new.ip.yml'))).toBeUndefined();
    expect(await read(at('/ws/other.ip.yml'))).toBeUndefined();
    expect(r.diffWith).toHaveBeenCalledTimes(1);
    expect(r.diffWith).toHaveBeenCalledWith(BASE);
  });

  it('reads a file once when it is asked for at the same time', async () => {
    const r = tree({ '/ws/a.ip.yml': 'text' });
    const read = revisionFileReader(r, BASE);
    const results = await Promise.all([1, 2, 3].map(() => read(at('/ws/a.ip.yml'))));
    expect(results).toEqual(['text', 'text', 'text']);
    expect(r.show).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed rename detection: the next absent file diffs again', async () => {
    const diffWith = jest
      .fn()
      .mockRejectedValueOnce(new Error('diff failed'))
      .mockResolvedValue([renamed]);
    const r = tree({ '/ws/ip/core.ip.yml': 'old text' }, { diffWith });
    const read = revisionFileReader(r, BASE);
    await expect(read(at('/ws/first.ip.yml'))).rejects.toThrow('diff failed');
    expect(await read(moved)).toBe('old text');
    expect(await read(at('/ws/second.ip.yml'))).toBeUndefined();
    expect(diffWith).toHaveBeenCalledTimes(2);
  });

  it('does not diff for files that are at the commit under their path', async () => {
    const r = tree({ '/ws/a.ip.yml': 'text' });
    await revisionFileReader(r, BASE)(at('/ws/a.ip.yml'));
    expect(r.diffWith).not.toHaveBeenCalled();
  });

  it('ignores a change that is not a rename', async () => {
    const r = tree({}, { diffWith: jest.fn().mockResolvedValue([{ ...renamed, status: 5 }]) });
    expect(await revisionFileReader(r, BASE)(moved)).toBeUndefined();
  });

  it('reads each file once, and again after a failure', async () => {
    const show = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('text');
    const r = tree(
      {},
      { show, getObjectDetails: jest.fn().mockRejectedValue(new Error('offline')) }
    );
    const read = revisionFileReader(r, BASE);
    await expect(read(at('/ws/a.ip.yml'))).rejects.toThrow('offline');
    expect(await read(at('/ws/a.ip.yml'))).toBe('text');
    expect(await read(at('/ws/a.ip.yml'))).toBe('text');
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('rejects when the rename detection fails, and tries it again', async () => {
    const diffWith = jest
      .fn()
      .mockRejectedValueOnce(new Error('diff failed'))
      .mockResolvedValue([renamed]);
    const r = tree({ '/ws/ip/core.ip.yml': 'old text' }, { diffWith });
    const read = revisionFileReader(r, BASE);
    await expect(read(moved)).rejects.toThrow('diff failed');
    expect(await read(moved)).toBe('old text');
  });
});
