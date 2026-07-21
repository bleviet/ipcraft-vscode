import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

const logger = new Logger('OpenInVivado');

/**
 * Walk up from `startDir` looking for a directory that directly contains
 * `component.xml` (the Vivado IP package root). Returns that directory or
 * null if not found within `maxLevels` parent directories.
 */
function findIpDir(startDir: string, maxLevels = 5): string | null {
  let dir = startDir;
  for (let i = 0; i < maxLevels; i++) {
    if (fs.existsSync(path.join(dir, 'component.xml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * Write a transient startup Tcl script to `ipDir` that opens `xprPath` and
 * registers `ipDir` as an IP repository so block designs can discover this IP.
 * Returns the absolute path to the written script.
 */
function writeStartupScript(ipDir: string, xprPath: string): string {
  const relXpr = path.relative(ipDir, xprPath).replace(/\\/g, '/');
  const content = [
    '# IPCraft: Vivado startup script — automatically generated, do not edit.',
    'set script_dir [file normalize [file dirname [info script]]]',
    '',
    '# Open the project',
    `open_project [file join $script_dir {${relXpr}}]`,
    '',
    '# Register this IP core directory as a Vivado IP repository so that',
    '# block designs can discover and instantiate this component.',
    'set_property IP_REPO_PATHS [list $script_dir] [current_project]',
    'update_ip_catalog -rebuild -quiet',
    '',
    'puts "IPCraft: project opened and IP repository configured."',
  ].join('\n');

  const scriptPath = path.join(ipDir, 'ipcraft_open.tcl');
  fs.writeFileSync(scriptPath, content, 'utf8');
  return scriptPath;
}

export async function openInVivadoCommand(uri?: vscode.Uri): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }

  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.xpr')) {
    void vscode.window.showErrorMessage('No Vivado project file (.xpr) selected.');
    return;
  }

  const xprPath = targetUri.fsPath;
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const toolchain = getToolchain('vivado');
  if (!toolchain) {
    return;
  }

  const launcher = toolchain.resolve('vivado', cfg);
  if (!launcher) {
    return;
  }

  // Mount the workspace root so Vivado can resolve all source paths stored as
  // absolute references inside the .xpr.
  const mountDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(xprPath);
  const docker = toolchain.getDocker(cfg, mountDir);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  // Detect the IP directory (the directory containing component.xml, typically
  // xilinx/ from the IP root).  If found, write a startup script that opens
  // the project AND registers the IP repository in one step.
  const ipDir = findIpDir(path.dirname(xprPath));
  if (ipDir) {
    logger.info(`IP directory detected: ${ipDir} — registering as IP repository`);
    const startupScript = writeStartupScript(ipDir, xprPath);
    logger.info(`Opening Vivado with startup script: ${startupScript}`);

    spawnGui(
      launcher.exe,
      [...launcher.prefixArgs, '-mode', 'gui', '-source', startupScript],
      { cwd: ipDir, docker, env, extraMounts },
      toolchain.displayName
    );
  } else {
    // No component.xml found nearby — open the project directly.
    logger.info(`Opening Vivado project: ${xprPath}`);
    spawnGui(
      launcher.exe,
      [...launcher.prefixArgs, xprPath],
      { cwd: path.dirname(xprPath), docker, env, extraMounts },
      toolchain.displayName
    );
  }
}
