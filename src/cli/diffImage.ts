import * as fs from 'fs/promises';
import * as path from 'path';
import type { SystemGraph } from '../domain/systemGraph';
import type { SystemGraphDiff, UnionAdditions } from '../domain/systemGraphDiff';
import type { RenderRoots } from '../services/render/imageEncoding';
import { RenderAssets } from '../services/render/renderResources';
import { renderSystemLevelImage } from '../services/render/systemLevelImage';
import { buildChangeMarks } from '../webview/systemDiagram/changeMarks';
import { withUnion } from '../webview/systemDiagram/layout/unionGraph';
import { RENDER_DEFAULTS, renderOutputFormat } from './renderArgv';

/**
 * Draws the top level of the current revision with the marks of `diff` (issue #302) to the image
 * file `image`, in the default look of `ipcraft render`, and returns the path written.
 * What only the base has (`union`, see `unionAdditions`) is drawn as ghosts.
 */
export async function writeDiffImage(
  image: string,
  current: SystemGraph,
  diff: SystemGraphDiff,
  roots: RenderRoots,
  union?: UnionAdditions
): Promise<string> {
  const outputPath = path.resolve(image);
  const format = renderOutputFormat(outputPath);
  if (format === undefined) {
    // `parseDiffArgs` rejects this; a direct caller of `runCliDiff` gets it as the image error.
    throw new Error(`Unsupported image format: ${path.basename(outputPath)}`);
  }
  const { scale, quality, ...look } = RENDER_DEFAULTS;
  const bytes = await renderSystemLevelImage(
    current,
    {
      level: '/',
      expanded: [],
      selectedNodeIds: [],
      clocks: false,
      changes: buildChangeMarks(diff, current, withUnion(current, union).ghosts),
      union,
    },
    look,
    { format, scale, quality },
    new RenderAssets(),
    roots
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, bytes);
  return outputPath;
}
