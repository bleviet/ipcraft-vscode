import * as fs from 'fs/promises';
import * as path from 'path';
import { inflateSync } from 'zlib';
import type { SystemGraph } from '../domain/systemGraph';
import { FONT_FILES, fontFaceCss, type FontBytes } from '../shared/render/fontFaces';
import { rasterize } from '../shared/render/raster';
import { woffToSfnt } from '../shared/render/woffToSfnt';
import { paletteFor, type RenderTheme } from '../shared/render/palette';
import { plexTextMeasure } from '../shared/render/textMetrics';
import { renderSystemLevelSvg } from '../shared/render/systemLevelSvg';
import { isSystemDesignScript } from '../services/systemDiagram/systemDesignDetection';
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
}

export interface CliRenderResult {
  success: boolean;
  error?: string;
  outputPath: string;
}

/** The bytes of `file`, with a plain message instead of a raw ENOENT when it is missing. */
async function readRequired(file: string, what: string): Promise<Buffer> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${what} not found: ${file}`);
    }
    throw err;
  }
}

async function loadFonts(fontsDir: string): Promise<FontBytes> {
  // One at a time, in a fixed order, so the first missing file is the one reported.
  const read = (file: string) => readRequired(path.join(fontsDir, file), 'Font file');
  const sans400 = await read(FONT_FILES.sans400);
  const sans600 = await read(FONT_FILES.sans600);
  const mono400 = await read(FONT_FILES.mono400);
  return { sans400, sans600, mono400 };
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

function readGraph(inputPath: string, text: string): SystemGraph {
  if (!isSystemDesignScript(inputPath, text)) {
    throw new Error(
      `'${inputPath}' is not a recognized system design (Vivado block design .tcl, Platform Designer .qsys or qsys-script .tcl) or .ip.yml`
    );
  }
  const graph = readSystemDesign(inputPath, path.basename(inputPath), text);
  if (!graph) {
    throw new Error(`Could not read '${inputPath}' as a system design`);
  }
  return graph;
}

/** Draws one level of a system design as SVG text. */
async function renderSystemDesign(
  inputPath: string,
  text: string,
  args: CliRenderArgs,
  fonts: string
): Promise<string> {
  const graph = readGraph(inputPath, text);
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
  >
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
    const fontBytes = await loadFonts(resourceRoots.fontsDir);
    const fonts = fontFaceCss(fontBytes);
    const svg = isIpCoreFile(inputPath)
      ? await renderIpCoreFile(inputPath, text, resourceRoots, {
          palette: paletteFor(args.theme),
          grid: args.grid,
          background: args.background,
          fontFaceCss: fonts,
        })
      : await renderSystemDesign(inputPath, text, args, fonts);
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
