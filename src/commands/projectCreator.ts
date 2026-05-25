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
import { getVivadoLauncher } from '../utils/vivadoResolver';
import { getQuartusTool } from '../utils/quartusResolver';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `vivado -mode batch -source <name>_project.tcl` to create the Vivado
 * OOC project (build/ooc/<name>.xpr) without launching synthesis.
 *
 * Returns `true` on success, `false` if the tool is not found or the TCL
 * script does not exist yet.
 */
export async function createVivadoProject(
  name: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const xilinxDir = path.join(ipDir, 'xilinx');
  const projectTcl = `${name}_project.tcl`;

  if (!(await fileExists(path.join(xilinxDir, projectTcl)))) {
    return false;
  }

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const vivadoLauncher = getVivadoLauncher(cfg);
  const vivadoDockerImage = (cfg.get<string>('vivado.dockerImage') ?? '').trim();
  const vivadoDocker = vivadoDockerImage
    ? { image: vivadoDockerImage, mountBase: ipDir }
    : undefined;

  const result = await runProcess(
    vivadoLauncher.exe,
    [...vivadoLauncher.prefixArgs, '-mode', 'batch', '-source', projectTcl, '-nojournal', '-nolog'],
    { cwd: xilinxDir, outputChannel, docker: vivadoDocker }
  );
  return result.success;
}

/**
 * Run `quartus_sh -t <name>_project.tcl` to create the Quartus project
 * (.qpf / .qsf) without running compilation.
 *
 * Returns `true` on success, `false` if the tool is not found or the TCL
 * script does not exist yet.
 */
export async function createQuartusProject(
  name: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const alteraDir = path.join(ipDir, 'altera');
  const projectTcl = path.join(alteraDir, `${name}_project.tcl`);

  if (!(await fileExists(projectTcl))) {
    return false;
  }

  const buildDir = path.join(alteraDir, 'build');
  await fs.mkdir(buildDir, { recursive: true });

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const quartusExe = getQuartusTool(cfg, 'quartus_sh');
  const quartusDockerImage = (cfg.get<string>('quartus.dockerImage') ?? '').trim();
  const quartusDocker = quartusDockerImage
    ? { image: quartusDockerImage, mountBase: ipDir }
    : undefined;

  const result = await runProcess(quartusExe, ['-t', projectTcl], {
    cwd: buildDir,
    outputChannel,
    docker: quartusDocker,
  });
  return result.success;
}
