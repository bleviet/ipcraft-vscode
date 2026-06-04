import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ScaffoldPack, ScaffoldFileRule } from './types';

/** Resolved path to the directory containing the built-in packs (dist/packs/ or src/generator/packs/). */
const BUILTIN_PACKS_DIR = (() => {
  // Compiled bundle: __dirname = dist/  → dist/packs/
  // ts-jest tests:   __dirname = src/generator/ → src/generator/packs/
  const adjacent = path.join(__dirname, 'packs');
  if (fs.existsSync(adjacent)) {
    return adjacent;
  }
  // Fallback: running from out/ with source tree intact
  return path.join(__dirname, '..', 'src', 'generator', 'packs');
})();

export class ScaffoldPackLoader {
  /**
   * Resolve a scaffold pack by name.
   * Lookup order: workspace pack dirs first, then built-in packs.
   * Workspace packs live at `.vscode/ipcraft/packs/<name>/scaffold.yml`.
   */
  static resolve(packName: string, workspacePackDirs: string[] = []): ScaffoldPack {
    const searchDirs = [...workspacePackDirs, BUILTIN_PACKS_DIR];

    for (const dir of searchDirs) {
      const candidate = path.join(dir, packName);
      if (fs.existsSync(path.join(candidate, 'scaffold.yml'))) {
        return ScaffoldPackLoader.load(candidate);
      }
    }

    throw new Error(
      `Scaffold pack '${packName}' not found. ` +
        `Searched: ${searchDirs.map((d) => path.join(d, packName)).join(', ')}`
    );
  }

  /**
   * Resolve the default built-in pack based on the legacy bahonaviMethodology flag.
   * `true`  → builtin-bahonavi
   * `false` → builtin-minimal
   */
  static resolveDefault(bahonaviMethodology: boolean): ScaffoldPack {
    const packName = bahonaviMethodology ? 'builtin-bahonavi' : 'builtin-minimal';
    const packDir = path.join(BUILTIN_PACKS_DIR, packName);
    if (!fs.existsSync(path.join(packDir, 'scaffold.yml'))) {
      throw new Error(`Built-in scaffold pack '${packName}' not found at: ${packDir}`);
    }
    return ScaffoldPackLoader.load(packDir);
  }

  /** Load and parse a scaffold.yml from an absolute pack directory path. */
  static load(packDir: string): ScaffoldPack {
    const manifestPath = path.join(packDir, 'scaffold.yml');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown>;

    const files: ScaffoldFileRule[] = ((parsed.files as Array<Record<string, unknown>>) ?? []).map(
      (f) => ({
        source: String(f.source ?? ''),
        target: String(f.target ?? ''),
        condition: f.condition !== undefined ? String(f.condition) : undefined,
        managed: f.managed !== undefined ? Boolean(f.managed) : true,
      })
    );

    return {
      name: String(parsed.name ?? path.basename(packDir)),
      description: parsed.description !== undefined ? String(parsed.description) : undefined,
      packDir,
      files,
      fullGeneration: Boolean(parsed.fullGeneration ?? false),
    };
  }

  /** Return the absolute path to the built-in packs directory. */
  static get builtinPacksDir(): string {
    return BUILTIN_PACKS_DIR;
  }

  /** List all built-in pack names (directory names inside BUILTIN_PACKS_DIR). */
  static listBuiltinPacks(): string[] {
    try {
      return fs
        .readdirSync(BUILTIN_PACKS_DIR, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() && fs.existsSync(path.join(BUILTIN_PACKS_DIR, e.name, 'scaffold.yml'))
        )
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}
