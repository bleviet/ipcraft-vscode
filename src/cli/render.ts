import * as fs from 'fs/promises';
import * as path from 'path';
import { inflateSync } from 'zlib';
import type { SystemGraph } from '../domain/systemGraph';
import type { FontBytes } from '../shared/render/fontFaces';
import { rasterize } from '../shared/render/raster';
import { woffToSfnt } from '../shared/render/woffToSfnt';
import { paletteFor, type RenderTheme } from '../shared/render/palette';
import { plexTextMeasure } from '../shared/render/textMetrics';
import { renderSystemLevelSvg } from '../shared/render/systemLevelSvg';
import { isSystemDesignScript } from '../services/systemDiagram/systemDesignDetection';
import { enrichSystemGraph } from '../services/systemDiagram/enrichment/enrichSystemGraph';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import type { ResourceRoots } from '../services/ResourceRoots';
import { analyzeClocks } from '../webview/systemDiagram/clocks/analyzeClocks';
import { applyClockDecor, clockDecor } from '../webview/systemDiagram/clockDecor';
import { shownLevels } from '../webview/systemDiagram/expansion';
import { buildElkInput, toFlowElements } from '../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../webview/systemDiagram/layout/runElkLayout';
import { isIpCoreFile, renderOutputFormat } from './renderArgv';
import { closestNames } from './closestNames';
import { renderIpCoreFile } from './renderIpCore';
import { readRequired, RenderSession } from './renderResources';
import { resolveSelection } from './renderSystemOptions';

export interface CliRenderArgs {
  inputPath: string;
  /** Output path; its extension (`.svg`, `.png`, `.jpg`, `.jpeg`) picks the format. */
  out: string;
  level: string;
  /** Hierarchy blocks to draw expanded (of `level`, or of an expanded block), by instance path or name. */
  expand: string[];
  /** Blocks (instance name or path) and `port:<name>` ports to isolate with their neighbours; empty: the whole level. */
  select: string[];
  /** Isolation radius around `select` (default 1, clamped to the selection's reach). */
  hops?: number;
  /** Blocks and ports drawn selected without isolating. */
  highlight: string[];
  /** Draw the Clocks and resets domain decorations. */
  clocks: boolean;
  theme: RenderTheme;
  grid: boolean;
  legend: boolean;
  background: 'editor' | 'transparent';
  /** Pixels per SVG unit; PNG and JPG only. */
  scale: number;
  /** JPEG quality, 1-100; JPG only. */
  quality: number;
  /** System designs: the folder whose `.ip.yml`, HDL and `.qsys` files define the instances (default: the design's folder); false: draw the design as read. */
  workspace?: string | false;
}

export interface CliRenderResult {
  success: boolean;
  error?: string;
  outputPath: string;
}

/** The SVG as PNG or JPG bytes; the fonts are the same WOFF files the SVG embeds, as sfnt. */
async function rasterizeSvg(
  svg: string,
  format: 'png' | 'jpg',
  args: CliRenderArgs,
  fonts: FontBytes,
  wasmPath: string
): Promise<Uint8Array> {
  return rasterize(svg, {
    format,
    scale: args.scale,
    quality: args.quality,
    background: format === 'jpg' ? paletteFor(args.theme).background : undefined,
    fonts: Object.values(fonts).map((woff) => woffToSfnt(woff, inflateSync)),
    loadWasm: () => readRequired(wasmPath, 'Rasterizer module'),
  });
}

/**
 * The instance paths for `--expand` names (a path or a bare name). A block is accepted when it is
 * a hierarchy block of `level` or of a block that is itself expanded, in any order on the line,
 * as the viewer expands recursively; otherwise the error names the closest such blocks.
 */
function resolveExpanded(graph: SystemGraph, level: string, names: readonly string[]): string[] {
  const resolved = new Map<string, string>();
  const reachable = () =>
    [...shownLevels(graph, level, new Set(resolved.values()))]
      .flatMap((shown) => graph.levels[shown].instances)
      .filter((instancePath) => graph.instances[instancePath]?.kind === 'hier');
  let progress = true;
  while (progress) {
    progress = false;
    const candidates = reachable();
    for (const name of names) {
      const byName = candidates.filter(
        (instancePath) => graph.instances[instancePath].name === name
      );
      if (!candidates.includes(name) && byName.length > 1) {
        throw new Error(`ambiguous name '${name}', use the path: ${byName.join(', ')}`);
      }
      const found = candidates.includes(name) ? name : byName[0];
      if (found && !resolved.has(name)) {
        resolved.set(name, found);
        progress = true;
      }
    }
  }
  const unknown = names.find((name) => !resolved.has(name));
  if (unknown !== undefined) {
    const close = closestNames(unknown, reachable());
    throw new Error(
      `'${unknown}' is not a hierarchy block on level '${level}' or inside an expanded block.` +
        (close.length > 0 ? ` Closest: ${close.join(', ')}` : ' None is available.')
    );
  }
  return names.map((name) => resolved.get(name) as string);
}

