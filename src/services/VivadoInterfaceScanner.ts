import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { getIpcraftConfigDir } from '../utils/configDir';
import { resolveVivadoInstallDir } from '../utils/vivadoResolver';
import {
  parseVivadoInterfaceFiles,
  type VivadoInterfaceDef,
} from '../parser/VivadoInterfaceXmlParser';
import { Logger } from '../utils/Logger';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

const logger = new Logger('VivadoInterfaceScanner');

/**
 * Directory where scanned Vivado bus/abstraction definitions are cached, in the
 * same YAML shape as ipcraft-spec/bus_definitions/*.yml. Global (one per machine),
 * never written into a specific IP core project — re-scanning replaces its contents.
 */
export function getVivadoInterfaceCacheDir(): string {
  return path.join(getIpcraftConfigDir(), 'vivado', 'bus_definitions');
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
  async scan(): Promise<{ count: number; cacheDir: string; version: string }> {
    const config = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
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

    const interfacesDir = path.join(installDir, 'data', 'ip', 'interfaces');
    const xmlContents = await this.readAllXmlFiles(interfacesDir);
    const interfaces = parseVivadoInterfaceFiles(xmlContents);

    const cacheDir = getVivadoInterfaceCacheDir();
    await this.writeCacheDir(cacheDir, interfaces);

    const version = path.basename(installDir);
    logger.info(`Vivado interface scan complete: ${interfaces.length} interfaces (${version})`);
    return { count: interfaces.length, cacheDir, version };
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

  /** Wipes and rewrites the cache directory so a re-scan never leaves stale entries. */
  private async writeCacheDir(cacheDir: string, interfaces: VivadoInterfaceDef[]): Promise<void> {
    if (await pathExists(cacheDir)) {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }
    await fs.mkdir(cacheDir, { recursive: true });

    for (const iface of interfaces) {
      // Marks this definition as already known to the local Vivado install, so
      // packaging never bundles a redundant busDefinition/abstractionDefinition
      // copy for it (see VivadoComponentXmlGenerator.generateCustomBusDefs).
      const { key, record } = vivadoInterfaceToBusDefEntry(iface, 'vivado');
      const doc: Record<string, unknown> = { [key]: record };
      const fileContent = yaml.dump(doc, { noRefs: true, sortKeys: false });
      await fs.writeFile(path.join(cacheDir, `${key.toLowerCase()}.yml`), fileContent, 'utf8');
    }
  }
}
