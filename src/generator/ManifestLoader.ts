import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import type { ResolvedManifest, TemplateManifest } from './templateManifest';

const MANIFEST_FILENAME = 'ipcraft.templates.yml';
const BUILTIN_SENTINEL = 'ipcraft://builtin';

export class ManifestLoader {
  static async find(
    ipCorePath: string,
    builtinTemplatesPath: string
  ): Promise<ResolvedManifest | null> {
    const candidates = [
      path.join(path.dirname(ipCorePath), MANIFEST_FILENAME),
      path.join(os.homedir(), '.config', 'ipcraft', MANIFEST_FILENAME),
    ];

    for (const candidate of candidates) {
      const manifest = await ManifestLoader.tryLoad(candidate, builtinTemplatesPath);
      if (manifest !== null) {
        return manifest;
      }
    }

    return null;
  }

  private static async tryLoad(
    manifestPath: string,
    builtinTemplatesPath: string
  ): Promise<ResolvedManifest | null> {
    let content: string;
    try {
      content = await fs.readFile(manifestPath, 'utf8');
    } catch {
      return null;
    }

    const raw = yaml.load(content);
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    return ManifestLoader.resolve(
      raw as TemplateManifest,
      path.dirname(manifestPath),
      builtinTemplatesPath
    );
  }

  static resolve(
    manifest: TemplateManifest,
    manifestDir: string,
    builtinTemplatesPath: string
  ): ResolvedManifest {
    const rawDirs = manifest.templateDirs ?? [BUILTIN_SENTINEL];
    const templateDirs = rawDirs.map((dir) => {
      if (dir === BUILTIN_SENTINEL) {
        return builtinTemplatesPath;
      }
      return path.resolve(manifestDir, dir);
    });

    return {
      templateDirs,
      groups: manifest.groups ?? {},
      outputs: manifest.outputs ?? [],
      manifestDir,
    };
  }
}
