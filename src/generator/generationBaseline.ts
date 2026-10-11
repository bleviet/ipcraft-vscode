import * as path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';

/** Committed folder (under the output dir) holding the last content IPCraft generated per file. */
export const BASELINE_DIR = '.ipcraft/baseline';

const baselinePath = (outputDir: string, relativePath: string): string =>
  path.join(outputDir, BASELINE_DIR, relativePath);

export async function readBaseline(
  outputDir: string,
  relativePath: string
): Promise<string | undefined> {
  try {
    return await readFile(baselinePath(outputDir, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

export async function writeBaselines(
  outputDir: string,
  entries: { relativePath: string; content: string }[]
): Promise<void> {
  await Promise.all(
    entries.map(async ({ relativePath, content }) => {
      const target = baselinePath(outputDir, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    })
  );
}