async function readGraph(
  inputPath: string,
  text: string,
  args: CliRenderArgs,
  session: RenderSession
): Promise<SystemGraph> {
  if (!isSystemDesignScript(inputPath, text)) {
    throw new Error(
      `'${inputPath}' is not a recognized system design (Vivado block design .tcl, Platform Designer .qsys or qsys-script .tcl) or .ip.yml`
    );
  }
  const graph = readSystemDesign(inputPath, path.basename(inputPath), text);
  if (!graph) {
    throw new Error(`Could not read '${inputPath}' as a system design`);
  }
  if (args.workspace === false) {
    return graph;
  }
  const workspace = path.resolve(args.workspace ?? path.dirname(inputPath));
  if (!(await fs.stat(workspace).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Workspace directory not found: ${workspace}`);
  }
  return enrichSystemGraph(graph, inputPath, session.workspaces.get(workspace));
}

/** Draws one level of a system design as SVG text. */
async function renderSystemDesign(
  inputPath: string,
  text: string,
  args: CliRenderArgs,
  fonts: string,
  session: RenderSession
): Promise<string> {
  const graph = await readGraph(inputPath, text, args, session);
  if (!graph.levels[args.level]) {
    const close = closestNames(args.level, Object.keys(graph.levels));
    throw new Error(`Unknown level '${args.level}'. Closest: ${close.join(', ')}`);
  }
  const expanded = new Set(resolveExpanded(graph, args.level, args.expand));
  const { isolation, selectedNodeIds } = resolveSelection(graph, args.level, args, expanded);
  const input = buildElkInput(graph, args.level, {
    measure: plexTextMeasure,
    expanded,
    ...(isolation && { isolate: isolation }),
  });
  const laidOut = await runElkLayout(input);
  const flow = toFlowElements(laidOut, graph, args.level, plexTextMeasure);
  const decor = args.clocks
    ? clockDecor(
        flow,
        { graph, analysis: analyzeClocks(graph), levelPath: args.level, domainMode: true },
        null
      )
    : undefined;
  const layout = decor ? applyClockDecor(flow, decor) : flow;
  return renderSystemLevelSvg(layout, {
    selectedNodeIds,
    domainLegend: decor?.legend,
    palette: paletteFor(args.theme),
    grid: args.grid,
    legend: args.legend,
    background: args.background,
    fontFaceCss: fonts,
  });
}

/** Core logic behind `ipcraft render`: draws a system design level or an IP core symbol as an SVG, PNG or JPG file. */
export async function runCliRender(
  args: CliRenderArgs,
  resourceRoots: Pick<
    ResourceRoots,
    'fontsDir' | 'busDefinitionsDir' | 'busDefinitionSchemaPath' | 'resvgWasmPath'
  >,
  session: RenderSession = new RenderSession()
): Promise<CliRenderResult> {
  const outputPath = path.resolve(args.out);
  const result: CliRenderResult = { success: false, outputPath };
  try {
    const inputPath = path.resolve(args.inputPath);
    const text = (await readRequired(inputPath, 'Input file')).toString('utf8');
    const format = renderOutputFormat(outputPath);
    if (!format) {
      throw new Error(`Unsupported output file '${args.out}'`);
    }
    const { bytes: fontBytes, css: fonts } = await session.fontsFrom(resourceRoots.fontsDir);
    const svg = isIpCoreFile(inputPath)
      ? await renderIpCoreFile(
          inputPath,
          text,
          resourceRoots,
          {
            palette: paletteFor(args.theme),
            grid: args.grid,
            background: args.background,
            fontFaceCss: fonts,
          },
          session.busLibraries
        )
      : await renderSystemDesign(inputPath, text, args, fonts, session);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      format === 'svg'
        ? svg
        : await rasterizeSvg(svg, format, args, fontBytes, resourceRoots.resvgWasmPath)
    );
    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
