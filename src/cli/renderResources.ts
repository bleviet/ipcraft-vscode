/** What `ipcraft render` loads once and shares between the images of a batch: fonts, bus libraries, workspace files. */

import * as fs from 'fs/promises';
import * as path from 'path';
import { FONT_FILES, fontFaceCss, type FontBytes } from '../shared/render/fontFaces';
import type { BusLibraryCache } from './renderIpCore';
import { WorkspaceIoPool } from './workspaceIo';

/** The bytes of `file`, with a plain message instead of a raw ENOENT when it is missing. */
export async function readRequired(file: string, what: string): Promise<Buffer> {
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

export interface LoadedFonts {
  bytes: FontBytes;
  css: string;
}

export class RenderSession {
  /** Workspace scan warnings go to stderr, never stdout. */
  readonly workspaces = new WorkspaceIoPool((message) =>
    process.stderr.write(`Warning: ${message}\n`)
  );
  readonly busLibraries: BusLibraryCache = new Map();
  private fonts?: { dir: string; loading: Promise<LoadedFonts> };

  /** The fonts of `fontsDir`; a failed load is not kept. */
  fontsFrom(fontsDir: string): Promise<LoadedFonts> {
    if (this.fonts?.dir !== fontsDir) {
      const loading = loadFonts(fontsDir).then((bytes) => ({ bytes, css: fontFaceCss(bytes) }));
      const entry = { dir: fontsDir, loading };
      this.fonts = entry;
      loading.catch(() => {
        if (this.fonts === entry) {
          this.fonts = undefined;
        }
      });
    }
    return this.fonts.loading;
  }
}
