import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readBdJson } from '../../../parser/system/BdJsonReader';
import { readQsys } from '../../../parser/system/QsysReader';
import { PanelResources } from '../../../providers/systemDiagram/PanelResources';
import type {
  DiagramResources,
  SystemDiagramToWebviewMessage,
} from '../../../shared/messages/systemDiagram';
import { quartusFixture, vivadoFixture } from '../services/resources/fixtures';

const FIXTURES = path.join(__dirname, '../../fixtures/reports');
const DESIGN_URI = 'file:///project/sys.bd';
const SELECTED_KEY = `ipcraft.resources.selected:${DESIGN_URI}`;
const OOC_IPS = [
  'sys_axi_bram_ctrl_0_0',
  'sys_axi_gpio_0_0',
  'sys_bram_0_0',
  'sys_smartconnect_0_0',
];

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');
const qsys = readQsys(quartusFixture('sys.qsys'), 'sys.qsys');

interface FakeWatcher {
  file: string;
  change: () => void;
  dispose: jest.Mock;
}

let root: string;
let workspace: string;
let downloads: string;
let storage: string;
let posted: SystemDiagramToWebviewMessage[];
let watchers: FakeWatcher[];
let state: Map<string, unknown>;
let panels: PanelResources[];

function put(from: string, ...to: string[]): string {
  const target = path.join(workspace, ...to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (from === '') {
    fs.writeFileSync(target, '');
  } else {
    fs.copyFileSync(path.join(FIXTURES, from), target);
  }
  return target;
}

function putText(text: string, ...to: string[]): string {
  const target = path.join(workspace, ...to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  return target;
}

function download(name: string, from: string): string {
  const target = path.join(downloads, name);
  fs.mkdirSync(downloads, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, from), target);
  return target;
}

function vivadoRuns(parts: { routed?: boolean; placed?: boolean; synth?: boolean; ooc?: boolean }) {
  put('', 'proj.xpr');
  if (parts.routed) {
    put('vivado/spike/routed_hier.rpt', 'proj.runs', 'impl_1', 'impl_hier.rpt');
    put('vivado/spike/routed_flat.rpt', 'proj.runs', 'impl_1', 'impl_flat.rpt');
  }
  if (parts.placed) {
    const text = vivadoFixture('routed_hier.rpt').replace(
      'Design State : Routed',
      'Design State : Placed'
    );
    putText(text, 'proj.runs', 'impl_2', 'placed_hier.rpt');
  }
  if (parts.synth) {
    put('vivado/spike/synth_hier.rpt', 'proj.runs', 'synth_1', 'synth_hier.rpt');
  }
  if (parts.ooc) {
    for (const ip of OOC_IPS) {
      put(
        `vivado/spike/ooc/${ip}_utilization_synth.rpt`,
        'proj.runs',
        `${ip}_synth_1`,
        `${ip}_utilization_synth.rpt`
      );
    }
  }
}

function newPanel(designName = 'sys.bd', designUri = DESIGN_URI): PanelResources {
  const panel = new PanelResources({
    document: {
      uri: { toString: () => designUri, fsPath: path.join(workspace, designName) },
      fileName: path.join(workspace, designName),
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

const resourceMessages = (): DiagramResources[] =>
  posted.flatMap((m) => (m.type === 'resources' ? [m.resources] : []));
const last = (): DiagramResources => resourceMessages().at(-1) as DiagramResources;

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-panel-'));
  workspace = path.join(root, 'project');
  downloads = path.join(root, 'downloads');
  storage = path.join(root, 'storage');
  fs.mkdirSync(workspace, { recursive: true });
  posted = [];
  watchers = [];
  state = new Map();
  panels = [];
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
  (vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation(
    (pattern: { base: { fsPath: string }; pattern: string }) => {
      let change = () => undefined as void;
      const watcher: FakeWatcher = {
        file: path.join(pattern.base.fsPath, pattern.pattern),
        change: () => change(),
        dispose: jest.fn(),
      };
      watchers.push(watcher);
      return {
        onDidChange: (handler: () => void) => {
          change = handler;
        },
        onDidCreate: jest.fn(),
        onDidDelete: jest.fn(),
        dispose: watcher.dispose,
      };
    }
  );
});

afterEach(() => {
  panels.forEach((panel) => panel.dispose());
  fs.rmSync(root, { recursive: true, force: true });
});

describe('PanelResources: loading', () => {
  it('reads nothing until the webview asks', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posted).toEqual([]);
    expect(watchers).toEqual([]);

    await panel.load();
    expect(resourceMessages()).toHaveLength(1);
    // The flat report of the stage only serves as capacity.
    expect(last().sources.map((s) => s.label)).toEqual(['Post-route (impl_1)']);
  });

  it('waits for the first final graph when resources are turned on before it', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    await panel.load();
    expect(posted).toEqual([]);

    panel.onGraph(bd);
    await until(() => resourceMessages().length === 1);
    expect(last().report?.root).toBe('sys_wrapper/sys_i');
  });

  it('posts the sources, the numbers of the chosen one, the searched folders and the Tcl line', async () => {
    vivadoRuns({ routed: true, ooc: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();

    const resources = last();
    const hier = resources.sources.find((s) => s.usable && s.stage === 'routed');
    expect(hier).toMatchObject({
      vendor: 'vivado',
      origin: 'project',
      fileName: path.join('proj.runs', 'impl_1', 'impl_hier.rpt'),
      date: 'Sat Nov 21 03:51:54 2026',
    });
    expect(resources.selected).toBe(hier?.id);
    expect(resources.report).toMatchObject({ vendor: 'vivado', stage: 'routed' });
    expect(resources.report?.metrics.find((m) => m.key === 'lut')?.capacity).toBe(63400);
    expect(resources.searched).toEqual(['', 'proj.runs']);
    expect(resources.hierarchicalTcl).toBe(
      'report_utilization -hierarchical -file sys_utilization_hier.rpt'
    );
    expect(resources.sources.find((s) => s.stage === 'ooc')?.fileName).toBe('proj.runs');
  });

  it('gives the chosen report as last mapped, and none before the reports are loaded', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    expect(panel.currentReport()).toBeUndefined();
    await panel.load();
    expect(panel.currentReport()).toBeDefined();
    expect(panel.currentReport()).toBe(last().report);
  });

  it('turning it on a second time posts the state again without a new discovery', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    fs.rmSync(path.join(workspace, 'proj.runs'), { recursive: true });
    await panel.load();
    expect(resourceMessages()).toHaveLength(2);
    expect(last().report).toBeDefined();
  });
});

describe('PanelResources: choosing a source', () => {
  it.each([
    [
      'routed before placed, synthesis and OOC',
      { routed: true, placed: true, synth: true, ooc: true },
      'routed',
    ],
    ['placed before synthesis and OOC', { placed: true, synth: true, ooc: true }, 'placed'],
    ['synthesis before OOC', { synth: true, ooc: true }, 'synth'],
    ['OOC when it is all there is', { ooc: true }, 'ooc'],
  ])('defaults to %s', async (_name, parts, stage) => {
    vivadoRuns(parts);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const resources = last();
    const chosen = resources.sources.find((s) => s.id === resources.selected);
    expect(chosen?.stage).toBe(stage);
    expect(resources.report?.stage).toBe(stage);
  });

  it('prefers the fitter report to the synthesis report of a Quartus project', async () => {
    put('', 'spike.qpf');
    put('quartus/platform_designer_system/spike.map.rpt', 'spike.map.rpt');
    put('quartus/platform_designer_system/spike.fit.rpt', 'spike.fit.rpt');
    put('quartus/platform_designer_system/spike.fit.summary', 'spike.fit.summary');
    const panel = newPanel('sys.qsys');
    panel.onGraph(qsys);
    await panel.load();
    expect(last().report).toMatchObject({ vendor: 'quartus', stage: 'fit' });
    expect(last().report?.metrics.find((m) => m.key === 'alm')?.capacity).toBe(32070);
  });

  it('never defaults to a refused source', async () => {
    put('', 'proj.xpr');
    put('vivado/spike/routed_flat.rpt', 'proj.runs', 'impl_1', 'impl_flat.rpt');
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(last().sources).toHaveLength(1);
    expect(last().selected).toBeUndefined();
    expect(last().report).toBeUndefined();
  });

  it('remembers the choice per design', async () => {
    vivadoRuns({ routed: true, ooc: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    const ooc = last().sources.find((s) => s.stage === 'ooc');
    await panel.select(ooc?.id as string);
    expect(last().report?.stage).toBe('ooc');
    expect(state.get(SELECTED_KEY)).toBe(ooc?.id);

    const again = newPanel();
    again.onGraph(bd);
    await again.load();
    expect(last().selected).toBe(ooc?.id);

    const other = newPanel('sys.bd', 'file:///project/other.bd');
    other.onGraph(bd);
    await other.load();
    expect(last().report?.stage).toBe('routed');
  });

  it('ignores a source id it does not know', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.select('project:nope');
    expect(resourceMessages()).toHaveLength(1);
  });

  it('keeps the chosen design root', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.chooseRoot('not/a/root');
    expect(state.has(`ipcraft.resources.root:${DESIGN_URI}`)).toBe(false);
    await panel.chooseRoot('sys_wrapper/sys_i');
    expect(state.get(`ipcraft.resources.root:${DESIGN_URI}`)).toBe('sys_wrapper/sys_i');
    expect(last().report?.root).toBe('sys_wrapper/sys_i');
  });
});

describe('PanelResources: a new graph', () => {
  it('maps the chosen report onto it without looking for reports again', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(last().report?.instances['/axi_gpio_0']).toBeDefined();
    // Reports found again would be gone: this proves the graph is mapped from what was read.
    fs.rmSync(path.join(workspace, 'proj.runs'), { recursive: true });

    const { '/axi_gpio_0': removed, ...instances } = bd.instances;
    expect(removed).toBeDefined();
    panel.onGraph({ ...bd, instances });
    await until(() => resourceMessages().length === 2);

    expect(last().report?.instances['/axi_gpio_0']).toBeUndefined();
    expect(last().report?.instances['/hier_0/axi_gpio_1']).toBeDefined();
    expect(last().sources).toHaveLength(1);
  });
});

