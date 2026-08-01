import * as vscode from 'vscode';
import { pickToolVersion } from '../utils/pickToolVersion';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

export async function selectQuartusVersionCommand(uri?: vscode.Uri): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }
  const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, resource);
  await pickToolVersion(cfg, 'quartus');
}
