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
 * Derives a version label from a legacy `dockerImage` reference for the
 * one-time migration: the tag portion after the last `:` (e.g.
 * `cvsoc/vivado:2024.2` -> `2024.2`), or the whole reference when it has no
 * tag. `dockerImages` entries require an explicit label since an image
 * reference can't always be parsed into a version — this is a best-effort
 * default the user can rename in Settings after migration.
 */
function labelFromDockerImage(image: string): string {
  const lastColon = image.lastIndexOf(':');
  return lastColon >= 0 ? image.slice(lastColon + 1) : image;
}

async function migrateVendorDockerImage(
  cfg: vscode.WorkspaceConfiguration,
  vendor: 'vivado' | 'quartus'
): Promise<boolean> {
  const dockerImages = cfg.get<Array<{ label: string; image: string }>>(
    `${vendor}.dockerImages`,
    []
  );
  if (dockerImages.length > 0) {
    return false;
  }
  const legacyImage = cfg.get<string>(`${vendor}.dockerImage`, '').trim();
  if (!legacyImage) {
    return false;
  }
  await cfg.update(
    `${vendor}.dockerImages`,
    [{ label: labelFromDockerImage(legacyImage), image: legacyImage }],
    vscode.ConfigurationTarget.Global
  );
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
  // Each vendor's installDir and dockerImage migrations are independent —
  // a user may have configured either, both, or neither, so both must run
  // unconditionally rather than short-circuiting on the first hit.
  const migratedVivadoInstallDir = await migrateVendor(cfg, 'vivado');
  const migratedVivadoDockerImage = await migrateVendorDockerImage(cfg, 'vivado');
  const migratedQuartusInstallDir = await migrateVendor(cfg, 'quartus');
  const migratedQuartusDockerImage = await migrateVendorDockerImage(cfg, 'quartus');

  const migratedVivado = migratedVivadoInstallDir || migratedVivadoDockerImage;
  const migratedQuartus = migratedQuartusInstallDir || migratedQuartusDockerImage;
  const migrated = [migratedVivado && 'Vivado', migratedQuartus && 'Quartus'].filter(Boolean);
  if (migrated.length > 0) {
    void vscode.window.showInformationMessage(
      `IPCraft: Migrated your ${migrated.join(' and ')} install path${migrated.length > 1 ? 's' : ''} to the new multi-version setting.`
    );
  }
}
