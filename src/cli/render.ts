import * as fs from 'fs/promises';
import * as path from 'path';
import type { SystemGraph } from '../domain/systemGraph';
import { isSystemDesignScript } from '../services/systemDiagram/systemDesignDetection';
import { enrichSystemGraph } from '../services/systemDiagram/enrichment/enrichSystemGraph';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import type { ImageEncoding, RenderLook, RenderRoots } from '../services/render/imageEncoding';
import { parseIpCoreDocument, renderIpSymbolImage } from '../services/render/ipSymbolImage';
import { renderSystemLevelImage, requireLevel } from '../services/render/systemLevelImage';
import type { RenderTheme } from '../shared/render/palette';
import { isIpCoreFile, renderOutputFormat } from './renderArgv';
import { resolveExpanded } from './renderExpand';
import { busLibraryFor } from './renderIpCore';
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

/** Draws one level of a system design to image bytes. */
async function renderSystemDesign(
  inputPath: string,
  text: string,
  args: CliRenderArgs,
  encoding: ImageEncoding,
  look: RenderLook,
  roots: RenderRoots,
  session: RenderSession
): Promise<Uint8Array> {
  const graph = await readGraph(inputPath, text, args, session);
  requireLevel(graph, args.level);
  const expanded = resolveExpanded(graph, args.level, args.expand);
  const selection = resolveSelection(graph, args.level, args, new Set(expanded));
  return renderSystemLevelImage(
    graph,
    { level: args.level, expanded, clocks: args.clocks, ...selection },
    look,
    encoding,
    session,
    roots
  );
}

/** Core logic behind `ipcraft render`: draws a system design level or an IP core symbol as an SVG, PNG or JPG file. */
export async function runCliRender(
  args: CliRenderArgs,
  resourceRoots: RenderRoots,
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
    await session.fontsFrom(resourceRoots.fontsDir);
    const encoding: ImageEncoding = { format, scale: args.scale, quality: args.quality };
    const look: RenderLook = {
      theme: args.theme,
      grid: args.grid,
      legend: args.legend,
      background: args.background,
    };
    let bytes: Uint8Array;
    if (isIpCoreFile(inputPath)) {
      const data = parseIpCoreDocument(text, inputPath);
      const library = await busLibraryFor(data, inputPath, resourceRoots, session.busLibraries);
      bytes = await renderIpSymbolImage(data, library, {}, look, encoding, session, resourceRoots);
    } else {
      bytes = await renderSystemDesign(
        inputPath,
        text,
        args,
        encoding,
        look,
        resourceRoots,
        session
      );
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);
    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
