import * as path from 'path';
import * as vscode from 'vscode';
import type { SystemGraph } from '../../domain/systemGraph';
import type { SystemGraphDiff, UnionAdditions } from '../../domain/systemGraphDiff';
import type { NormalizedBusLibrary } from '../../shared/busContracts';
import {
  DEFAULT_JPEG_QUALITY,
  parseExportRect,
  formatExtensionMismatch,
  parseSystemExportView,
  sanitizeExportOptions,
  systemExportFileName,
  type ExportImageFormat,
  type ExportImageOptions,
} from '../../shared/messages/imageExport';
import { withoutVersionOnly } from '../../services/systemDiagram/diff/ignoreVersionOnly';
import type { ImageEncoding, RenderLook, RenderRoots } from '../../services/render/imageEncoding';
import type { RenderAssets } from '../../services/render/renderResources';
import type { Logger } from '../../utils/Logger';
import type { ExportEditorKind } from './ExportTargets';

const FILTERS: Record<ExportImageFormat, Record<string, string[]>> = {
  svg: { SVG: ['svg'] },
  png: { PNG: ['png'] },
  jpg: { JPEG: ['jpg', 'jpeg'] },
};

const storageKey = (kind: ExportEditorKind) => `ipcraft.exportImage.${kind}`;

function lookAndEncoding(options: ExportImageOptions): [RenderLook, ImageEncoding] {
  return [
    {
      theme: options.theme,
      grid: options.grid,
      legend: options.legend,
      background: options.format === 'jpg' ? 'editor' : options.background,
    },
    { format: options.format, scale: options.scale, quality: DEFAULT_JPEG_QUALITY },
  ];
}

/**
 * The host side of Export image for both diagram editors: renders through the shared render
 * service (the one `ipcraft render` uses), asks where to save, writes the file and offers to open
 * it. The last options are kept per workspace and per editor kind.
 */
export class ImageExportHost {
  constructor(
    private readonly deps: {
      memento: vscode.Memento | undefined;
      assets: RenderAssets;
      roots: RenderRoots;
      logger: Logger;
    }
  ) {}

  /** The options of the last export of this kind, or undefined when there was none. */
  rememberedOptions(kind: ExportEditorKind): ExportImageOptions | undefined {
    const raw = this.deps.memento?.get<unknown>(storageKey(kind));
    return raw === undefined ? undefined : sanitizeExportOptions(raw);
  }

  /**
   * Exports the level the system viewer shows; `graph` is what the viewer got (unsaved edits
   * included) and `diff` the comparison it was published with, whose marks the image draws when
   * the view says they are on the canvas, and whose `union` (what only the base has) it lays the
   * level out with when the canvas does, drawing the ghosts when the view says they are on the
   * canvas too.
   */
  async exportSystem(
    document: vscode.TextDocument,
    graph: SystemGraph | undefined,
    message: { options?: unknown; view?: unknown },
    diff?: SystemGraphDiff,
    union?: UnionAdditions
  ): Promise<void> {
    const options = sanitizeExportOptions(message.options);
    const view = parseSystemExportView(message.view);
    await this.run('systemDiagram', options, document, async () => {
      if (!graph || !view) {
        throw new Error('The design is not loaded.');
      }
      const crop = options.area === 'view' ? view.visibleNodeIds : undefined;
      if (options.area === 'view' && !crop) {
        throw new Error('The view is not ready yet. Try again, or export the whole level.');
      }
      if (crop?.length === 0) {
        throw new Error('No block is in the current view. Export the whole level instead.');
      }
      const [look, encoding] = lookAndEncoding(options);
      // Loaded on first use: the layout engine is not needed to activate the extension.
      const { renderSystemLevelImage } = await import('../../services/render/systemLevelImage');
      // The marks too: the renderer above already evaluates these modules, so they cost no extra load.
      // The canvas lays the level out with the union whenever the comparison has one, and draws its ghosts with Marks and Show removed.
      const layoutUnion = view.unionLayout ? union : undefined;
      const ghostUnion = view.marks && view.ghosts ? layoutUnion : undefined;
      const changes =
        view.marks && diff
          ? (await import('../../webview/systemDiagram/changeMarks')).buildChangeMarks(
              view.ignoreVersionOnly ? withoutVersionOnly(diff) : diff,
              graph,
              (await import('../../webview/systemDiagram/layout/unionGraph')).withUnion(
                graph,
                ghostUnion
              ).ghosts
            )
          : undefined;
      const bytes = await renderSystemLevelImage(
        graph,
        {
          level: view.levelPath,
          expanded: view.expanded,
          isolate: view.isolate,
          selectedNodeIds: view.selectedNodeIds,
          clocks: view.clocks,
          cropNodeIds: crop,
          ...(changes && { changes }),
          ...(layoutUnion && {
            union: layoutUnion,
            ...(!(changes && ghostUnion) && { ghostsHidden: true }),
          }),
        },
        look,
        encoding,
        this.deps.assets,
        this.deps.roots
      );
      return {
        bytes,
        name: systemExportFileName(graph.name, view.levelPath, options.format),
      };
    });
  }

