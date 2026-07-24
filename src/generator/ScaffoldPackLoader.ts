import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ScaffoldPack, ScaffoldFileRule, ScaffoldPackRequirements } from './types';

/**
 * Resolve a rendered scaffold target beneath the selected output directory.
 * Both slash styles are treated as separators so a pack cannot become unsafe
 * when moved between POSIX and Windows hosts.
 */
export function resolveScaffoldOutputPath(
  outputDir: string,
  target: string,
  pathApi: path.PlatformPath = path
): string {
  const canonicalOutputDir = pathApi.resolve(outputDir);
  const fail = (reason: string): never => {
    throw new Error(
      `Unsafe scaffold output target ${JSON.stringify(target)}: ${reason}. ` +
        `Target must be a relative file path inside ${JSON.stringify(canonicalOutputDir)}.`
    );
  };

  if (!target.trim()) {
    fail('target is empty');
  }
  if (/^[\\/]/.test(target) || /^[A-Za-z]:/.test(target)) {
    fail('absolute, drive-qualified, and UNC paths are not allowed');
  }

  const segments = target.split(/[\\/]/);
  if (segments.includes('..')) {
    fail('path traversal is not allowed');
  }

  const relativeTarget = segments
    .filter((segment) => segment !== '' && segment !== '.')
    .join(pathApi.sep);
  if (!relativeTarget) {
    fail('target resolves to the output directory itself');
  }

  const resolvedTarget = pathApi.resolve(canonicalOutputDir, relativeTarget);
  const relativeToOutput = pathApi.relative(canonicalOutputDir, resolvedTarget);
  if (
    relativeToOutput === '' ||
    relativeToOutput === '..' ||
    relativeToOutput.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativeToOutput)
  ) {
    fail('resolved path is outside the output directory');
  }

  return resolvedTarget;
}

/** Parses the optional `requirements` manifest block (issue #152). Absent = no constraint. */
function parseRequirements(raw: unknown): ScaffoldPackRequirements | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x)) : undefined;
  const memoryMappedSlave =
    r.memoryMappedSlave === 'required' || r.memoryMappedSlave === 'forbidden'
      ? r.memoryMappedSlave
      : undefined;

  const requirements: ScaffoldPackRequirements = {
    hdlLanguages: toStringArray(r.hdlLanguages) as ScaffoldPackRequirements['hdlLanguages'],
    busTypes: toStringArray(r.busTypes),
    memoryMappedSlave,
    logicalPorts: toStringArray(r.logicalPorts),
  };
  return requirements;
}

export class ScaffoldPackLoader {
  private readonly builtinPacksDir: string;

  constructor(builtinPacksDir: string) {
    this.builtinPacksDir = builtinPacksDir;
  }

  /**
   * Resolve a scaffold pack by name or by absolute directory path.
   *
   * An absolute path pointing at a directory that contains a `scaffold.yml` is
   * loaded directly. This lets callers (e.g. the conformance kit) validate a pack
   * at an arbitrary location, outside the workspace and built-in search paths.
   *
   * Otherwise `packName` is treated as a name and looked up by directory:
   * workspace pack dirs first, then built-in packs. Workspace packs live at
   * `.vscode/ipcraft/packs/<name>/scaffold.yml`.
   */
  resolve(packName: string, workspacePackDirs: string[] = []): ScaffoldPack {
    if (path.isAbsolute(packName) && fs.existsSync(path.join(packName, 'scaffold.yml'))) {
      return ScaffoldPackLoader.load(packName);
    }

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
   * Resolve the default built-in pack.
   */
  resolveDefault(): ScaffoldPack {
    const packName = 'builtin-minimal';
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
        executable: f.executable !== undefined ? Boolean(f.executable) : undefined,
      })
    );

    return {
      name: String(parsed.name ?? path.basename(packDir)),
      description: parsed.description !== undefined ? String(parsed.description) : undefined,
      category: parsed.category !== undefined ? String(parsed.category) : undefined,
      packDir,
      files,
      fullGeneration: Boolean(parsed.fullGeneration ?? false),
      generateFrameworkTestbench: Boolean(parsed.generateFrameworkTestbench ?? true),
      generateFrameworkTestbenchDeclared: parsed.generateFrameworkTestbench !== undefined,
      apiVersion: parsed.apiVersion !== undefined ? String(parsed.apiVersion) : undefined,
      requirements: parseRequirements(parsed.requirements),
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
