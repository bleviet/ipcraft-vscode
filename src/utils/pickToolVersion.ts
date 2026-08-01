import * as vscode from 'vscode';
import { CONFIG_KEY_IPCRAFT } from './configKeys';
import { resolveVivadoVersions } from './vivadoResolver';
import { resolveQuartusVersions } from './quartusResolver';
import { sortVersionsDescending, type RunnerKind } from './toolchainVersions';

export interface ToolVersionChoice {
  runner: RunnerKind;
  version: string;
}

interface DockerImageSetting {
  label: string;
  image: string;
}

interface ToolVersionPickItem extends vscode.QuickPickItem {
  choice?: ToolVersionChoice;
}

const VENDOR_LABEL: Record<'vivado' | 'quartus', string> = {
  vivado: 'Vivado',
  quartus: 'Quartus',
};

function listConfiguredVersions(
  cfg: vscode.WorkspaceConfiguration,
  vendor: 'vivado' | 'quartus'
): ToolVersionChoice[] {
  const installDirs = cfg.get<string[]>(`${vendor}.installDirs`, []);
  const local =
    vendor === 'vivado' ? resolveVivadoVersions(installDirs) : resolveQuartusVersions(installDirs);
  const dockerImages = cfg.get<DockerImageSetting[]>(`${vendor}.dockerImages`, []);

  return [
    ...local.map((r): ToolVersionChoice => ({ runner: 'local', version: r.version })),
    ...dockerImages.map((d): ToolVersionChoice => ({ runner: 'docker', version: d.label })),
  ];
}

function offerRememberVersion(vendor: 'vivado' | 'quartus', version: string): void {
  void (async () => {
    const answer = await vscode.window.showInformationMessage(
      `Always use ${version} for ${VENDOR_LABEL[vendor]} in this workspace? Set it as default to skip this picker.`,
      'Save to Workspace',
      'Save to User Settings'
    );
    if (!answer) {
      return;
    }
    const target =
      answer === 'Save to Workspace'
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await vscode.workspace
      .getConfiguration(CONFIG_KEY_IPCRAFT)
      .update(`${vendor}.pinnedVersion`, version, target);
  })();
}

/**
 * Shows a QuickPick of every configured version (local + Docker) for `vendor`,
 * with any `requiredVersions` (from project detection) grouped and listed
 * first. Offers a "Remember for this workspace" follow-up prompt that writes
 * `pinnedVersion`. Returns undefined if the user cancels or nothing is
 * configured for this vendor.
 */
export async function pickToolVersion(
  cfg: vscode.WorkspaceConfiguration,
  vendor: 'vivado' | 'quartus',
  requiredVersions: string[] = []
): Promise<ToolVersionChoice | undefined> {
  const all = listConfiguredVersions(cfg, vendor);
  if (all.length === 0) {
    void vscode.window.showWarningMessage(
      `IPCraft: No ${VENDOR_LABEL[vendor]} versions configured. Add install directories or Docker images in Settings → IPCraft.`
    );
    return undefined;
  }

  const requiredSet = new Set(requiredVersions);
  const required = all.filter((c) => requiredSet.has(c.version));
  const rest = all.filter((c) => !requiredSet.has(c.version));
  const local = sortVersionsDescending(
    rest.filter((c) => c.runner === 'local').map((c) => c.version)
  );
  const docker = rest.filter((c) => c.runner === 'docker');

  const items: ToolVersionPickItem[] = [];
  if (required.length > 0) {
    items.push({ label: 'Required by this project', kind: vscode.QuickPickItemKind.Separator });
    for (const c of required) {
      items.push({ label: c.version, description: c.runner, choice: c });
    }
  }
  if (local.length > 0) {
    items.push({ label: 'Local Installs', kind: vscode.QuickPickItemKind.Separator });
    for (const version of local) {
      items.push({ label: version, description: 'local', choice: { runner: 'local', version } });
    }
  }
  if (docker.length > 0) {
    items.push({ label: 'Docker Images', kind: vscode.QuickPickItemKind.Separator });
    for (const c of docker) {
      items.push({ label: c.version, description: 'docker', choice: c });
    }
  }

  const picked = await vscode.window.showQuickPick<ToolVersionPickItem>(items, {
    title: `Select ${VENDOR_LABEL[vendor]} Version`,
    placeHolder: 'Choose which configured version or image to use',
  });

  if (!picked?.choice) {
    return undefined;
  }

  offerRememberVersion(vendor, picked.choice.version);
  return picked.choice;
}
