import * as vscode from 'vscode';
import { CONFIG_KEY_IPCRAFT } from '../../utils/configKeys';
import { pickToolVersion, type ToolVersionChoice } from '../../utils/pickToolVersion';
import { findClosestVersion } from '../../utils/toolchainVersions';
import { resolveVivadoVersions } from '../../utils/vivadoResolver';
import { resolveQuartusVersions } from '../../utils/quartusResolver';
import {
  detectVivadoProjectVersion,
  detectQuartusProjectVersion,
} from './toolchainVersionDetector';

export type Vendor = 'vivado' | 'quartus';

const VENDOR_LABEL: Record<Vendor, string> = { vivado: 'Vivado', quartus: 'Quartus' };

function configuredVersions(cfg: vscode.WorkspaceConfiguration, vendor: Vendor): string[] {
  const installDirs = cfg.get<string[]>(`${vendor}.installDirs`, []);
  const resolved =
    vendor === 'vivado' ? resolveVivadoVersions(installDirs) : resolveQuartusVersions(installDirs);
  return resolved.map((r) => r.version);
}

/**
 * Resolves which configured version to use when opening an existing
 * `.xpr`/`.qpf`, following the design's confidence-tier UX:
 *  - a pinned workspace version skips detection entirely.
 *  - an exact detected version that is configured launches immediately,
 *    with an informational toast (its "Change" action re-opens the picker).
 *  - an exact/ambiguous detected version that is NOT configured warns and
 *    offers "Use <closest> anyway" / "Browse for install dir…" / "Configure
 *    paths" — never silently substitutes.
 *  - ambiguous or no signal falls back to the QuickPick, with any required
 *    candidates from detection listed first.
 * Returns undefined if the user cancels.
 */
export async function resolveToolchainVersionForOpen(
  cfg: vscode.WorkspaceConfiguration,
  vendor: Vendor,
  projectFilePath: string
): Promise<ToolVersionChoice | undefined> {
  const pinned = cfg.get<string>(`${vendor}.pinnedVersion`, '').trim();
  if (pinned) {
    return { runner: 'local', version: pinned };
  }

  const detection =
    vendor === 'vivado'
      ? await detectVivadoProjectVersion(projectFilePath)
      : await detectQuartusProjectVersion(projectFilePath);

  if (detection.confidence !== 'exact') {
    return pickToolVersion(cfg, vendor, detection.candidates);
  }

  const [required] = detection.candidates;
  const available = configuredVersions(cfg, vendor);
  if (available.includes(required)) {
    const change = await vscode.window.showInformationMessage(
      `Opening with ${VENDOR_LABEL[vendor]} ${required} (detected from project)`,
      'Change'
    );
    return change === 'Change'
      ? pickToolVersion(cfg, vendor, [required])
      : { runner: 'local', version: required };
  }

  const closest = findClosestVersion(required, available);
  const actions = [
    ...(closest ? [`Use ${closest} anyway`] : []),
    'Browse for install dir…',
    'Configure paths',
  ];
  const answer = await vscode.window.showWarningMessage(
    `${VENDOR_LABEL[vendor]} ${required} is required but not configured.`,
    ...actions
  );

  if (closest && answer === `Use ${closest} anyway`) {
    return { runner: 'local', version: closest };
  }
  if (answer === 'Configure paths') {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      `ipcraft.${vendor}.installDirs`
    );
    return undefined;
  }
  if (answer === 'Browse for install dir…') {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: 'Use as install directory',
    });
    const dir = picked?.[0]?.fsPath;
    if (!dir) {
      return undefined;
    }
    const current = cfg.get<string[]>(`${vendor}.installDirs`, []);
    await cfg.update(
      `${vendor}.installDirs`,
      [...current, dir],
      vscode.ConfigurationTarget.Workspace
    );
    return pickToolVersion(vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT), vendor, [
      required,
    ]);
  }
  return undefined;
}

/**
 * Resolves which configured version to use when creating a brand-new
 * project (no `.xpr`/`.qpf` exists yet to detect from): pinned workspace
 * version if set, else the QuickPick.
 */
export async function resolveToolchainVersionForCreate(
  cfg: vscode.WorkspaceConfiguration,
  vendor: Vendor
): Promise<ToolVersionChoice | undefined> {
  const pinned = cfg.get<string>(`${vendor}.pinnedVersion`, '').trim();
  if (pinned) {
    return { runner: 'local', version: pinned };
  }
  return pickToolVersion(cfg, vendor);
}
