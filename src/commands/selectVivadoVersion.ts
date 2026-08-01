import * as vscode from 'vscode';
import { pickToolVersion } from '../utils/pickToolVersion';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

export async function selectVivadoVersionCommand(): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  await pickToolVersion(cfg, 'vivado');
}
