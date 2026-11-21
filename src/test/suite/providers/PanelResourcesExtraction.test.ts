import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readBdJson } from '../../../parser/system/BdJsonReader';
import { PanelResources } from '../../../providers/systemDiagram/PanelResources';
import { runProcess } from '../../../services/BuildRunner';
import { extractionDir } from '../../../services/resources/extractionCache';
import { getToolchain } from '../../../services/toolchains/registry';
import type {
  DiagramResources,
  SystemDiagramToWebviewMessage,
} from '../../../shared/messages/systemDiagram';
import { vivadoFixture } from '../services/resources/fixtures';

jest.mock('../../../services/BuildRunner', () => ({ runProcess: jest.fn() }));
jest.mock('../../../services/toolchains/registry', () => ({ getToolchain: jest.fn() }));

const FIXTURES = path.join(__dirname, '../../fixtures/reports/vivado/spike');
const DESIGN_URI = 'file:///project/sys.bd';
const UNTRUSTED = 'Extracting a report runs Vivado, which needs a trusted workspace.';

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');

let root: string;
let workspace: string;
let storage: string;
let posted: SystemDiagramToWebviewMessage[];
let state: Map<string, unknown>;
let panels: PanelResources[];
const outputChannel = { appendLine: jest.fn(), show: jest.fn() };
let docker: { image: string; mountBase: string } | undefined;

const resourceMessages = (): DiagramResources[] =>
  posted.flatMap((m) => (m.type === 'resources' ? [m.resources] : []));
const last = (): DiagramResources => resourceMessages().at(-1) as DiagramResources;
const runMock = runProcess as jest.Mock;

