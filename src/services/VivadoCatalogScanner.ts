import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { runProcess } from './BuildRunner';
import { getBuildOutputChannel } from './BuildOutputChannel';
import { getToolchain } from './toolchains/registry';
import type { ToolVersionChoice } from '../utils/pickToolVersion';
import { getIpcraftConfigDir } from '../utils/configDir';
import { isValidVlnv } from '../utils/vlnv';
import { Logger } from '../utils/Logger';
import { getVivadoLauncher } from '../utils/vivadoResolver';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { recordVivadoCacheSelection } from './VivadoCacheVersion';

const logger = new Logger('VivadoCatalogScanner');

interface VivadoCatalog {
  version: string;
  scannedAt: string;
  ipdefs: string[];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Replaces a catalog only after its complete JSON has been staged beside it. */
async function replaceCatalogFile(catalogPath: string, contents: string): Promise<void> {
  const catalogDir = path.dirname(catalogPath);
  const name = path.basename(catalogPath);
  const suffix = `${process.pid}-${Date.now()}`;
  const temporaryPath = path.join(catalogDir, `.${name}.tmp-${suffix}`);
  const backupPath = path.join(catalogDir, `.${name}.backup-${suffix}`);
  let previousCatalogMoved = false;

  await fs.mkdir(catalogDir, { recursive: true });
  await fs.rm(temporaryPath, { force: true });
  try {
    await fs.writeFile(temporaryPath, contents, 'utf8');
    if (await pathExists(catalogPath)) {
      await fs.rename(catalogPath, backupPath);
      previousCatalogMoved = true;
    }
    try {
      await fs.rename(temporaryPath, catalogPath);
    } catch (error) {
      if (previousCatalogMoved) {
        try {
          await fs.rename(backupPath, catalogPath);
          previousCatalogMoved = false;
        } catch {
          // Preserve the backup when restoring the previous valid catalog fails.
        }
      }
      throw error;
    }
    if (previousCatalogMoved) {
      await fs.rm(backupPath, { force: true });
      previousCatalogMoved = false;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
    if (!previousCatalogMoved) {
      await fs.rm(backupPath, { force: true });
    }
  }
}

export class VivadoCatalogScanner {
  private catalogPath(version?: string): string {
    return path.join(
      getIpcraftConfigDir(),
      'vivado',
      ...(version ? [encodeURIComponent(version)] : []),
      'catalog.json'
    );
  }

  async scan(
    choice: ToolVersionChoice | null,
    config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT),
    resourceUri?: vscode.Uri
  ): Promise<{ count: number; catalogPath: string }> {
    const preferredVersion = choice?.version;

    const tmpDir = path.join(os.tmpdir(), `ipcraft-vivado-scan-${Date.now()}`);
    const toolchain = getToolchain('vivado');
    const docker =
      choice?.runner === 'docker' || choice === null
        ? toolchain?.getDocker(config, tmpDir, preferredVersion)
        : undefined;
    if (choice?.runner === 'docker' && !docker) {
      throw new Error(`Could not resolve the configured Vivado ${choice.version} Docker image.`);
    }
    const launcher = docker
      ? { exe: 'vivado', prefixArgs: [] }
      : getVivadoLauncher(config, preferredVersion);
    const launchEnv = toolchain?.getLaunchEnv(config) ?? { env: {}, extraMounts: [] };

    await fs.mkdir(tmpDir, { recursive: true });
    const outputFile = path.join(tmpDir, 'ipdefs.txt');
    const tclScript = path.join(tmpDir, 'scan.tcl');

    const tclContent = [
      'create_project -in_memory -part xc7z020clg484-1',
      `set fh [open {${docker ? '/work/ipdefs.txt' : outputFile}} w]`,
      'foreach ipdef [get_ipdefs *] { puts $fh "$ipdef" }',
      'close $fh',
      'exit',
    ].join('\n');

    await fs.writeFile(tclScript, tclContent, 'utf8');

    try {
      const result = await runProcess(
        launcher.exe,
        [...launcher.prefixArgs, '-mode', 'batch', '-source', tclScript, '-nojournal', '-nolog'],
        {
          cwd: tmpDir,
          outputChannel: getBuildOutputChannel(),
          docker,
          env: launchEnv.env,
          extraMounts: launchEnv.extraMounts,
        }
      );
      if (!result.success) {
        throw new Error(`${launcher.exe} exited with code ${result.exitCode}`);
      }

      let rawOutput = '';
      try {
        rawOutput = await fs.readFile(outputFile, 'utf8');
      } catch {
        rawOutput = '';
      }

      const ipdefs = rawOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => isValidVlnv(line));

      const catalogPath = this.catalogPath(preferredVersion);
      const catalog: VivadoCatalog = {
        version: preferredVersion ?? 'unknown',
        scannedAt: new Date().toISOString(),
        ipdefs,
      };

      await replaceCatalogFile(catalogPath, JSON.stringify(catalog, null, 2));
      await recordVivadoCacheSelection(config, 'catalog', choice, resourceUri);
      logger.info(`Vivado catalog scan complete: ${ipdefs.length} IPs`);

      return { count: ipdefs.length, catalogPath };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async loadCachedCatalog(version?: string): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.catalogPath(version), 'utf8');
      const catalog = JSON.parse(raw) as VivadoCatalog;
      return Array.isArray(catalog.ipdefs) ? catalog.ipdefs : [];
    } catch {
      return [];
    }
  }
}
