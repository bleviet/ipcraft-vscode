/**
 * Lightweight project-file creation helpers.
 *
 * These functions run only the project-setup TCL (no synthesis/compile) so
 * that the resulting .xpr / .qpf is available for opening in the IDE GUI.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { runProcess } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the vendor-specific project-creation TCL to create the project file
 * (e.g. .xpr / .qpf) without launching synthesis.
 *
 * Returns `true` on success, `false` if the tool is not found or the TCL
 * script does not exist yet.
 */
export async function createVendorProject(
  toolchainId: 'vivado' | 'quartus',
  name: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const toolchain = getToolchain(toolchainId);
  if (!toolchain) {
    return false;
  }

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);
  const vendorDir = path.join(ipDir, toolchain.outputSubdir);

  if (toolchainId === 'vivado') {
    const projectTcl = `${name}_project.tcl`;
    if (!(await fileExists(path.join(vendorDir, projectTcl)))) {
      return false;
    }

    const launcher = toolchain.resolve('vivado', cfg);
    if (!launcher) {
      return false;
    }
    const docker = toolchain.getDocker(cfg, ipDir);

    const result = await runProcess(
      launcher.exe,
      [...launcher.prefixArgs, '-mode', 'batch', '-source', projectTcl, '-nojournal', '-nolog'],
      { cwd: vendorDir, outputChannel, docker, env, extraMounts }
    );
    return result.success;
  }

  if (toolchainId === 'quartus') {
    const projectTcl = path.join(vendorDir, `${name}_project.tcl`);
    if (!(await fileExists(projectTcl))) {
      return false;
    }

    const buildDir = path.join(vendorDir, 'build');
    await fs.mkdir(buildDir, { recursive: true });

    const launcher = toolchain.resolve('quartus_sh', cfg);
    if (!launcher) {
      return false;
    }
    const docker = toolchain.getDocker(cfg, ipDir);

    const result = await runProcess(launcher.exe, ['-t', projectTcl], {
      cwd: buildDir,
      outputChannel,
      docker,
      env,
      extraMounts,
    });
    return result.success;
  }

  return false;
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
