import * as vscode from 'vscode';
import { CONFIG_KEY_IPCRAFT } from './configKeys';

const MIGRATION_DONE_KEY = 'ipcraft.toolchainInstallDirsMigrated';

async function migrateVendor(
  cfg: vscode.WorkspaceConfiguration,
  vendor: 'vivado' | 'quartus'
): Promise<boolean> {
  const installDirs = cfg.get<string[]>(`${vendor}.installDirs`, []);
  if (installDirs.length > 0) {
    return false;
  }
  const legacy = cfg.get<string>(`${vendor}.installDir`, '').trim();
  if (!legacy) {
    return false;
  }
  await cfg.update(`${vendor}.installDirs`, [legacy], vscode.ConfigurationTarget.Global);
  return true;
}

/**
 * One-time migration, run on activation: folds the legacy singular
 * `installDir` setting into the new `installDirs` array for each vendor,
 * only when the array is still empty. Never runs twice, never overwrites
 * an already-populated array.
 */
export async function migrateToolchainSettings(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(MIGRATION_DONE_KEY)) {
    return;
  }
  await context.globalState.update(MIGRATION_DONE_KEY, true);

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const migratedVivado = await migrateVendor(cfg, 'vivado');
  const migratedQuartus = await migrateVendor(cfg, 'quartus');

  const migrated = [migratedVivado && 'Vivado', migratedQuartus && 'Quartus'].filter(Boolean);
  if (migrated.length > 0) {
    void vscode.window.showInformationMessage(
      `IPCraft: Migrated your ${migrated.join(' and ')} install path${migrated.length > 1 ? 's' : ''} to the new multi-version setting.`
    );
  }
}
