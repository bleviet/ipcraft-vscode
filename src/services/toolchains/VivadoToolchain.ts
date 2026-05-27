import * as path from 'path';
import { spawnSync } from 'child_process';
import type * as vscode from 'vscode';
import {
  crc32Hex,
  generateComponentXml,
  generateCustomBusDefs,
} from '../../generator/VivadoComponentXmlGenerator';
import { parseVivadoReports } from '../ReportParser';
import { runProcess } from '../BuildRunner';
import { findVivadoInInstallDir, getVivadoLauncher } from '../../utils/vivadoResolver';
import { fileExists } from '../../utils/fsHelpers';
import type { DockerConfig, LaunchEnv, SubToolDeclaration } from './LaunchableTool';
import type {
  SynthesisToolchain,
  ScaffoldContext,
  ScaffoldOptions,
  BuildMode,
} from './SynthesisToolchain';

export class VivadoToolchain implements SynthesisToolchain {
  readonly id = 'vivado';
  readonly displayName = 'Vivado (Xilinx/AMD)';
  readonly outputSubdir = 'xilinx';
  readonly contextKey = 'ipcraft.vivadoFound';
  readonly subTools: ReadonlyArray<SubToolDeclaration> = [];

  isSubToolAvailable(_toolName: string, _cfg: import('vscode').WorkspaceConfiguration): boolean {
    return false;
  }

  resolve(subTool: string, cfg: vscode.WorkspaceConfiguration) {
    // subTool is ignored — Vivado exposes a single launcher for all operations.
    return getVivadoLauncher(cfg);
  }

  isAvailable(cfg: vscode.WorkspaceConfiguration): boolean {
    const runner = cfg.get<string>('vivado.runner', 'local');
    const dockerImage = (cfg.get<string>('vivado.dockerImage') ?? '').trim();
    if (runner === 'docker') {
      return dockerImage.length > 0;
    }
    const installDir = cfg.get<string>('vivado.installDir', '').trim();
    if (installDir) {
      return findVivadoInInstallDir(installDir) !== null;
    }
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(cmd, ['vivado'], { stdio: 'pipe' }).status === 0;
  }

  getDocker(cfg: vscode.WorkspaceConfiguration, mountBase: string): DockerConfig | undefined {
    const runner = cfg.get<string>('vivado.runner', 'local');
    const image = (cfg.get<string>('vivado.dockerImage') ?? '').trim();
    if (runner === 'docker' && image) {
      return { image, mountBase };
    }
    return undefined;
  }

  getLaunchEnv(_cfg: vscode.WorkspaceConfiguration): LaunchEnv {
    return { env: {}, extraMounts: [] };
  }

  scaffold(ctx: ScaffoldContext, opts: ScaffoldOptions): Record<string, string> {
    const { name, templateContext, templates, ipCoreData, busDefinitions, isSv } = ctx;
    const files: Record<string, string> = {};

    const versionStr = String(ipCoreData?.vlnv?.version ?? '1.0').replace(/\./g, '_');
    const xguiFile = `xgui/${name}_v${versionStr}.tcl`;
    const xguiContent = templates.render('amd_xgui.j2', templateContext);
    const xguiChecksum = crc32Hex(xguiContent);

    files[`xilinx/component.xml`] = generateComponentXml(ipCoreData, busDefinitions, {
      rtlFiles: opts.rtlFiles,
      xguiFile,
      xguiChecksum,
      isSv,
    });

    const customBusDefs = generateCustomBusDefs(ipCoreData, busDefinitions);
    for (const [relPath, content] of Object.entries(customBusDefs)) {
      files[`xilinx/${relPath}`] = content;
    }
    files[`xilinx/${xguiFile}`] = xguiContent;

    if (opts.includeProject) {
      const targetPart = opts.targetPart ?? 'xc7z020clg484-1';
      const xdcRelPath = `${name}_ooc.xdc`;
      const vivadoCtx = {
        ...templateContext,
        target_part: targetPart,
        rtl_files: opts.rtlFiles ?? [],
        xdc_file: xdcRelPath,
      };
      files[`xilinx/${name}_project.tcl`] = templates.render('vivado_project.tcl.j2', vivadoCtx);
      files[`xilinx/${xdcRelPath}`] = templates.render('vivado_ooc.xdc.j2', vivadoCtx);
      files[`xilinx/${name}_run_ooc.tcl`] = templates.render('vivado_run_ooc.tcl.j2', vivadoCtx);
      files[`xilinx/${name}_run_xpr.tcl`] = templates.render('vivado_run_xpr.tcl.j2', vivadoCtx);
    }

    return files;
  }

  async createProject(
    name: string,
    ipDir: string,
    cfg: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
  ): Promise<boolean> {
    const vendorDir = path.join(ipDir, this.outputSubdir);
    const projectTcl = `${name}_project.tcl`;
    if (!(await fileExists(path.join(vendorDir, projectTcl)))) {
      return false;
    }

    const launcher = this.resolve('vivado', cfg);
    if (!launcher) {
      return false;
    }

    const docker = this.getDocker(cfg, ipDir);
    const { env, extraMounts } = this.getLaunchEnv(cfg);

    const result = await runProcess(
      launcher.exe,
      [...launcher.prefixArgs, '-mode', 'batch', '-source', projectTcl, '-nojournal', '-nolog'],
      { cwd: vendorDir, outputChannel, docker, env, extraMounts }
    );
    return result.success;
  }

  async detectBuildModes(
    name: string,
    ipDir: string,
    cfg: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
  ): Promise<BuildMode[]> {
    const xilinxDir = path.join(ipDir, this.outputSubdir);
    const launcher = getVivadoLauncher(cfg);
    const docker = this.getDocker(cfg, ipDir);
    const { env, extraMounts } = this.getLaunchEnv(cfg);
    const jobs = cfg.get<number>('build.jobs') ?? 4;
    const modes: BuildMode[] = [];

    if (await fileExists(path.join(xilinxDir, `${name}_run_ooc.tcl`))) {
      const buildDir = path.join(xilinxDir, 'build', 'ooc');
      modes.push({
        label: 'Vivado OOC Synthesis',
        description: 'Out-of-context synthesis — reports in xilinx/build/ooc/',
        buildDir,
        run: async () => {
          const result = await runProcess(
            launcher.exe,
            [
              ...launcher.prefixArgs,
              '-mode',
              'batch',
              '-source',
              `${name}_run_ooc.tcl`,
              '-nojournal',
              '-nolog',
              '-tclargs',
              String(jobs),
            ],
            { cwd: xilinxDir, outputChannel, docker, env, extraMounts }
          );
          return result.success ? parseVivadoReports(buildDir, 'ooc') : undefined;
        },
      });
    }

    if (await fileExists(path.join(xilinxDir, `${name}_run_xpr.tcl`))) {
      const buildDir = path.join(xilinxDir, 'build', 'xpr');
      modes.push({
        label: 'Vivado Full Implementation (XPR)',
        description: 'Synthesis + place + route — reports in xilinx/build/xpr/',
        buildDir,
        run: async () => {
          const result = await runProcess(
            launcher.exe,
            [
              ...launcher.prefixArgs,
              '-mode',
              'batch',
              '-source',
              `${name}_run_xpr.tcl`,
              '-nojournal',
              '-nolog',
              '-tclargs',
              String(jobs),
            ],
            { cwd: xilinxDir, outputChannel, docker, env, extraMounts }
          );
          return result.success ? parseVivadoReports(buildDir, 'xpr') : undefined;
        },
      });
    }

    return modes;
  }
}