describe('PanelResources: notices', () => {
  it('says why a refused source is refused', async () => {
    put('', 'proj.xpr');
    put('vivado/spike/routed_flat.rpt', 'proj.runs', 'impl_1', 'impl_flat.rpt');
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.select(last().sources[0].id);

    expect(last().report).toBeUndefined();
    expect(last().notice?.kind).toBe('refused');
    expect(last().notice?.message).toContain('-hierarchical');
  });

  it('says when the design is not in the report', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph({ ...bd, name: 'other' });
    await panel.load();
    expect(last().report?.root).toBeUndefined();
    expect(last().notice).toEqual({
      kind: 'rootMissing',
      message: 'This report is a build of sys_wrapper, not of the design other.',
    });
  });

  it('says when a project report is older than the design file', async () => {
    vivadoRuns({ routed: true });
    const design = put('', 'sys.bd');
    const report = path.join(workspace, 'proj.runs', 'impl_1', 'impl_hier.rpt');
    const now = Date.now() / 1000;
    fs.utimesSync(report, now - 7200, now - 7200);
    fs.utimesSync(design, now - 60, now - 60);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(last().notice).toEqual({
      kind: 'olderThanDesign',
      message: 'The report is older than the design file',
    });

    fs.utimesSync(design, now - 8000, now - 8000);
    panel.onGraph(bd);
    await until(() => resourceMessages().length === 2);
    expect(last().notice).toBeUndefined();
  });

  it('shows the header date of an attached copy, not a staleness warning', async () => {
    const file = download('ci_report.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: file }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.attachReport();

    expect(last().selected).toMatch(/^attached:/);
    expect(last().sources[0]).toMatchObject({
      origin: 'attached',
      fileName: 'ci_report.rpt',
      label: 'Post-route (ci_report.rpt)',
      usable: true,
    });
    expect(last().report?.stage).toBe('routed');
    expect(last().notice).toEqual({
      kind: 'reportDate',
      message: 'Report from Sat Nov 21 03:51:54 2026',
    });
  });
});

