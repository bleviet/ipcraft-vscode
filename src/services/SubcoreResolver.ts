import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { isValidVlnv } from '../utils/vlnv';
import { Logger } from '../utils/Logger';
import { VivadoCatalogScanner } from './VivadoCatalogScanner';
import { XILINX_COMMON_IPS } from '../data/xilinxCatalog';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

const logger = new Logger('SubcoreResolver');

// Mirrors the dependency/build directories ScaffoldPackCommands.ts's IP-file
// lookup and WorkspaceBusDefinitionScanner's exclude glob both prune, so the
// workspace .ip.yml walk doesn't descend into node_modules or similar.
const SUBCORE_SCAN_EXCLUDE_GLOB = '**/node_modules/**';

export interface ResolvedSubcore {
  vlnv: string;
  source: 'workspace' | 'user-repo' | 'vivado-catalog' | 'builtin' | 'unresolved';
  fsPath?: string;
}

export interface SubcoreCandidate {
  vlnv: string;
  source: 'workspace' | 'user-repo' | 'vivado-catalog' | 'builtin';
  label?: string;
  fsPath?: string;
}

export class SubcoreResolver {
  private workspaceIndex = new Map<string, string>(); // vlnv -> fsPath
  private userRepoIndex = new Map<string, string>(); // vlnv -> fsPath
  private vivadoCatalog: string[] = [];
  private builtinCatalog: string[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly scanner = new VivadoCatalogScanner();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    await Promise.all([
      this.scanWorkspace(),
      this.scanUserRepoPaths(),
      this.loadVivadoCatalog(),
      this.loadBuiltinCatalog(),
    ]);

    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.ip.yml');
    this.watcher.onDidCreate(() => void this.scanWorkspace());
    this.watcher.onDidChange(() => void this.scanWorkspace());
    this.watcher.onDidDelete(() => void this.scanWorkspace());
    this.context.subscriptions.push(this.watcher);

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('ipcraft.ipRepositoryPaths')) {
          void this.scanUserRepoPaths();
        }
      })
    );
  }

  resolve(vlnv: string): ResolvedSubcore {
    const workspacePath = this.workspaceIndex.get(vlnv);
    if (workspacePath) {
      return { vlnv, source: 'workspace', fsPath: workspacePath };
    }
    const repoPath = this.userRepoIndex.get(vlnv);
    if (repoPath) {
      return { vlnv, source: 'user-repo', fsPath: repoPath };
    }
    if (this.vivadoCatalog.includes(vlnv)) {
      return { vlnv, source: 'vivado-catalog' };
    }
    if (this.builtinCatalog.includes(vlnv)) {
      return { vlnv, source: 'builtin' };
    }
    return { vlnv, source: 'unresolved' };
  }

  getAvailableIps(): SubcoreCandidate[] {
    const candidates: SubcoreCandidate[] = [];

    for (const [vlnv, fsPath] of this.workspaceIndex) {
      candidates.push({ vlnv, source: 'workspace', fsPath });
    }
    for (const [vlnv, fsPath] of this.userRepoIndex) {
      candidates.push({ vlnv, source: 'user-repo', fsPath });
    }
    for (const vlnv of this.vivadoCatalog) {
      candidates.push({ vlnv, source: 'vivado-catalog' });
    }
    for (const vlnv of this.builtinCatalog) {
      if (!this.vivadoCatalog.includes(vlnv)) {
        candidates.push({ vlnv, source: 'builtin' });
      }
    }

    return candidates;
  }

  async refresh(): Promise<void> {
    await Promise.all([this.scanWorkspace(), this.scanUserRepoPaths(), this.loadVivadoCatalog()]);
  }

  private async scanWorkspace(): Promise<void> {
    const newIndex = new Map<string, string>();
    try {
      const files = await vscode.workspace.findFiles('**/*.ip.yml', SUBCORE_SCAN_EXCLUDE_GLOB);
      for (const fileUri of files) {
        const vlnv = await this.quickParseVlnv(fileUri.fsPath);
        if (vlnv) {
          newIndex.set(vlnv, fileUri.fsPath);
        }
      }
    } catch (err) {
      logger.error('Workspace scan failed', err as Error);
    }
    this.workspaceIndex = newIndex;
  }

  private async scanUserRepoPaths(): Promise<void> {
    const newIndex = new Map<string, string>();
    const config = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
    const repoPaths = config.get<string[]>('ipRepositoryPaths') ?? [];

    for (const repoPath of repoPaths) {
      const resolvedPath = path.isAbsolute(repoPath)
        ? repoPath
        : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', repoPath);

      try {
        const ipFiles = await globPattern(resolvedPath, '**/*.ip.yml');
        for (const filePath of ipFiles) {
          const vlnv = await this.quickParseVlnv(filePath);
          if (vlnv) {
            newIndex.set(vlnv, filePath);
          }
        }

        const componentFiles = await globPattern(resolvedPath, '**/component.xml');
        for (const filePath of componentFiles) {
          const vlnv = await quickParseComponentXmlVlnv(filePath);
          if (vlnv) {
            newIndex.set(vlnv, filePath);
          }
        }
      } catch (err) {
        logger.error(`Failed to scan repo path: ${resolvedPath}`, err as Error);
      }
    }

    this.userRepoIndex = newIndex;
  }

  private async loadVivadoCatalog(): Promise<void> {
    this.vivadoCatalog = await this.scanner.loadCachedCatalog();
  }

  private async loadBuiltinCatalog(): Promise<void> {
    this.builtinCatalog = XILINX_COMMON_IPS;
  }

  /** Quick-parse VLNV from first ~20 lines of an .ip.yml without full YAML parse. */
  private async quickParseVlnv(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').slice(0, 30).join('\n');

      const vendor = /vendor:\s*['"]?([^\s'"]+)['"]?/.exec(lines)?.[1];
      const library = /library:\s*['"]?([^\s'"]+)['"]?/.exec(lines)?.[1];
      const name = /name:\s*['"]?([^\s'"]+)['"]?/.exec(lines)?.[1];
      const version = /version:\s*['"]?([^\s'"]+)['"]?/.exec(lines)?.[1];

      if (vendor && library && name && version) {
        const vlnv = `${vendor}:${library}:${name}:${version}`;
        if (isValidVlnv(vlnv)) {
          return vlnv;
        }
      }
    } catch {
      // ignore read errors
    }
    return null;
  }
}

async function globPattern(rootDir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(rootDir, pattern.replace('**/', '').replace('**/', ''), results);
  return results;
}

async function walkDir(dir: string, filePattern: string, results: string[]): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, filePattern, results);
      } else if (entry.isFile() && entry.name.endsWith(filePattern.replace('*', ''))) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore inaccessible dirs
  }
}

async function quickParseComponentXmlVlnv(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const vendor = /<spirit:vendor>([^<]+)<\/spirit:vendor>/.exec(content)?.[1]?.trim();
    const library = /<spirit:library>([^<]+)<\/spirit:library>/.exec(content)?.[1]?.trim();
    const name = /<spirit:name>([^<]+)<\/spirit:name>/.exec(content)?.[1]?.trim();
    const version = /<spirit:version>([^<]+)<\/spirit:version>/.exec(content)?.[1]?.trim();
    if (vendor && library && name && version) {
      const vlnv = `${vendor}:${library}:${name}:${version}`;
      if (isValidVlnv(vlnv)) {
        return vlnv;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