function put(from: string, ...to: string[]): string {
  const target = path.join(workspace, ...to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (from === '') {
    fs.writeFileSync(target, 'checkpoint');
  } else {
    fs.copyFileSync(path.join(FIXTURES, from), target);
  }
  return target;
}

/** A project with an implementation checkpoint and an old report of the synthesis run. */
function project(): string {
  put('', 'proj.xpr');
  put('synth_hier.rpt', 'proj.runs', 'synth_1', 'synth_hier.rpt');
  return put('', 'proj.runs', 'impl_1', 'sys_wrapper_routed.dcp');
}

/** What the fake Vivado writes: the reports of the fixtures, into the folder it runs in. */
function vivadoWritesReports(): void {
  runMock.mockImplementation(
    (
      _exe: string,
      args: string[],
      options: { cwd: string; outputChannel: { appendLine: (l: string) => void } }
    ) => {
      const tclArgs = args.slice(args.indexOf('-tclargs') + 1);
      options.outputChannel.appendLine(`> vivado ${args.join(' ')}`);
      if (tclArgs.length === 3) {
        fs.copyFileSync(
          path.join(FIXTURES, 'ooc/sys_axi_bram_ctrl_0_0_utilization_synth.rpt'),
          path.join(options.cwd, tclArgs[2])
        );
      } else {
        fs.copyFileSync(
          path.join(FIXTURES, 'routed_hier.rpt'),
          path.join(options.cwd, 'utilization_hier.rpt')
        );
        fs.copyFileSync(
          path.join(FIXTURES, 'routed_flat.rpt'),
          path.join(options.cwd, 'utilization_flat.rpt')
        );
      }
      return Promise.resolve({ success: true, exitCode: 0 });
    }
  );
}

function newPanel(): PanelResources {
  const panel = new PanelResources({
    document: {
      uri: { toString: () => DESIGN_URI, fsPath: path.join(workspace, 'sys.bd') },
      fileName: path.join(workspace, 'sys.bd'),
    } as unknown as vscode.TextDocument,
    context: {
      workspaceState: {
        get: (key: string) => state.get(key),
        update: (key: string, value: unknown) => {
          if (value === undefined) {
            state.delete(key);
          } else {
            state.set(key, value);
          }
          return Promise.resolve();
        },
      },
      storageUri: { fsPath: storage },
    } as unknown as vscode.ExtensionContext,
    post: (message) => posted.push(message),
  });
  panels.push(panel);
  return panel;
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

const checkpointOption = () =>
  last().sources.find((s) => s.extractable === true && s.stage === 'routed');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-extract-panel-'));
  workspace = path.join(root, 'project');
  storage = path.join(root, 'storage');
  fs.mkdirSync(workspace, { recursive: true });
  posted = [];
  state = new Map();
  panels = [];
  docker = undefined;
  (vscode.workspace as { isTrusted: boolean }).isTrusted = true;
  (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => ({
    fsPath,
    toString: () => fsPath,
  }));
  (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((uri: { fsPath: string }) =>
    uri.fsPath.startsWith(workspace) ? path.relative(workspace, uri.fsPath) : uri.fsPath
  );
  (vscode.workspace.getWorkspaceFolder as jest.Mock).mockImplementation(
    (uri: { fsPath: string }) =>
      uri.fsPath.startsWith(workspace) ? { uri: { fsPath: workspace } } : undefined
  );
  (vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation(() => ({
    onDidChange: jest.fn(),
    onDidCreate: jest.fn(),
    onDidDelete: jest.fn(),
    dispose: jest.fn(),
  }));
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: jest.fn() });
  (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(outputChannel);
  (getToolchain as jest.Mock).mockReturnValue({
    getDocker: jest.fn((_cfg: unknown, mountBase: string) =>
      docker ? { ...docker, mountBase } : undefined
    ),
    resolve: jest.fn(() => ({ exe: '/opt/vivado/bin/vivado', prefixArgs: [] })),
    getLaunchEnv: jest.fn(() => ({ env: { LM: '1' }, extraMounts: [] })),
  });
  // The progress runs its task, with a token that can be cancelled.
  (vscode.window.withProgress as jest.Mock).mockImplementation(
    (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
      task({ report: jest.fn() }, { onCancellationRequested: jest.fn() })
  );
  vivadoWritesReports();
});

afterEach(() => {
  panels.forEach((panel) => panel.dispose());
  fs.rmSync(root, { recursive: true, force: true });
});

describe('PanelResources: extracting from a checkpoint', () => {
  it('offers the checkpoint of the run, labelled like it, and selects a usable source first', async () => {
    project();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(checkpointOption()).toMatchObject({
      label: 'Post-route (impl_1)',
      usable: false,
      extractable: true,
      origin: 'project',
    });
    expect(last().sources.find((s) => s.stage === 'synth')?.usable).toBe(true);
    expect(last().report?.stage).toBe('synth');
  });

  it('shows no refusal for a selected checkpoint', async () => {
    project();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.select(checkpointOption()?.id as string);
    expect(last().report).toBeUndefined();
    expect(last().notice).toBeUndefined();
    expect(last().selected).toBe(checkpointOption()?.id);
  });

  it('refuses in an untrusted workspace, with a message, and runs nothing', async () => {
    project();
    (vscode.workspace as { isTrusted: boolean }).isTrusted = false;
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const before = posted.length;
    await panel.extractResources(checkpointOption()?.id as string);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(UNTRUSTED);
    expect(runMock).not.toHaveBeenCalled();
    expect(vscode.window.withProgress).not.toHaveBeenCalled();
    expect(posted).toHaveLength(before);
  });

  it('ignores a source that is not a checkpoint', async () => {
    project();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.extractResources(last().sources.find((s) => s.usable)?.id as string);
    await panel.extractResources('project:nope');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('runs Vivado through the toolchain with a notification progress, then selects the extracted report', async () => {
    const dcp = project();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const id = checkpointOption()?.id as string;
    await panel.extractResources(id);

    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        location: vscode.ProgressLocation.Notification,
        title: 'Extracting the resource report from sys_wrapper_routed.dcp',
        cancellable: true,
      }),
      expect.any(Function)
    );
    const out = extractionDir(storage, dcp);
    const [exe, args, options] = runMock.mock.calls[0];
    expect(exe).toBe('/opt/vivado/bin/vivado');
    expect(args).toEqual([
      '-mode',
      'batch',
      '-source',
      path.join(out, 'extract.tcl'),
      '-nojournal',
      '-nolog',
      '-tclargs',
      dcp,
      out,
    ]);
    expect(options).toMatchObject({ cwd: out, env: { LM: '1' }, docker: undefined });
    expect(options.signal).toBeInstanceOf(AbortSignal);

    // The extraction ran: the checkpoint became the report extracted from it.
    expect(last().extracting).toBeUndefined();
    expect(last().sources.some((s) => s.extractable)).toBe(false);
    const extracted = last().sources.find((s) => s.stage === 'routed');
    expect(extracted).toMatchObject({
      label: 'Post-route (impl_1)',
      usable: true,
      origin: 'project',
    });
    expect(last().selected).toBe(extracted?.id);
    expect(last().report).toMatchObject({ stage: 'routed' });
    expect(state.get(`ipcraft.resources.selected:${DESIGN_URI}`)).toBe(extracted?.id);
    // Nothing was written into the project.
    expect(fs.readdirSync(path.dirname(dcp)).sort()).toEqual(['sys_wrapper_routed.dcp']);
  });

  it('posts the source being extracted while the tool runs', async () => {
    project();
    let release: (value: { success: boolean; exitCode: number }) => void = () => undefined;
    // The tool starts after the `extracting` message is posted, and only after some file reads.
    let toolStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => (toolStarted = resolve));
    runMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
          toolStarted();
        })
    );
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const id = checkpointOption()?.id as string;
    const running = panel.extractResources(id);
    await started;
    expect(last().extracting).toBe(id);

    // A second click while it runs does nothing, and the panel stays usable.
    await panel.extractResources(id);
    expect(runMock).toHaveBeenCalledTimes(1);
    await panel.select(last().sources.find((s) => s.usable)?.id as string);
    expect(last().extracting).toBe(id);

    release({ success: false, exitCode: 1 });
    await running;
    expect(last().extracting).toBeUndefined();
  });

  it('mounts the checkpoint folder read-only and passes container paths in Docker', async () => {
    const dcp = project();
    docker = { image: 'vivado:2024.2', mountBase: '' };
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.extractResources(checkpointOption()?.id as string);

    const [exe, args, options] = runMock.mock.calls[0];
    expect(exe).toBe('vivado');
    expect(args).toEqual([
      '-mode',
      'batch',
      '-source',
      '/work/extract.tcl',
      '-nojournal',
      '-nolog',
      '-tclargs',
      '/ipcraft-dcp/sys_wrapper_routed.dcp',
      '/work',
    ]);
    expect(options).toMatchObject({
      cwd: extractionDir(storage, dcp),
      docker: { image: 'vivado:2024.2', mountBase: extractionDir(storage, dcp) },
      extraMounts: [{ host: path.dirname(dcp), container: '/ipcraft-dcp', ro: true }],
    });
  });

  it('opens the checkpoint with the Vivado version of the reports of its run', async () => {
    project();
    // A report of another stage in the run folder: it tells the version, the routed checkpoint stays.
    put('synth_hier.rpt', 'proj.runs', 'impl_1', 'early_synth.rpt');
    const resolve = jest.fn(() => ({ exe: 'vivado', prefixArgs: [] }));
    const getDocker = jest.fn();
    (getToolchain as jest.Mock).mockReturnValue({
      getDocker,
      resolve,
      getLaunchEnv: () => ({ env: {}, extraMounts: [] }),
    });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.extractResources(checkpointOption()?.id as string);
    expect(resolve).toHaveBeenCalledWith('vivado', expect.anything(), '2024.2');
    expect(getDocker).toHaveBeenCalledWith(expect.anything(), expect.any(String), '2024.2');
  });

  it('keeps the previous selection and shows the end of the output when the run fails', async () => {
    project();
    runMock.mockImplementation(
      (
        _exe: string,
        _args: string[],
        options: { outputChannel: { appendLine: (l: string) => void } }
      ) => {
        for (const line of ['INFO: starting', 'ERROR: [Common 17-69] cannot open']) {
          options.outputChannel.appendLine(line);
        }
        return Promise.resolve({ success: false, exitCode: 1 });
      }
    );
    (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue('Show Output');
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const before = last().selected;
    await panel.extractResources(checkpointOption()?.id as string);

    const [message, action] = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0];
    expect(message).toContain('Vivado could not write the report from sys_wrapper_routed.dcp');
    expect(message).toContain('ERROR: [Common 17-69] cannot open');
    expect(action).toBe('Show Output');
    await until(() => outputChannel.show.mock.calls.length > 0);
    expect(outputChannel.show).toHaveBeenCalledWith(true);
    expect(last().selected).toBe(before);
    expect(last().extracting).toBeUndefined();
    expect(checkpointOption()).toBeDefined();
  });

  it('says so when Vivado cannot be found, and runs nothing', async () => {
    project();
    (getToolchain as jest.Mock).mockReturnValue({
      getDocker: () => undefined,
      resolve: () => null,
      getLaunchEnv: () => ({ env: {}, extraMounts: [] }),
    });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.extractResources(checkpointOption()?.id as string);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Vivado was not found'),
      'Show Output'
    );
    expect(runMock).not.toHaveBeenCalled();
    expect(last().extracting).toBeUndefined();
  });

  it('kills the process when the progress is cancelled, without an error message', async () => {
    project();
    let cancel: () => void = () => undefined;
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
        task(
          { report: jest.fn() },
          { onCancellationRequested: (handler: () => void) => (cancel = handler) }
        )
    );
    runMock.mockImplementation(
      (_exe: string, _args: string[], options: { signal: AbortSignal }) =>
        new Promise((resolve) =>
          options.signal.addEventListener('abort', () => resolve({ success: false, exitCode: -1 }))
        )
    );
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const before = last().selected;
    const running = panel.extractResources(checkpointOption()?.id as string);
    await until(() => runMock.mock.calls.length === 1);
    cancel();
    await running;

    expect(runMock.mock.calls[0][2].signal.aborted).toBe(true);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(last().selected).toBe(before);
    expect(last().extracting).toBeUndefined();
  });

  it('cancels a running extraction when the panel is disposed', async () => {
    project();
    runMock.mockImplementation(
      (_exe: string, _args: string[], options: { signal: AbortSignal }) =>
        new Promise((resolve) =>
          options.signal.addEventListener('abort', () => resolve({ success: false, exitCode: -1 }))
        )
    );
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const running = panel.extractResources(checkpointOption()?.id as string);
    await until(() => runMock.mock.calls.length === 1);
    panel.dispose();
    await running;
    expect(runMock.mock.calls[0][2].signal.aborted).toBe(true);
  });

  it('clears the extraction and shows the error when the extraction throws, and throws nothing', async () => {
    project();
    (vscode.window.withProgress as jest.Mock).mockImplementation(() => {
      throw new Error('progress is not available');
    });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const before = last().selected;
    const id = checkpointOption()?.id as string;
    await expect(panel.extractResources(id)).resolves.toBeUndefined();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Resources: progress is not available'
    );
    expect(last().extracting).toBeUndefined();
    expect(last().selected).toBe(before);
    // A new extraction can start.
    vivadoWritesReports();
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
        task({ report: jest.fn() }, { onCancellationRequested: jest.fn() })
    );
    await panel.extractResources(id);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('shows the checkpoint, not the storage, as the file of the extracted source', async () => {
    const dcp = project();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.extractResources(checkpointOption()?.id as string);
    const extracted = last().sources.find((s) => s.stage === 'routed');
    expect(extracted?.fileName).toBe(path.relative(workspace, dcp));
    expect(last().report?.source.fileName).toBe(path.relative(workspace, dcp));
  });

  it('dates the extracted report by the checkpoint for the older-than-design notice', async () => {
    const dcp = project();
    const design = path.join(workspace, 'sys.bd');
    fs.writeFileSync(design, '');
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    // The checkpoint is older than the design; the extraction (just now) is newer.
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(dcp, old, old);
    await panel.extractResources(checkpointOption()?.id as string);
    expect(last().notice?.kind).toBe('olderThanDesign');
  });

  it('starts no further Vivado run once the extraction was cancelled', async () => {
    put('', 'proj.xpr');
    for (const ip of ['sys_axi_bram_ctrl_0_0', 'sys_axi_gpio_1_0']) {
      put('', 'proj.runs', `${ip}_synth_1`, `${ip}.dcp`);
    }
    let cancel: () => void = () => undefined;
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
        task(
          { report: jest.fn() },
          { onCancellationRequested: (handler: () => void) => (cancel = handler) }
        )
    );
    // The first run finishes normally at the moment the user cancels.
    runMock.mockImplementation((_exe: string, args: string[], options: { cwd: string }) => {
      fs.copyFileSync(
        path.join(FIXTURES, 'ooc/sys_axi_bram_ctrl_0_0_utilization_synth.rpt'),
        path.join(options.cwd, args.at(-1) as string)
      );
      cancel();
      return Promise.resolve({ success: true, exitCode: 0 });
    });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const ooc = last().sources.find((s) => s.stage === 'ooc');
    await panel.extractResources(ooc?.id as string);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('extracts a group whose IPs were all cache hits, keeping its id', async () => {
    put('', 'proj.xpr');
    for (const ip of ['sys_axi_gpio_0_0', 'sys_axi_gpio_1_0']) {
      put('', 'proj.runs', `${ip}_synth_1`, `${ip}.dcp`);
    }
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const group = last().sources.find((s) => s.stage === 'ooc');
    expect(group).toMatchObject({
      label: 'Per-IP OOC (0 of 5 IPs)',
      usable: false,
      extractable: true,
      missing: 2,
    });
    expect(last().selected).toBeUndefined();

    await panel.extractResources(group?.id as string);
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(last().selected).toBe(group?.id);
    expect(last().sources.find((s) => s.stage === 'ooc')).toMatchObject({
      label: 'Per-IP OOC (2 of 5 IPs)',
      usable: true,
    });
    expect(last().report?.stage).toBe('ooc');
  });

  it('extracts an attached checkpoint, whose stage then comes from the report', async () => {
    const dcp = path.join(root, 'downloads', 'build.dcp');
    fs.mkdirSync(path.dirname(dcp), { recursive: true });
    fs.writeFileSync(dcp, 'checkpoint');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: dcp }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    const id = last().selected as string;
    expect(last().sources[0]).toMatchObject({
      extractable: true,
      usable: false,
      label: 'build.dcp',
    });
    expect(last().sources[0].stage).toBeUndefined();

    await panel.extractResources(id);
    expect(last().selected).toBe(id);
    expect(last().sources[0]).toMatchObject({ usable: true, stage: 'routed', origin: 'attached' });
    expect(last().sources[0].extractable).toBeUndefined();
    expect(last().report?.stage).toBe('routed');
  });

  it('extracts the IPs that lack a report, one run each, into the cache', async () => {
    put('', 'proj.xpr');
    for (const ip of ['sys_axi_gpio_0_0', 'sys_bram_0_0']) {
      put(
        `ooc/${ip}_utilization_synth.rpt`,
        'proj.runs',
        `${ip}_synth_1`,
        `${ip}_utilization_synth.rpt`
      );
    }
    for (const ip of ['sys_axi_bram_ctrl_0_0', 'sys_axi_gpio_1_0']) {
      put('', 'proj.runs', `${ip}_synth_1`, `${ip}.dcp`);
    }
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const ooc = last().sources.find((s) => s.stage === 'ooc');
    expect(ooc).toMatchObject({
      label: 'Per-IP OOC (2 of 5 IPs)',
      missing: 2,
      extractable: true,
      usable: true,
    });

    await panel.extractResources(ooc?.id as string);
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock.mock.calls.map((c: [string, string[]]) => c[1].at(-1))).toEqual([
      'sys_axi_bram_ctrl_0_0_utilization_synth.rpt',
      'sys_axi_gpio_1_0_utilization_synth.rpt',
    ]);
    expect(last().selected).toBe(ooc?.id);
    expect(last().sources.find((s) => s.stage === 'ooc')).toMatchObject({
      label: 'Per-IP OOC (4 of 5 IPs)',
    });
    expect(last().sources.find((s) => s.stage === 'ooc')?.extractable).toBeUndefined();
  });
});

