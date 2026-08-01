import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { getIpcraftConfigDir } from '../utils/configDir';
import { resolveVivadoInstallDir, resolveVivadoVersions } from '../utils/vivadoResolver';
import type { ToolVersionChoice } from '../utils/pickToolVersion';
import {
  parseVivadoInterfaceFiles,
  type VivadoInterfaceDef,
} from '../parser/VivadoInterfaceXmlParser';
import { Logger } from '../utils/Logger';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { recordVivadoCacheSelection } from './VivadoCacheVersion';

const logger = new Logger('VivadoInterfaceScanner');

/**
 * Directory where scanned Vivado bus/abstraction definitions are cached, in the
 * same YAML shape as ipcraft-spec/bus_definitions/*.yml. A selected version gets
 * its own machine-wide directory; omitting the version addresses the legacy cache.
 */
export function getVivadoInterfaceCacheDir(version?: string): string {
  return path.join(
    getIpcraftConfigDir(),
    'vivado',
    ...(version ? [encodeURIComponent(version)] : []),
    'bus_definitions'
  );
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes a VLNV into a filesystem-safe, collision-free identifier.
 * Exported for reuse by `WorkspaceBusDefinitionScanner`, which derives the
 * same library key for IP-XACT bus definitions found in the workspace.
 */
export function vlnvToFileStem(busType: VivadoInterfaceDef['busType']): string {
  return `${busType.vendor}_${busType.library}_${busType.name}_${busType.version}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Converts a parsed IP-XACT interface into a `{ [KEY]: { busType, source, ports } }`
 * bus-definition library entry, the same shape as `ipcraft-spec/bus_definitions/*.yml`.
 * Shared by `VivadoInterfaceScanner` (caches Vivado-install interfaces, `source: 'vivado'`)
 * and `WorkspaceBusDefinitionScanner` (discovers IP-XACT XML in the workspace,
 * `source: 'workspace'`).
 */
export function vivadoInterfaceToBusDefEntry(
  iface: VivadoInterfaceDef,
  source: string
): { key: string; record: Record<string, unknown> } {
  const stem = vlnvToFileStem(iface.busType);
  return {
    key: stem.toUpperCase(),
    record: {
      busType: {
        vendor: iface.busType.vendor,
        library: iface.busType.library,
        name: iface.busType.name,
        version: iface.busType.version,
        ...(iface.description ? { description: iface.description } : {}),
      },
      source,
      ports: iface.ports,
    },
  };
}

export class VivadoInterfaceScanner {
  /**
   * Scans the configured Vivado installation's `data/ip/interfaces/` directory and
   * caches the result as bus-definition YAML files. Throws if Vivado isn't configured
   * or can't be located — callers (the command handler) surface this to the user.
   */
  async scan(
    choice: ToolVersionChoice | null,
    config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT),
    resourceUri?: vscode.Uri
  ): Promise<{ count: number; cacheDir: string; version: string }> {
    const resolvedInstall = this.resolveInstallDir(config, choice);
    const { installDir, version } = resolvedInstall;

    const interfacesDir = path.join(installDir, 'data', 'ip', 'interfaces');
    const xmlContents = await this.readAllXmlFiles(interfacesDir);
    const interfaces = parseVivadoInterfaceFiles(xmlContents);

    const cacheDir = getVivadoInterfaceCacheDir(resolvedInstall.cacheVersion);
    await this.writeCacheDir(cacheDir, interfaces);
    await recordVivadoCacheSelection(config, 'interfaces', choice, resourceUri);

    logger.info(`Vivado interface scan complete: ${interfaces.length} interfaces (${version})`);
    return { count: interfaces.length, cacheDir, version };
  }

  private resolveInstallDir(
    config: vscode.WorkspaceConfiguration,
    choice: ToolVersionChoice | null
  ): { installDir: string; version: string; cacheVersion?: string } {
    if (choice) {
      if (choice.runner !== 'local') {
        throw new Error('Vivado interface scanning requires a configured local installation.');
      }
      const resolved = resolveVivadoVersions(config.get<string[]>('vivado.installDirs', []));
      const selected = resolved.find((entry) => entry.version === choice.version);
      if (!selected) {
        throw new Error(`Could not find the selected Vivado ${choice.version} installation.`);
      }
      return {
        installDir: selected.installDir,
        version: selected.version,
        cacheVersion: selected.version,
      };
    }

    const installDirSetting = config.get<string>('vivado.installDir', '').trim();
    if (!installDirSetting) {
      throw new Error(
        'Vivado installation directory is not configured (ipcraft.vivado.installDir).'
      );
    }

    const installDir = resolveVivadoInstallDir(installDirSetting);
    if (!installDir) {
      throw new Error(`Could not find a Vivado installation under "${installDirSetting}".`);
    }
    return { installDir, version: path.basename(installDir) };
  }

  private async readAllXmlFiles(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new Error(
        `Could not read Vivado interfaces directory at ${dir}: ${(error as Error).message}`
      );
    }

    const contents: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        contents.push(...(await this.readAllXmlFiles(full)));
      } else if (entry.isFile() && entry.name.endsWith('.xml')) {
        try {
          contents.push(await fs.readFile(full, 'utf8'));
        } catch (error) {
          logger.warn(`Skipping unreadable interface file ${full}: ${(error as Error).message}`);
        }
      }
    }
    return contents;
  }

  /** Replaces the cache only after a complete sibling directory has been written. */
  private async writeCacheDir(cacheDir: string, interfaces: VivadoInterfaceDef[]): Promise<void> {
    const parentDir = path.dirname(cacheDir);
    const cacheName = path.basename(cacheDir);
    const suffix = `${process.pid}-${Date.now()}`;
    const tempDir = path.join(parentDir, `.${cacheName}.tmp-${suffix}`);
    const backupDir = path.join(parentDir, `.${cacheName}.backup-${suffix}`);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.rm(tempDir, { recursive: true, force: true });
    let previousCacheMoved = false;

    try {
      await fs.mkdir(tempDir, { recursive: true });
      for (const iface of interfaces) {
        // Marks this definition as already known to the local Vivado install, so
        // packaging never bundles a redundant busDefinition/abstractionDefinition
        // copy for it (see VivadoComponentXmlGenerator.generateCustomBusDefs).
        const { key, record } = vivadoInterfaceToBusDefEntry(iface, 'vivado');
        const doc: Record<string, unknown> = { [key]: record };
        const fileContent = yaml.dump(doc, { noRefs: true, sortKeys: false });
        await fs.writeFile(path.join(tempDir, `${key.toLowerCase()}.yml`), fileContent, 'utf8');
      }

      const hadCache = await pathExists(cacheDir);
      if (hadCache) {
        await fs.rename(cacheDir, backupDir);
        previousCacheMoved = true;
      }
      try {
        await fs.rename(tempDir, cacheDir);
      } catch (error) {
        if (hadCache) {
          try {
            await fs.rename(backupDir, cacheDir);
            previousCacheMoved = false;
          } catch (restoreError) {
            // Preserve the known-good cache at its sibling path rather than
            // deleting it in finally if restoring the original path also fails.
            logger.error(
              `Could not restore interface cache after replacement failure: ${(restoreError as Error).message}`
            );
          }
        }
        throw error;
      }
      if (hadCache) {
        await fs.rm(backupDir, { recursive: true, force: true });
        previousCacheMoved = false;
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      if (!previousCacheMoved) {
        await fs.rm(backupDir, { recursive: true, force: true });
      }
    }
  }
}
