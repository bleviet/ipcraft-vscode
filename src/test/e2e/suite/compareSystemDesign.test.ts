/* eslint-disable */
import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { openDesignTabs } from '../../../providers/systemDiagram/openDesignTabs';
import { pickCompareBase } from '../../../providers/systemDiagram/pickCompareBase';
import {
  listFileCommits,
  listRevisions,
  openRepository,
  readRevision,
  REVISION_DASH,
  type GitRepository,
} from '../../../services/systemDiagram/compare/gitRevisions';

// The comparison of a system design talks to the built-in git extension, the tab API and the
// quick pick. Unit tests mock all three; this suite runs them in a real VS Code.

const SYSTEM_DIAGRAM = 'ipcraft.systemDiagram';
// out/test/e2e/suite -> the repository's fixtures (not copied to out/).
const FIXTURES = path.resolve(__dirname, '../../../../src/test/fixtures/system-design/diff');
const BASE = fs.readFileSync(path.join(FIXTURES, 'zynq_gpio_base.bd'), 'utf8');
const CURRENT = fs.readFileSync(path.join(FIXTURES, 'zynq_gpio_current.bd'), 'utf8');
const SUBJECT = 'Rework the GPIO block $(flame)';

const ACCEPT = 'workbench.action.acceptSelectedQuickOpenItem';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(
  read: () => Promise<T | undefined> | T | undefined,
  what: string
): Promise<T> {
  for (let i = 0; i < 100; i += 1) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Runs `command` on the open quick pick until `pending` settles. The quick pick opens some time
 * after the call that shows it, and nothing tells an extension when; a command sent too early is
 * ignored, so it is repeated. Fails when the pick is not answered within 20 seconds.
 */
async function answerQuickPick<T>(pending: Promise<T>, command: string): Promise<T> {
  let done = false;
  const settled = pending.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  const deadline = Date.now() + 20000;
  while (!done) {
    if (Date.now() > deadline) {
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      throw new Error(`The quick pick did not answer to ${command}`);
    }
    await Promise.race([settled, sleep(400)]);
    if (!done) {
      await vscode.commands.executeCommand(command);
      await Promise.race([settled, sleep(200)]);
    }
  }
  return pending;
}

function hasGit(): boolean {
  try {
    cp.execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

suite('Compare a system design (real git extension, tabs and quick pick)', function () {
  this.timeout(90000);

  let root: string;
  let design: vscode.Uri;
  let other: vscode.Uri;
  let script: vscode.Uri;
  let component: vscode.Uri;
  let repo: GitRepository;
  let baseCommit: string;

  const git = (...args: string[]): string =>
    cp
      .execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
      })
      .trim();

  suiteSetup(async function () {
    if (!hasGit()) {
      this.skip();
    }
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-e2e-compare-')));
    git('init', '-q');
    git('checkout', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'system.bd'), BASE);
    fs.writeFileSync(path.join(root, 'other.bd'), BASE);
    fs.writeFileSync(path.join(root, 'build.tcl'), 'create_bd_design "t"\n');
    fs.writeFileSync(path.join(root, 'core_hw.tcl'), 'package require qsys\n');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'notes\n');
    fs.writeFileSync(path.join(root, 'diffed.bd'), BASE);
    fs.writeFileSync(path.join(root, 'to_rename.bd'), BASE);
    git('add', '.');
    git('commit', '-m', 'Add the base design');
    baseCommit = git('rev-parse', 'HEAD');
    git('tag', 'v1');
    git('branch', 'feature/gpio');
    fs.writeFileSync(path.join(root, 'system.bd'), CURRENT);
    // A file renamed since the base commit, and one that did not exist then.
    git('mv', 'to_rename.bd', 'renamed.bd');
    fs.writeFileSync(path.join(root, 'added.bd'), CURRENT);
    git('add', 'added.bd');
    git('commit', '-am', SUBJECT);

    design = vscode.Uri.file(path.join(root, 'system.bd'));
    other = vscode.Uri.file(path.join(root, 'other.bd'));
    script = vscode.Uri.file(path.join(root, 'build.tcl'));
    component = vscode.Uri.file(path.join(root, 'core_hw.tcl'));

    // The test window has no folder open; let the git extension open the repository of an open file.
    await vscode.workspace
      .getConfiguration('git')
      .update('openRepositoryInParentFolders', 'always', vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.window.showTextDocument(design, { preview: false });
    repo = await until(() => openRepository(design), 'the git extension to open the repository');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('lists HEAD, branches and tags of the repository', async () => {
    const revisions = await listRevisions(repo, design);
    const byGroup = (group: string) => revisions.filter((r) => r.group === group).map((r) => r.ref);
    assert.ok(byGroup('git').includes('HEAD'), `HEAD missing: ${JSON.stringify(revisions)}`);
    assert.deepStrictEqual(byGroup('branch'), ['feature/gpio']);
    assert.deepStrictEqual(byGroup('tag'), ['v1']);
  });

  test('lists the commits that changed the file, with their messages', async () => {
    const commits = await listFileCommits(repo, design);
    assert.deepStrictEqual(
      commits.map((c) => c.label),
      [SUBJECT, 'Add the base design']
    );
    assert.match(commits[0].description, /^[0-9a-f]{7} · \d{4}-\d{2}-\d{2} · E2E$/);
    assert.strictEqual(commits[1].ref, baseCommit);
    assert.strictEqual(commits[1].baseLabel, `${baseCommit.slice(0, 7)} Add the base design`);

    // `path` limits the log to the file: other.bd only has the first commit.
    const otherCommits = await listFileCommits(repo, other);
    assert.deepStrictEqual(
      otherCommits.map((c) => c.label),
      ['Add the base design']
    );
  });

  test('reads the file at a revision', async () => {
    assert.deepStrictEqual(await readRevision(repo, 'HEAD', design), { text: CURRENT });
    assert.deepStrictEqual(await readRevision(repo, 'HEAD~1', design), { text: BASE });
    assert.deepStrictEqual(await readRevision(repo, baseCommit, design), { text: BASE });
    assert.deepStrictEqual(await readRevision(repo, 'v1', design), { text: BASE });
    assert.deepStrictEqual(await readRevision(repo, 'feature/gpio', design), { text: BASE });
  });

  test('reads a file that was renamed since the revision under its old path', async () => {
    const renamed = vscode.Uri.file(path.join(root, 'renamed.bd'));
    // Workspace-relative, as the other labels; the test window has no folder, so the path is absolute.
    const oldPath = vscode.workspace.asRelativePath(path.join(root, 'to_rename.bd'), false);
    assert.deepStrictEqual(await readRevision(repo, 'HEAD~1', renamed), {
      text: BASE,
      renamedFrom: oldPath,
    });
    assert.deepStrictEqual(await readRevision(repo, 'v1', renamed), {
      text: BASE,
      renamedFrom: oldPath,
    });
    assert.ok(oldPath.endsWith('to_rename.bd'));
    // At HEAD the file is under its own path.
    assert.deepStrictEqual(await readRevision(repo, 'HEAD', renamed), { text: BASE });
  });

  test('reports a file that did not exist at the revision as missing', async () => {
    const added = vscode.Uri.file(path.join(root, 'added.bd'));
    assert.deepStrictEqual(await readRevision(repo, 'HEAD~1', added), { missing: true });
    assert.deepStrictEqual(await readRevision(repo, 'v1', added), { missing: true });
    assert.deepStrictEqual(await readRevision(repo, 'HEAD', added), { text: CURRENT });
    // A path that never existed is missing too; a revision that does not exist stays an error.
    const never = vscode.Uri.file(path.join(root, 'never.bd'));
    assert.deepStrictEqual(await readRevision(repo, 'v1', never), { missing: true });
    await assert.rejects(readRevision(repo, 'no-such-revision', added), /no-such-revision/);
  });

  test('explains a revision that cannot be read', async () => {
    await assert.rejects(readRevision(repo, 'no-such-revision', design), (error: Error) => {
      assert.match(error.message, /no-such-revision/);
      return true;
    });
    await assert.rejects(readRevision(repo, '--output=x', design), new RegExp(REVISION_DASH));
    assert.ok(!fs.existsSync(path.join(root, 'x')), 'git must not have been run with the option');
  });

  test('offers the other open designs, in text and diagram editors', async () => {
    const document = await vscode.workspace.openTextDocument(design);
    await vscode.window.showTextDocument(other, { preview: false });
    await vscode.commands.executeCommand('vscode.openWith', script, SYSTEM_DIAGRAM);
    await vscode.window.showTextDocument(component, { preview: false });
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'notes.txt')), {
      preview: false,
    });
    // A design that is open only as one side of a diff is not an open design.
    const diffed = vscode.Uri.file(path.join(root, 'diffed.bd'));
    await vscode.commands.executeCommand('vscode.diff', diffed, other, 'diffed ↔ other');

    const kinds = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => `${tab.label}:${(tab.input as object | undefined)?.constructor.name}`);
    console.log(`[compare e2e] open tabs: ${kinds.join(', ')}`);

    assert.deepStrictEqual(
      openDesignTabs(document)
        .map((uri) => path.basename(uri.fsPath))
        .sort(),
      ['build.tcl', 'other.bd']
    );
  });

  test('the quick pick returns the picked base with its text', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const document = await vscode.workspace.openTextDocument(design);
    await vscode.window.showTextDocument(document, { preview: false });

    // No other design is open, so the first entry is HEAD.
    const headBase = await answerQuickPick(pickCompareBase(document), ACCEPT);
    assert.strictEqual(headBase?.label, 'HEAD');
    assert.strictEqual(headBase?.text, CURRENT);
    assert.strictEqual(headBase?.file, undefined);

    // With another design open, it comes first and is a file base with the tab's text.
    await vscode.window.showTextDocument(other, { preview: false });
    await vscode.window.showTextDocument(document, { preview: false });
    const tabBase = await answerQuickPick(pickCompareBase(document), ACCEPT);
    assert.strictEqual(tabBase?.file?.fsPath, other.fsPath);
    assert.strictEqual(tabBase?.text, BASE);

    // Escape cancels.
    assert.strictEqual(
      await answerQuickPick(pickCompareBase(document), 'workbench.action.closeQuickOpen'),
      undefined
    );
  });

  test('lists and reads designs of a workspace that is not on the local disk', async () => {
    // Remote and virtual workspaces use another URI scheme than `file:`. A file system
    // provider registered here stands in for one.
    const files = new Map<string, Uint8Array>([
      ['/ws/remote_current.bd', Buffer.from(CURRENT)],
      ['/ws/remote_base.bd', Buffer.from(BASE)],
    ]);
    const changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    const provider: vscode.FileSystemProvider = {
      onDidChangeFile: changed.event,
      watch: () => new vscode.Disposable(() => undefined),
      stat: (uri) => {
        const data = files.get(uri.path);
        if (data) {
          return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: data.byteLength };
        }
        if (uri.path === '/' || uri.path === '/ws') {
          return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }
        throw vscode.FileSystemError.FileNotFound(uri);
      },
      readDirectory: () =>
        [...files.keys()].map((p) => [path.posix.basename(p), vscode.FileType.File]),
      createDirectory: () => undefined,
      readFile: (uri) => {
        const data = files.get(uri.path);
        if (!data) {
          throw vscode.FileSystemError.FileNotFound(uri);
        }
        return data;
      },
      writeFile: (uri, content) => void files.set(uri.path, content),
      delete: (uri) => void files.delete(uri.path),
      rename: () => undefined,
    };
    const registration = vscode.workspace.registerFileSystemProvider('ipcrafte2e', provider, {
      isCaseSensitive: true,
    });
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const current = vscode.Uri.parse('ipcrafte2e:/ws/remote_current.bd');
      const base = vscode.Uri.parse('ipcrafte2e:/ws/remote_base.bd');
      // A design on the local disk is open too; it is not offered next to a remote document.
      await vscode.window.showTextDocument(other, { preview: false });
      await vscode.window.showTextDocument(base, { preview: false });
      const document = await vscode.workspace.openTextDocument(current);
      await vscode.window.showTextDocument(document, { preview: false });

      assert.deepStrictEqual(
        openDesignTabs(document).map((uri) => uri.toString()),
        [base.toString()]
      );

      const picked = await answerQuickPick(pickCompareBase(document), ACCEPT);
      assert.strictEqual(picked?.file?.toString(), base.toString());
      assert.strictEqual(picked?.text, BASE);

      // The diagram editor opens on that scheme as well.
      await vscode.commands.executeCommand('vscode.openWith', current, SYSTEM_DIAGRAM);
      const active = await until(() => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        return input instanceof vscode.TabInputCustom ? input : undefined;
      }, 'the system diagram of the remote design');
      assert.strictEqual(active.uri.toString(), current.toString());
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      registration.dispose();
      changed.dispose();
    }
  });

  test('the command finds the active system diagram', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Without a diagram the command reports that none is active.
    await vscode.window.showTextDocument(design, { preview: false });
    assert.strictEqual(
      await vscode.commands.executeCommand('fpga-ip-core.compareSystemDesign'),
      false
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await vscode.commands.executeCommand('vscode.openWith', design, SYSTEM_DIAGRAM);
    await until(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom
          ? true
          : undefined,
      'the system diagram to become the active editor'
    );
    // The command returns as soon as it has found the diagram; its picker opens afterwards.
    assert.strictEqual(
      await vscode.commands.executeCommand('fpga-ip-core.compareSystemDesign'),
      true
    );
    // Its picker may open now or a moment later; close it either way so it cannot stay open.
    await sleep(2000);
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    // The diagram is still the active editor.
    const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(active instanceof vscode.TabInputCustom);
    assert.strictEqual((active as vscode.TabInputCustom).uri.fsPath, design.fsPath);
  });

  // Not tested here, but measured with this suite on VS Code 1.80, 1.95 and 1.129:
  // `vscode.openWith` on a diagram that is open in another editor group opens a second diagram
  // in the active group. That is why Swap reveals the open panel itself.
});