  /** Exports the symbol of the IP core document, as the editor currently holds it. */
  async exportIpCore(
    document: vscode.TextDocument,
    library: () => Promise<NormalizedBusLibrary>,
    message: { options?: unknown; view?: { visibleRect?: unknown; bundlesExpanded?: unknown } }
  ): Promise<void> {
    const options = sanitizeExportOptions(message.options);
    await this.run('ipCore', options, document, async () => {
      const { parseIpCoreDocument, renderIpSymbolImage } =
        await import('../../services/render/ipSymbolImage');
      const data = parseIpCoreDocument(document.getText(), document.fileName);
      let crop;
      if (options.area === 'view') {
        if (message.view?.bundlesExpanded === true) {
          throw new Error(
            'Current view needs every bus bundle collapsed, because the image draws bundles collapsed. Collapse them or export the whole symbol.'
          );
        }
        crop = parseExportRect(message.view?.visibleRect);
        if (!crop) {
          throw new Error(
            'The block diagram is not showing. Open the canvas, or export the whole symbol.'
          );
        }
      }
      const [look, encoding] = lookAndEncoding(options);
      const bytes = await renderIpSymbolImage(
        data,
        await library(),
        { crop },
        look,
        encoding,
        this.deps.assets,
        this.deps.roots
      );
      const vlnv = data.vlnv as { name?: unknown };
      return { bytes, name: `${String(vlnv.name).toLowerCase()}.${options.format}` };
    });
  }

  /** Remembers `options`, renders, asks for the file, writes it; cancel does nothing, errors are shown. */
  private async run(
    kind: ExportEditorKind,
    options: ExportImageOptions,
    document: vscode.TextDocument,
    render: () => Promise<{ bytes: Uint8Array; name: string }>
  ): Promise<void> {
    void this.deps.memento?.update(storageKey(kind), options);
    try {
      const { bytes, name } = await render();
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(document.uri, '..', name),
        filters: FILTERS[options.format],
        saveLabel: 'Export',
      });
      if (!target) {
        return;
      }
      const mismatch = formatExtensionMismatch(target.fsPath, options.format);
      if (mismatch) {
        throw new Error(mismatch);
      }
      await vscode.workspace.fs.writeFile(target, bytes);
      this.offerOpen(target);
    } catch (error) {
      this.deps.logger.error('Failed to export the diagram image', error as Error);
      void vscode.window.showErrorMessage(
        `Could not export the image: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private offerOpen(target: vscode.Uri): void {
    void Promise.resolve(
      vscode.window.showInformationMessage(
        `Exported ${path.basename(target.fsPath)}`,
        'Open',
        'Reveal in Explorer'
      )
    ).then((choice) => {
      if (choice === 'Open') {
        return vscode.commands.executeCommand('vscode.open', target);
      }
      if (choice === 'Reveal in Explorer') {
        return vscode.commands.executeCommand('revealFileInOS', target);
      }
      return undefined;
    });
  }
}
