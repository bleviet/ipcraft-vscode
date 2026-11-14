import * as path from 'path';
import * as vscode from 'vscode';
import { ExportTargets } from '../../../providers/imageExport/ExportTargets';
import { ImageExportHost } from '../../../providers/imageExport/ImageExportHost';
import { renderIpSymbolImage } from '../../../services/render/ipSymbolImage';
import { renderSystemLevelImage } from '../../../services/render/systemLevelImage';
import { RenderAssets } from '../../../services/render/renderResources';
import type { RenderRoots } from '../../../services/render/imageEncoding';
import { DEFAULT_EXPORT_OPTIONS } from '../../../shared/messages/imageExport';
import { Logger } from '../../../utils/Logger';
import { buildChangeMarks, type ChangeMarks } from '../../../webview/systemDiagram/changeMarks';
import { loadFixtureGraph } from '../webview/systemDiagram/fixtureGraph';
import { zynqDiff, zynqGraph } from '../webview/systemDiagram/compareFixtures';

jest.mock('../../../services/render/systemLevelImage', () => ({
  ...jest.requireActual<object>('../../../services/render/systemLevelImage'),
  renderSystemLevelImage: jest.fn(),
}));
jest.mock('../../../services/render/ipSymbolImage', () => ({
  ...jest.requireActual<object>('../../../services/render/ipSymbolImage'),
  renderIpSymbolImage: jest.fn(),
}));

const BYTES = new Uint8Array([1, 2, 3]);
const document = {
  uri: { fsPath: '/ws/ip/core.ip.yml' },
  fileName: '/ws/ip/core.ip.yml',
  getText: () => 'vlnv: { vendor: acme, library: lib, name: My_Core, version: 1.0.0 }\n',
} as unknown as vscode.TextDocument;

const view = {
  levelPath: '/dsp/fir',
  expanded: ['/dsp'],
  isolate: { nodeIds: ['/a'], hops: 2 },
  clocks: true,
  selectedNodeIds: ['/a'],
  visibleNodeIds: ['/a', '/b'],
};

function setup(stored?: unknown) {
  const store = new Map<string, unknown>(
    stored === undefined ? [] : [['ipcraft.exportImage.systemDiagram', stored]]
  );
  const memento = {
    get: jest.fn((key: string) => store.get(key)),
    update: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  } as unknown as vscode.Memento;
  const logger = { error: jest.fn() } as unknown as Logger;
  const host = new ImageExportHost({
    memento,
    assets: new RenderAssets(),
    roots: {} as RenderRoots,
    logger,
  });
  return { host, memento, store, logger };
}

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.Uri.joinPath as jest.Mock).mockImplementation(
    (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: path.posix.join(base.fsPath, ...parts),
    })
  );
  (renderSystemLevelImage as jest.Mock).mockResolvedValue(BYTES);
  (renderIpSymbolImage as jest.Mock).mockResolvedValue(BYTES);
  (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({ fsPath: '/out/x.png' });
  (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
  (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);
});

