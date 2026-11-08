import * as fs from 'fs/promises';
import * as path from 'path';
import { runCliRender } from './render';
import { parseRenderArgs } from './renderArgv';
import { duplicateOutput, entryArgv, parseManifest } from './renderManifestSpec';
import { RenderSession } from './renderResources';

export interface ManifestReporter {
  rendered(outputPath: string): void;
  failed(message: string): void;
}

/**
 * Core logic behind `ipcraft render --manifest`: renders each entry in order, sharing fonts, bus
 * libraries and workspace file lists. An entry that fails is reported and the others still render.
 * Returns the process exit code.
 */
export async function runCliRenderManifest(
  manifestPath: string,
  resourceRoots: Parameters<typeof runCliRender>[1],
  report: ManifestReporter
): Promise<number> {
  const file = path.resolve(manifestPath);
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    report.failed(
      (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? `Manifest not found: ${file}`
        : `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`
    );
    return 1;
  }
  const manifest = parseManifest(text);
  if ('error' in manifest) {
    report.failed(`${file}: ${manifest.error}`);
    return 1;
  }
  const duplicate = duplicateOutput(manifest.images, path.dirname(file));
  if (duplicate !== undefined) {
    report.failed(`${file}: several images write ${duplicate}`);
    return 1;
  }
  const session = new RenderSession();
  let exitCode = 0;
  for (const [index, entry] of manifest.images.entries()) {
    const source = (entry as { source?: unknown } | null)?.source;
    const label = `images[${index}]${typeof source === 'string' ? ` (${source})` : ''}`;
    const argv = entryArgv(entry, manifest.defaults, path.dirname(file));
    const parsed = Array.isArray(argv)
      ? parseRenderArgs(argv)
      : { kind: 'error' as const, message: argv.error };
    if (parsed.kind !== 'render') {
      report.failed(`${label}: ${parsed.kind === 'error' ? parsed.message : 'not an image entry'}`);
      exitCode = 1;
      continue;
    }
    const result = await runCliRender(parsed.args, resourceRoots, session);
    if (result.success) {
      report.rendered(result.outputPath);
    } else {
      report.failed(`${label}: ${result.error}`);
      exitCode = 1;
    }
  }
  return exitCode;
}
