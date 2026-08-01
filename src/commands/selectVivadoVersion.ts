import * as vscode from 'vscode';
import { pickToolVersion } from '../utils/pickToolVersion';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

export async function selectVivadoVersionCommand(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  await pickToolVersion(cfg, 'vivado');
}
