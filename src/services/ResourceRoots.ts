import * as fs from 'fs';
import * as path from 'path';

export interface ResourceRoots {
  readonly schemasDir: string;
  readonly builtinPacksDir: string;
  readonly templatesDir: string;
  readonly busDefinitionsDir: string;
  readonly boardsDir: string;
}

export function resolveResourceRoots(extensionPath: string): ResourceRoots {
  const roots: ResourceRoots = {
    schemasDir: path.join(extensionPath, 'dist', 'resources', 'schemas'),
    builtinPacksDir: path.join(extensionPath, 'dist', 'packs'),
    templatesDir: path.join(extensionPath, 'dist', 'templates'),
    busDefinitionsDir: path.join(extensionPath, 'dist', 'resources', 'bus_definitions'),
    boardsDir: path.join(extensionPath, 'dist', 'resources', 'boards'),
  };

  // Verify that all directories exist to fail fast at activation
  const dirs: string[] = [
    roots.schemasDir,
    roots.builtinPacksDir,
    roots.templatesDir,
    roots.busDefinitionsDir,
    roots.boardsDir,
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      throw new Error(
        `IPCraft resource directory not found: ${dir}. Please check your installation or build.`
      );
    }
  }

  return roots;
}

export function devResourceRoots(repoRoot: string): ResourceRoots {
  const roots: ResourceRoots = {
    schemasDir: path.join(repoRoot, 'ipcraft-spec', 'schemas'),
    builtinPacksDir: path.join(repoRoot, 'src', 'generator', 'packs'),
    templatesDir: path.join(repoRoot, 'src', 'generator', 'templates'),
    busDefinitionsDir: path.join(repoRoot, 'ipcraft-spec', 'bus_definitions'),
    boardsDir: path.join(repoRoot, 'resources', 'boards'),
  };

  // Verify that all directories exist to fail fast in tests
  const dirs: string[] = [
    roots.schemasDir,
    roots.builtinPacksDir,
    roots.templatesDir,
    roots.busDefinitionsDir,
    roots.boardsDir,
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      throw new Error(`IPCraft dev resource directory not found: ${dir}.`);
    }
  }

  return roots;
}