describe('PanelResources: files that cannot be read', () => {
  it('still posts the sources when a report in a run folder is unreadable', async () => {
    vivadoRuns({ routed: true });
    fs.symlinkSync(
      path.join(root, 'missing.rpt'),
      path.join(workspace, 'proj.runs', 'impl_1', 'broken.rpt')
    );
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();

    expect(resourceMessages()).toHaveLength(1);
    expect(last().report?.stage).toBe('routed');
    const broken = last().sources.find((s) => s.fileName.endsWith('broken.rpt'));
    expect(broken?.usable).toBe(false);
    expect(broken?.reason).toContain('broken.rpt could not be read');
    expect(broken?.reason).not.toContain(root);
  });

  it('attaches the good file when another one chosen with it is unreadable', async () => {
    const good = download('good.rpt', 'vivado/spike/routed_hier.rpt');
    const broken = path.join(downloads, 'broken.rpt');
    fs.symlinkSync(path.join(root, 'missing.rpt'), broken);
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([
      { fsPath: broken },
      { fsPath: good },
    ]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();

    expect(last().sources).toHaveLength(1);
    expect(last().sources.find((s) => s.id === last().selected)?.fileName).toBe('good.rpt');
    expect(last().report?.stage).toBe('routed');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Could not attach: broken.rpt');
  });

  it('keeps a report usable without percentages when its capacity file is gone', async () => {
    vivadoRuns({ routed: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(last().report?.metrics.find((m) => m.key === 'lut')?.capacity).toBe(63400);

    fs.rmSync(path.join(workspace, 'proj.runs', 'impl_1', 'impl_flat.rpt'));
    await panel.select(last().selected as string);
    expect(last().sources[0].usable).toBe(true);
    expect(last().report?.stage).toBe('routed');
    expect(last().report?.metrics.find((m) => m.key === 'lut')?.capacity).toBeUndefined();
  });
});

describe('PanelResources: watching', () => {
  it('watches the linked files of the chosen source and disposes them when the choice changes', async () => {
    vivadoRuns({ routed: true, ooc: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();

    const impl = path.join(workspace, 'proj.runs', 'impl_1');
    expect(watchers.map((w) => w.file).sort()).toEqual([
      path.join(impl, 'impl_flat.rpt'),
      path.join(impl, 'impl_hier.rpt'),
    ]);
    expect(watchers.every((w) => w.dispose.mock.calls.length === 0)).toBe(true);

    const first = [...watchers];
    await panel.select(last().sources.find((s) => s.stage === 'ooc')?.id as string);
    expect(first.every((w) => w.dispose.mock.calls.length === 1)).toBe(true);
    expect(watchers).toHaveLength(2 + OOC_IPS.length);
    const second = watchers.slice(2);
    expect(second.every((w) => w.dispose.mock.calls.length === 0)).toBe(true);

    panel.dispose();
    expect(second.every((w) => w.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('reads the reports again when a watched file changes', async () => {
    vivadoRuns({ synth: true });
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    expect(last().report?.stage).toBe('synth');

    put('vivado/spike/routed_hier.rpt', 'proj.runs', 'impl_1', 'impl_hier.rpt');
    watchers[0].change();
    await until(() => resourceMessages().length === 2);
    expect(last().sources).toHaveLength(2);
    expect(last().report?.stage).toBe('routed');
  });

  it('does not watch an attached copy', async () => {
    const file = download('ci_report.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: file }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.attachReport();
    expect(watchers).toEqual([]);
  });
});

describe('PanelResources: attaching', () => {
  it('records a checkpoint as an attached source that is offered for extraction', async () => {
    const dcp = path.join(downloads, 'sys_wrapper_routed.dcp');
    fs.mkdirSync(downloads, { recursive: true });
    fs.writeFileSync(dcp, 'checkpoint');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: dcp }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        canSelectMany: true,
        defaultUri: expect.objectContaining({ fsPath: workspace }),
        filters: { Reports: ['rpt', 'summary', 'dcp'], 'All files': ['*'] },
      })
    );
    expect(last().sources).toEqual([
      expect.objectContaining({
        origin: 'attached',
        fileName: 'sys_wrapper_routed.dcp',
        usable: false,
        extractable: true,
        reason:
          'Extract the report from the checkpoint. This runs Vivado, about a minute for a small design.',
      }),
    ]);
    expect(last().report).toBeUndefined();
    // Not a refusal: the Extract button answers it.
    expect(last().notice).toBeUndefined();
  });

  it('selects the first usable of several attached files', async () => {
    const timing = download('timing.rpt', 'vivado/spike/sys_wrapper_timing_summary_routed.rpt');
    const hier = download('hier.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([
      { fsPath: timing },
      { fsPath: hier },
    ]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();

    expect(
      last()
        .sources.map((s) => s.usable)
        .sort()
    ).toEqual([false, true]);
    expect(last().sources.find((s) => s.id === last().selected)?.fileName).toBe('hier.rpt');
  });

  it('attaches a hierarchical report and the flat report of its stage as one record', async () => {
    const hier = download('hier.rpt', 'vivado/spike/routed_hier.rpt');
    const flat = download('flat.rpt', 'vivado/spike/routed_flat.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([
      { fsPath: hier },
      { fsPath: flat },
    ]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();

    expect(last().sources).toHaveLength(1);
    expect(last().sources[0]).toMatchObject({ fileName: 'hier.rpt', usable: true });
    expect(last().report?.metrics.find((m) => m.key === 'lut')?.capacity).toBe(63400);
    const copies = fs.readdirSync(path.join(storage, 'resource-reports'));
    expect(copies).toHaveLength(1);
    expect(fs.readdirSync(path.join(storage, 'resource-reports', copies[0])).sort()).toEqual([
      'flat.rpt',
      'hier.rpt',
    ]);
  });

  it('has the webview turn Resources on with the first message when it is the command', async () => {
    const hier = download('hier.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: hier }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport(true);

    const shows = posted.map((message) => (message as { show?: true }).show);
    expect(posted.length).toBeGreaterThan(1);
    expect(shows[0]).toBe(true);
    expect(shows.slice(1).every((show) => show === undefined)).toBe(true);
    expect(last().report).toBeDefined();
  });

  it('keeps the show request until there is a graph to post', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    const panel = newPanel();
    await panel.attachReport(true);
    expect(posted).toEqual([]);
    panel.onGraph(bd);
    await until(() => posted.length > 0);
    expect((posted[0] as { show?: true }).show).toBe(true);
  });

  it('does not ask the webview to turn Resources on for its own attach gesture', async () => {
    const hier = download('hier.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: hier }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    expect(posted.some((message) => 'show' in message)).toBe(false);
  });

  it('does nothing when the dialog is cancelled', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    expect(last().sources).toEqual([]);
  });

  it('links a report inside the workspace and watches it', async () => {
    const inside = put('vivado/spike/routed_hier.rpt', 'downloaded', 'ci.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: inside }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    expect(fs.existsSync(storage)).toBe(false);
    expect(watchers.map((w) => w.file)).toEqual([inside]);
    expect(last().sources[0].fileName).toBe(path.join('downloaded', 'ci.rpt'));
  });

  it('copies the usable reports found in a chosen folder', async () => {
    for (const name of [
      'routed_hier.rpt',
      'routed_flat.rpt',
      'sys_wrapper_timing_summary_routed.rpt',
    ]) {
      download(name, `vivado/spike/${name}`);
    }
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: downloads }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.load();
    await panel.chooseFolder();

    expect(vscode.window.showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ canSelectFolders: true, canSelectFiles: false })
    );
    expect(last().sources).toHaveLength(1);
    expect(last().sources[0]).toMatchObject({ origin: 'attached', fileName: 'routed_hier.rpt' });
    expect(last().report?.stage).toBe('routed');
    // The hierarchy report and the flat report that holds its capacity are copied together.
    const copies = fs.readdirSync(path.join(storage, 'resource-reports'));
    expect(copies).toHaveLength(1);
    expect(fs.readdirSync(path.join(storage, 'resource-reports', copies[0])).sort()).toEqual([
      'routed_flat.rpt',
      'routed_hier.rpt',
    ]);
    expect(last().report?.metrics.find((m) => m.key === 'lut')?.capacity).toBe(63400);
  });

  it('says so when a chosen folder has no usable report', async () => {
    download('routed_flat.rpt', 'vivado/spike/routed_flat.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: downloads }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.chooseFolder();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No usable resource report found')
    );
  });

  it('removes an attached source and its copy', async () => {
    const file = download('ci_report.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: file }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    const id = last().selected as string;

    await panel.remove('project:whatever');
    expect(last().sources).toHaveLength(1);
    await panel.remove(id);
    expect(last().sources).toEqual([]);
    expect(last().selected).toBeUndefined();
    expect(fs.readdirSync(path.join(storage, 'resource-reports'))).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('shows a source that cannot be read as unusable with the error, and throws nothing', async () => {
    const file = download('ci_report.rpt', 'vivado/spike/routed_hier.rpt');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: file }]);
    const panel = newPanel();
    panel.onGraph(bd);
    await panel.attachReport();
    const id = last().selected as string;
    fs.rmSync(path.join(storage, 'resource-reports'), { recursive: true });

    await expect(panel.select(id)).resolves.toBeUndefined();
    expect(last().report).toBeUndefined();
    expect(last().sources[0].usable).toBe(false);
    expect(last().sources[0].reason).toMatch(/ENOENT/);
    expect(last().notice).toMatchObject({
      kind: 'refused',
      message: expect.stringMatching(/ENOENT/),
    });
  });
});

describe('PanelResources: IPCraft builds', () => {
  /** `bd` with the gpio block defined by an `.ip.yml` that has an out-of-context build report. */
  function builtGraph(): typeof bd {
    const ipFile = putText('vlnv:\n  name: gpio\n', 'gpio', 'gpio.ip.yml');
    put(
      'vivado/spike/ooc/sys_axi_gpio_0_0_utilization_synth.rpt',
      'gpio',
      'xilinx',
      'build',
      'ooc',
      'utilization.rpt'
    );
    const gpio = {
      ...bd.instances['/axi_gpio_0'],
      definition: { kind: 'ip.yml' as const, file: ipFile, uri: ipFile, displayName: 'gpio' },
    };
    return { ...bd, instances: { ...bd.instances, '/axi_gpio_0': gpio } };
  }

  it('is the default only when no project report is usable', async () => {
    const panel = newPanel();
    panel.onGraph(builtGraph());
    await panel.load();
    expect(last().selected).toBe('project:ipBuilds');
    expect(last().sources.map((s) => s.label)).toEqual(['IPCraft builds (1 of 1 block)']);
    expect(last().report?.source.fileName).toBe('IPCraft builds');
    expect(last().report?.instances['/axi_gpio_0']).toBeDefined();
    expect(watchers.map((w) => path.basename(w.file))).toEqual(['utilization.rpt']);
  });

  it('is listed after the project reports and never preferred to one', async () => {
    vivadoRuns({ synth: true });
    const panel = newPanel();
    panel.onGraph(builtGraph());
    await panel.load();
    expect(last().sources.map((s) => s.stage)).toEqual(['synth', 'ooc']);
    expect(last().selected).not.toBe('project:ipBuilds');
    expect(last().report?.stage).toBe('synth');
  });
});