describe('ImageExportHost.exportSystem', () => {
  const graph = loadFixtureGraph();

  it('renders the view state, saves under <design>-<level>.png and offers Open', async () => {
    const { host } = setup();
    await host.exportSystem(document, graph, { options: DEFAULT_EXPORT_OPTIONS, view });

    expect(renderSystemLevelImage).toHaveBeenCalledWith(
      graph,
      {
        level: '/dsp/fir',
        expanded: ['/dsp'],
        isolate: { nodeIds: ['/a'], hops: 2 },
        selectedNodeIds: ['/a'],
        clocks: true,
        cropNodeIds: ['/a', '/b'],
      },
      expect.objectContaining({ theme: 'light', grid: true, legend: true, background: 'editor' }),
      expect.objectContaining({ format: 'png', scale: 2 }),
      expect.anything(),
      expect.anything()
    );
    const save = (vscode.window.showSaveDialog as jest.Mock).mock.calls[0][0];
    expect(save.defaultUri.fsPath).toBe(`/ws/ip/${graph.name}-dsp_fir.png`);
    expect(save.filters).toEqual({ PNG: ['png'] });
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith({ fsPath: '/out/x.png' }, BYTES);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Exported x.png',
      'Open',
      'Reveal in Explorer'
    );
  });

  it('names the root level after the design alone and draws the whole level without a crop', async () => {
    const { host } = setup();
    await host.exportSystem(document, graph, {
      options: { ...DEFAULT_EXPORT_OPTIONS, area: 'whole', format: 'svg' },
      view: { ...view, levelPath: '/' },
    });
    expect((renderSystemLevelImage as jest.Mock).mock.calls[0][1].cropNodeIds).toBeUndefined();
    const save = (vscode.window.showSaveDialog as jest.Mock).mock.calls[0][0];
    expect(save.defaultUri.fsPath).toBe(`/ws/ip/${graph.name}.svg`);
    expect(save.filters).toEqual({ SVG: ['svg'] });
  });

  it('does nothing when the save dialog is cancelled', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined);
    const { host } = setup();
    await host.exportSystem(document, graph, { options: DEFAULT_EXPORT_OPTIONS, view });
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('shows an error when the file cannot be written', async () => {
    (vscode.workspace.fs.writeFile as jest.Mock).mockRejectedValue(new Error('disk full'));
    const { host } = setup();
    await host.exportSystem(document, graph, { options: DEFAULT_EXPORT_OPTIONS, view });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not export the image: disk full'
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('shows an error, without asking where to save, when the render fails', async () => {
    (renderSystemLevelImage as jest.Mock).mockRejectedValue(new Error('layout failed'));
    const { host } = setup();
    await host.exportSystem(document, graph, { options: DEFAULT_EXPORT_OPTIONS, view });
    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not export the image: layout failed'
    );
  });

  it('reports an empty current view instead of exporting', async () => {
    const { host } = setup();
    await host.exportSystem(document, graph, {
      options: DEFAULT_EXPORT_OPTIONS,
      view: { ...view, visibleNodeIds: [] },
    });
    expect(renderSystemLevelImage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('No block is in the current view')
    );
  });

  it('rejects a malformed view and invalid options fall back to the defaults', async () => {
    const { host } = setup();
    await host.exportSystem(document, graph, { options: { format: 'bmp', scale: 99 }, view: {} });
    expect(renderSystemLevelImage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not export the image: The design is not loaded.'
    );
  });

  describe('comparison marks', () => {
    const current = zynqGraph('current');
    const diff = zynqDiff();
    const requestOf = () =>
      (renderSystemLevelImage as jest.Mock).mock.calls[0][1] as { changes?: ChangeMarks };

    it('draws the marks of the diff when the view says they are on the canvas', async () => {
      const { host } = setup();
      await host.exportSystem(
        document,
        current,
        { options: DEFAULT_EXPORT_OPTIONS, view: { ...view, marks: true } },
        diff
      );
      expect(requestOf().changes?.blocks.get('/axis_data_fifo_0')?.status).toBe('added');
      expect(requestOf().changes).toEqual(buildChangeMarks(diff, current));
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
    });

    it.each([false, undefined])('draws no marks when marks is %s', async (marks) => {
      const { host } = setup();
      await host.exportSystem(
        document,
        current,
        { options: DEFAULT_EXPORT_OPTIONS, view: { ...view, marks } },
        diff
      );
      expect(requestOf()).not.toHaveProperty('changes');
    });

    it('draws no marks, and no error, when the comparison ended before the message arrived', async () => {
      const { host } = setup();
      await host.exportSystem(document, current, {
        options: DEFAULT_EXPORT_OPTIONS,
        view: { ...view, marks: true },
      });
      expect(requestOf()).not.toHaveProperty('changes');
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
    });
  });

  it('opens or reveals the file from the notification', async () => {
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Reveal in Explorer');
    const { host } = setup();
    await host.exportSystem(document, graph, { options: DEFAULT_EXPORT_OPTIONS, view });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('revealFileInOS', {
      fsPath: '/out/x.png',
    });
  });
});