describe('PanelResources: comparing two sources', () => {
  function stages(): void {
    put('', 'proj.xpr');
    put('routed_hier.rpt', 'proj.runs', 'impl_1', 'impl_hier.rpt');
    put('synth_hier.rpt', 'proj.runs', 'synth_1', 'synth_hier.rpt');
  }
  const idOf = (stage: string) => last().sources.find((s) => s.stage === stage)?.id as string;

  it('maps a second source onto the same graph and posts it beside the chosen one', async () => {
    stages();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(last().compare).toBeUndefined();

    await panel.compareResourceSource(idOf('synth'));
    expect(last().report?.stage).toBe('routed');
    expect(last().compare?.id).toBe(idOf('synth'));
    expect(last().compare?.report).toMatchObject({ stage: 'synth', root: last().report?.root });
    expect(last().compare?.report.instances['/axi_gpio_0']).toBeDefined();
  });

  it('maps the compared source again for each new graph, without a new discovery', async () => {
    stages();
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.compareResourceSource(idOf('synth'));
    fs.rmSync(path.join(workspace, 'proj.runs'), { recursive: true });

    const { '/axi_gpio_0': removed, ...instances } = bd.instances;
    expect(removed).toBeDefined();
    const count = resourceMessages().length;
    panel.onGraph({ ...bd, instances });
    await until(() => resourceMessages().length === count + 1);
    expect(last().compare?.report.instances['/axi_gpio_0']).toBeUndefined();
    expect(last().compare?.report.instances['/hier_0/axi_gpio_1']).toBeDefined();
  });

  it('clears it with no id, when it is the chosen source, or when it is not usable or unknown', async () => {
    stages();
    put('', 'proj.runs', 'impl_2', 'x_routed.dcp');
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();

    await panel.compareResourceSource(idOf('synth'));
    expect(last().compare).toBeDefined();
    await panel.compareResourceSource();
    expect(last().compare).toBeUndefined();

    await panel.compareResourceSource(idOf('synth'));
    await panel.select(idOf('synth'));
    expect(last().compare).toBeUndefined();

    await panel.compareResourceSource(idOf('routed'));
    expect(last().compare).toBeDefined();
    await panel.compareResourceSource(last().selected);
    expect(last().compare).toBeUndefined();

    await panel.compareResourceSource('project:nope');
    expect(last().compare).toBeUndefined();
    const checkpoint = last().sources.find((s) => s.extractable);
    await panel.compareResourceSource(checkpoint?.id);
    expect(last().compare).toBeUndefined();
  });

  it('drops the compared source when it is removed', async () => {
    stages();
    const file = path.join(root, 'ci_report.rpt');
    fs.copyFileSync(path.join(FIXTURES, 'synth_hier.rpt'), file);
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: file }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    const attached = last().sources.find((s) => s.origin === 'attached')?.id as string;
    await panel.select(idOf('routed'));
    await panel.compareResourceSource(attached);
    expect(last().compare?.id).toBe(attached);

    await panel.remove(attached);
    expect(last().compare).toBeUndefined();
  });
});
