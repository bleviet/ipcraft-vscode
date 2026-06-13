import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ScaffoldPack, ScaffoldFileRule } from './types';

export class ScaffoldPackLoader {
  private readonly builtinPacksDir: string;

  constructor(builtinPacksDir: string) {
    this.builtinPacksDir = builtinPacksDir;
  }

  /**
   * Resolve a scaffold pack by name.
   * Lookup order: workspace pack dirs first, then built-in packs.
   * Workspace packs live at `.vscode/ipcraft/packs/<name>/scaffold.yml`.
   */
  resolve(packName: string, workspacePackDirs: string[] = []): ScaffoldPack {
    const searchDirs = [...workspacePackDirs, this.builtinPacksDir];

    for (const dir of searchDirs) {
      const candidate = path.join(dir, packName);
      if (fs.existsSync(path.join(candidate, 'scaffold.yml'))) {
        const pack = ScaffoldPackLoader.load(candidate);
        // Workspace packs that don't declare a category get labelled "workspace"
        if (!pack.category && workspacePackDirs.includes(dir)) {
          pack.category = 'workspace';
        }
        return pack;
      }
    }

    throw new Error(
      `Scaffold pack '${packName}' not found. ` +
        `Searched: ${searchDirs.map((d) => path.join(d, packName)).join(', ')}`
    );
  }

  /**
   * Resolve the default built-in pack based on the legacy ipCraftMethodology flag.
   * `true`  → builtin-ipcraft
   * `false` → builtin-minimal
   */
  resolveDefault(ipCraftMethodology: boolean): ScaffoldPack {
    const packName = ipCraftMethodology ? 'builtin-ipcraft' : 'builtin-minimal';
    const packDir = path.join(this.builtinPacksDir, packName);
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
      category: parsed.category !== undefined ? String(parsed.category) : undefined,
      packDir,
      files,
      fullGeneration: Boolean(parsed.fullGeneration ?? false),
    };
  }

  /** Return the absolute path to the built-in packs directory. */
  get builtinPacksDirectory(): string {
    return this.builtinPacksDir;
  }

  /** List all built-in pack names (directory names inside BUILTIN_PACKS_DIR). */
  listBuiltinPacks(): string[] {
    try {
      return fs
        .readdirSync(this.builtinPacksDir, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            fs.existsSync(path.join(this.builtinPacksDir, e.name, 'scaffold.yml'))
        )
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}
