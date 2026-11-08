import * as fs from 'fs/promises';
import * as path from 'path';
import type { SystemGraph } from '../domain/systemGraph';
import { FONT_FILES, fontFaceCss, type FontBytes } from '../shared/render/fontFaces';
import { paletteFor, type RenderTheme } from '../shared/render/palette';
import { plexTextMeasure } from '../shared/render/textMetrics';
import { renderSystemLevelSvg } from '../shared/render/systemLevelSvg';
import { isSystemDesignScript } from '../services/systemDiagram/systemDesignDetection';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import type { ResourceRoots } from '../services/ResourceRoots';
import { shownLevels } from '../webview/systemDiagram/expansion';
import { buildElkInput, toFlowElements } from '../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../webview/systemDiagram/layout/runElkLayout';
import { closestNames } from './closestNames';

export interface CliRenderArgs {
  inputPath: string;
  /** Output `.svg` path. */
  out: string;
  level: string;
  /** Hierarchy blocks to draw expanded (of `level`, or of an expanded block), by instance path or name. */
  expand: string[];
  theme: RenderTheme;
  grid: boolean;
  legend: boolean;
  background: 'editor' | 'transparent';
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
  const read = (file: string) => readRequired(path.join(fontsDir, file), 'Font file');
  const [sans400, sans600, mono400] = await Promise.all([
    read(FONT_FILES.sans400),
    read(FONT_FILES.sans600),
    read(FONT_FILES.mono400),
  ]);
  return { sans400, sans600, mono400 };
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
      /\.ip\.ya?ml$/i.test(inputPath)
        ? 'IP core symbols are not supported yet; pass a Vivado .tcl, Platform Designer .qsys or qsys-script .tcl system design'
        : `'${inputPath}' is not a recognized system design (Vivado block design .tcl, Platform Designer .qsys or qsys-script .tcl)`
    );
  }
  const graph = readSystemDesign(inputPath, path.basename(inputPath), text);
  if (!graph) {
    throw new Error(`Could not read '${inputPath}' as a system design`);
  }
  return graph;
}

/** Core logic behind `ipcraft render`: draws one level of a system design as an SVG file. */
export async function runCliRender(
  args: CliRenderArgs,
  resourceRoots: Pick<ResourceRoots, 'fontsDir'>
): Promise<CliRenderResult> {
  const outputPath = path.resolve(args.out);
  const result: CliRenderResult = { success: false, outputPath };
  try {
    const inputPath = path.resolve(args.inputPath);
    const graph = readGraph(
      inputPath,
      (await readRequired(inputPath, 'Input file')).toString('utf8')
    );
    if (!graph.levels[args.level]) {
      const close = closestNames(args.level, Object.keys(graph.levels));
      throw new Error(`Unknown level '${args.level}'. Closest: ${close.join(', ')}`);
    }
    const expanded = new Set(resolveExpanded(graph, args.level, args.expand));
    const input = buildElkInput(graph, args.level, { measure: plexTextMeasure, expanded });
    const laidOut = await runElkLayout(input);
    const layout = toFlowElements(laidOut, graph, args.level, plexTextMeasure);
    const svg = renderSystemLevelSvg(layout, {
      palette: paletteFor(args.theme),
      grid: args.grid,
      legend: args.legend,
      background: args.background,
      fontFaceCss: fontFaceCss(await loadFonts(resourceRoots.fontsDir)),
    });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, svg, 'utf8');
    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
