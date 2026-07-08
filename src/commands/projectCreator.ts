/**
 * Lightweight project-file creation helpers.
 *
 * Thin wrapper that delegates to the toolchain strategy's createProject().
 */

import * as vscode from 'vscode';
import { getToolchain } from '../services/toolchains/registry';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

/**
 * Run the vendor-specific project-creation TCL via the toolchain strategy.
 *
 * Returns `true` on success, `false` if the toolchain is unknown, the tool
 * is not found, or the TCL script does not exist yet.
 */
export async function createVendorProject(
  toolchainId: string,
  name: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const toolchain = getToolchain(toolchainId);
  if (!toolchain) {
    return false;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  return toolchain.createProject(name, ipDir, cfg, outputChannel);
}

/** Convenience wrapper — kept for backward compat with GenerateCommands callers. */
export async function createVivadoProject(
  name: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  return createVendorProject('vivado', name, ipDir, outputChannel);
}

/** Convenience wrapper — kept for backward compat with GenerateCommands callers. */
export async function createQuartusProject(
  name: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  return createVendorProject('quartus', name, ipDir, outputChannel);
}