describe('ImageExportHost view errors and file extension', () => {
  const graph = loadFixtureGraph();

  it('writes nothing and explains when the file name does not match the format', async () => {
    const target = { fsPath: '/out/x.png' };
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(target);
    const { host } = setup();
    await host.exportSystem(document, graph, {
      options: { ...DEFAULT_EXPORT_OPTIONS, format: 'svg' },
      view,
    });
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('The file name ends in .png, but the format is SVG')
    );
  });

  it('writes to the URI the dialog returned, unchanged', async () => {
    const target = { fsPath: '/out/x.png', scheme: 'vscode-remote' };
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(target);
    const { host } = setup();
    await host.exportSystem(document, graph, { options: DEFAULT_EXPORT_OPTIONS, view });
    expect((vscode.workspace.fs.writeFile as jest.Mock).mock.calls[0][0]).toBe(target);
  });

  it('accepts .jpeg for JPG', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({ fsPath: '/out/x.jpeg' });
    const { host } = setup();
    await host.exportSystem(document, graph, {
      options: { ...DEFAULT_EXPORT_OPTIONS, format: 'jpg' },
      view,
    });
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith({ fsPath: '/out/x.jpeg' }, BYTES);
  });

  it('errors instead of exporting the whole level when the visible nodes are missing', async () => {
    const { host } = setup();
    await host.exportSystem(document, graph, {
      options: DEFAULT_EXPORT_OPTIONS,
      view: { ...view, visibleNodeIds: undefined },
    });
    expect(renderSystemLevelImage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('The view is not ready yet')
    );
  });

  it('errors when the IP view has no valid rectangle', async () => {
    const { host } = setup();
    await host.exportIpCore(document, jest.fn().mockResolvedValue({}), {
      options: DEFAULT_EXPORT_OPTIONS,
      view: {},
    });
    expect(renderIpSymbolImage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('The block diagram is not showing')
    );
  });

  it('errors for Current view while a bus bundle is expanded, but exports the whole symbol', async () => {
    const { host } = setup();
    const message = {
      options: DEFAULT_EXPORT_OPTIONS,
      view: { visibleRect: { x: 0, y: 0, width: 5, height: 5 }, bundlesExpanded: true },
    };
    await host.exportIpCore(document, jest.fn().mockResolvedValue({}), message);
    expect(renderIpSymbolImage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Current view needs every bus bundle collapsed')
    );

    await host.exportIpCore(document, jest.fn().mockResolvedValue({}), {
      ...message,
      options: { ...DEFAULT_EXPORT_OPTIONS, area: 'whole' },
    });
    expect(renderIpSymbolImage).toHaveBeenCalledTimes(1);
  });

  it('treats a null isolation as a malformed view', async () => {
    const { host } = setup();
    await host.exportSystem(document, graph, {
      options: DEFAULT_EXPORT_OPTIONS,
      view: { ...view, isolate: null },
    });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not export the image: The design is not loaded.'
    );
  });
});

describe('remembered options', () => {
  it('round-trips the last options per editor kind and keeps JPG opaque', async () => {
    const { host, memento } = setup();
    expect(host.rememberedOptions('systemDiagram')).toBeUndefined();
    const chosen = {
      ...DEFAULT_EXPORT_OPTIONS,
      format: 'jpg',
      theme: 'dark',
      background: 'transparent',
    };
    await host.exportSystem(document, loadFixtureGraph(), { options: chosen, view });

    expect(memento.update).toHaveBeenCalledWith(
      'ipcraft.exportImage.systemDiagram',
      expect.objectContaining({ format: 'jpg', theme: 'dark', background: 'editor' })
    );
    expect(host.rememberedOptions('systemDiagram')).toMatchObject({ format: 'jpg', theme: 'dark' });
    expect(host.rememberedOptions('ipCore')).toBeUndefined();
  });

  it('repairs invalid stored values field by field', () => {
    const { host } = setup({ format: 'svg', scale: 'huge', grid: 'yes' });
    expect(host.rememberedOptions('systemDiagram')).toEqual({
      ...DEFAULT_EXPORT_OPTIONS,
      format: 'svg',
    });
  });
});

describe('ImageExportHost.exportIpCore', () => {
  const library = jest.fn().mockResolvedValue({});

  it('saves under <ip-name>.svg with the visible rectangle as the crop', async () => {
    const { host } = setup();
    const visibleRect = { x: 10, y: 20, width: 300, height: 200 };
    await host.exportIpCore(document, library, {
      options: { ...DEFAULT_EXPORT_OPTIONS, format: 'svg' },
      view: { visibleRect },
    });
    expect((renderIpSymbolImage as jest.Mock).mock.calls[0][2]).toEqual({ crop: visibleRect });
    const save = (vscode.window.showSaveDialog as jest.Mock).mock.calls[0][0];
    expect(save.defaultUri.fsPath).toBe('/ws/ip/my_core.svg');
  });

  it('draws the whole symbol for the whole-diagram area', async () => {
    const { host } = setup();
    await host.exportIpCore(document, library, {
      options: { ...DEFAULT_EXPORT_OPTIONS, area: 'whole' },
      view: { visibleRect: { x: 0, y: 0, width: 1, height: 1 } },
    });
    expect((renderIpSymbolImage as jest.Mock).mock.calls[0][2]).toEqual({ crop: undefined });
  });
});

describe('ExportTargets', () => {
  it('asks only the active editor to open its export options', () => {
    const targets = new ExportTargets();
    const panel = (active: boolean) =>
      ({ active, webview: { postMessage: jest.fn() } }) as unknown as vscode.WebviewPanel;
    const idle = panel(false);
    const active = panel(true);
    const first = targets.register(idle, 'ipCore');
    targets.register(active, 'systemDiagram');

    expect(targets.openActive()).toBe(true);
    expect(idle.webview.postMessage).not.toHaveBeenCalled();
    expect(active.webview.postMessage).toHaveBeenCalledWith({ type: 'openExport' });

    first.dispose();
    (active as { active: boolean }).active = false;
    expect(targets.openActive()).toBe(false);
  });
});
