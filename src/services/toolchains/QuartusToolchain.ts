import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type * as vscode from 'vscode';
import { parseQuartusReports } from '../ReportParser';
import { runProcess } from '../BuildRunner';
import { findInInstallDir, getQuartusTool } from '../../utils/quartusResolver';
import { fileExists } from '../../utils/fsHelpers';
import { normalizeBusType } from '../../generator/registerProcessor';
import type { DockerConfig, LaunchEnv } from './LaunchableTool';
import type {
  SynthesisToolchain,
  ScaffoldContext,
  ScaffoldOptions,
  BuildMode,
} from './SynthesisToolchain';

/**
 * Map a normalized bus template type (axil, axi4, axis, avmm, avst) to the
 * string Platform Designer's `add_interface` command expects. Anything else
 * falls back to 'conduit', the generic Avalon point-to-point interface.
 */
const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
  axil: 'axi4lite',
  axi4: 'axi4',
  axis: 'axi4stream',
  avmm: 'avalon',
  avst: 'avalon_streaming',
};

export function mapBusTypeToAltera(typeName: string | undefined): string {
  if (!typeName) {
    return 'conduit';
  }
  const info = normalizeBusType(typeName);
  return TEMPLATE_TYPE_TO_ALTERA[info.templateType] ?? 'conduit';
}

/**
 * Derive Quartus device family string from a part number.
 * Handles the most common Intel/Altera Cyclone, Arria, Stratix and MAX families.
 */
export function quartusDeviceFamily(device: string): string {
  const d = device.toUpperCase();
  if (d.startsWith('5C')) {
    return 'Cyclone V';
  }
  if (d.startsWith('10CX')) {
    return 'Cyclone 10 LP';
  }
  if (d.startsWith('10M')) {
    return 'MAX 10';
  }
  if (d.startsWith('EP4CGX')) {
    return 'Cyclone IV GX';
  }
  if (d.startsWith('EP4C')) {
    return 'Cyclone IV E';
  }
  if (d.startsWith('EP3C')) {
    return 'Cyclone III';
  }
  if (d.startsWith('EP2C')) {
    return 'Cyclone II';
  }
  if (d.startsWith('5AGZ')) {
    return 'Arria V GZ';
  }
  if (d.startsWith('5A')) {
    return 'Arria V';
  }
  if (d.startsWith('EP5S')) {
    return 'Stratix V';
  }
  if (d.startsWith('EP4S')) {
    return 'Stratix IV';
  }
  if (d.startsWith('EP3S')) {
    return 'Stratix III';
  }
  return 'Cyclone V';
}

export class QuartusToolchain implements SynthesisToolchain {
  readonly id = 'quartus';
  readonly displayName = 'Quartus (Intel/Altera)';
  readonly outputSubdir = 'altera';
  readonly contextKey = 'ipcraft.quartusFound';

  resolve(subTool: string, cfg: vscode.WorkspaceConfiguration) {
    const exe = getQuartusTool(cfg, subTool);
    return { exe, prefixArgs: [] };
  }

  isAvailable(cfg: vscode.WorkspaceConfiguration): boolean {
    const runner = cfg.get<string>('quartus.runner', 'local');
    const dockerImage = (cfg.get<string>('quartus.dockerImage') ?? '').trim();
    if (runner === 'docker') {
      return dockerImage.length > 0;
    }
    const installDir = cfg.get<string>('quartus.installDir', '').trim();
    if (installDir) {
      return findInInstallDir('quartus_sh', installDir) !== null;
    }
    if (dockerImage) {
      return true;
    }
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(cmd, ['quartus_sh'], { stdio: 'pipe' }).status === 0;
  }

  getDocker(cfg: vscode.WorkspaceConfiguration, mountBase: string): DockerConfig | undefined {
    const runner = cfg.get<string>('quartus.runner', 'local');
    const image = (cfg.get<string>('quartus.dockerImage') ?? '').trim();
    if (runner === 'docker' && image) {
      return { image, mountBase };
    }
    return undefined;
  }

  getLaunchEnv(_cfg: vscode.WorkspaceConfiguration): LaunchEnv {
    return { env: {}, extraMounts: [] };
  }

  scaffold(ctx: ScaffoldContext, opts: ScaffoldOptions): Record<string, string> {
    const { name, templateContext, templates } = ctx;
    const files: Record<string, string> = {};

    // Inject altera_type onto each expanded bus interface so the _hw.tcl
    // template can call `add_interface <name> <altera_type>` directly.
    const expanded = templateContext.expanded_bus_interfaces as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(expanded)) {
      for (const iface of expanded) {
        iface.altera_type = mapBusTypeToAltera(
          typeof iface.type === 'string' ? iface.type : undefined
        );
      }
    }

    files[`altera/${name}_hw.tcl`] = templates.render('altera_hw_tcl.j2', templateContext);

    if (opts.includeProject) {
      const targetDevice = opts.quartusDevice ?? '5CSEBA6U23I7';
      const deviceFamily = quartusDeviceFamily(targetDevice);
      const sdcRelPath = `${name}.sdc`;
      const quartusCtx = {
        ...templateContext,
        target_device: targetDevice,
        device_family: deviceFamily,
        rtl_files: opts.rtlFiles ?? [],
        sdc_file: sdcRelPath,
      };
      files[`altera/${name}_project.tcl`] = templates.render('quartus_project.tcl.j2', quartusCtx);
      files[`altera/${sdcRelPath}`] = templates.render('quartus_sdc.j2', quartusCtx);
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
    const projectTcl = path.join(vendorDir, `${name}_project.tcl`);
    if (!(await fileExists(projectTcl))) {
      return false;
    }

    const buildDir = path.join(vendorDir, 'build');
    await fsAsync.mkdir(buildDir, { recursive: true });

    const launcher = this.resolve('quartus_sh', cfg);
    if (!launcher?.exe) {
      return false;
    }

    const docker = this.getDocker(cfg, ipDir);
    const { env, extraMounts } = this.getLaunchEnv(cfg);

    const result = await runProcess(launcher.exe, ['-t', projectTcl], {
      cwd: buildDir,
      outputChannel,
      docker,
      env,
      extraMounts,
    });
    return result.success;
  }

  async detectBuildModes(
    name: string,
    ipDir: string,
    cfg: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
  ): Promise<BuildMode[]> {
    const alteraDir = path.join(ipDir, this.outputSubdir);
    const projectTcl = path.join(alteraDir, `${name}_project.tcl`);
    if (!(await fileExists(projectTcl))) {
      return [];
    }

    const quartusExe = getQuartusTool(cfg, 'quartus_sh');
    const docker = this.getDocker(cfg, ipDir);
    const { env, extraMounts } = this.getLaunchEnv(cfg);
    const buildDir = path.join(alteraDir, 'build');

    return [
      {
        label: 'Quartus Compile',
        description: 'Full synthesis + fitter + timing — reports in altera/build/output_files/',
        buildDir,
        run: async () => {
          await fsAsync.mkdir(buildDir, { recursive: true });

          const step1 = await runProcess(quartusExe, ['-t', projectTcl], {
            cwd: buildDir,
            outputChannel,
            docker,
            env,
            extraMounts,
          });
          if (!step1.success) {
            return undefined;
          }

          const step2 = await runProcess(quartusExe, ['--flow', 'compile', name], {
            cwd: buildDir,
            outputChannel,
            docker,
            env,
            extraMounts,
          });
          return step2.success ? parseQuartusReports(buildDir, name) : undefined;
        },
      },
    ];
  }
}
