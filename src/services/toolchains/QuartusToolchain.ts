import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as yaml from 'js-yaml';
import type * as vscode from 'vscode';
import { parseQuartusReports } from '../ReportParser';
import { runProcess } from '../BuildRunner';
import { findInInstallDir, getQuartusTool } from '../../utils/quartusResolver';
import { fileExists } from '../../utils/fsHelpers';
import { normalizeBusType } from '../../generator/registerProcessor';
import { hdlCompileRank } from '../../utils/compilationOrder';
import type { IpCoreData } from '../../generator/types';
import type { DockerConfig, LaunchEnv, SubToolDeclaration } from './LaunchableTool';
import type {
  SynthesisToolchain,
  ScaffoldContext,
  ScaffoldOptions,
  BuildMode,
} from './SynthesisToolchain';

export interface RtlFileEntry {
  path: string;
  name: string;
  hdl_type: string;
  is_top: boolean;
}

/** Infer Quartus HDL type string from a file path extension. */
function hdlTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.sv' || ext === '.svh') {
    return 'SYSTEM_VERILOG';
  }
  return 'VHDL';
}

/** Map an ip.yml fileset `type` field to the Quartus HDL type string. */
function hdlTypeFromFileType(type: string | undefined, isSv: boolean): string {
  if (type === 'systemverilog') {
    return 'SYSTEM_VERILOG';
  }
  if (type === 'vhdl') {
    return 'VHDL';
  }
  return isSv ? 'SYSTEM_VERILOG' : 'VHDL';
}

/**
 * Resolve the list of RTL file entries for the hw.tcl file-set section.
 * Priority:
 *   1. `rtlFiles` — paths provided by the scaffolder (generated this run or from collectRtlFiles).
 *   2. ip.yml `fileSets[RTL_Sources]` — fallback for import/no-generate mode.
 */
export function resolveHwTclRtlFiles(
  rtlFiles: string[] | undefined,
  ipCoreData: IpCoreData,
  isSv: boolean,
  entityName: string
): RtlFileEntry[] {
  // Only the file whose name AND extension matches the primary HDL type is the top-level.
  // This prevents mixed-language projects from marking multiple files as TOP_LEVEL_FILE.
  const topLevelExts = isSv ? ['.sv'] : ['.vhd', '.vhdl'];
  const toEntry = (filePath: string, fileHdlType: string): RtlFileEntry => {
    const name = path.basename(filePath);
    const ext = path.extname(name).toLowerCase();
    const nameNoExt = path.basename(name, path.extname(name));
    const is_top = nameNoExt === entityName && topLevelExts.includes(ext);
    return { path: filePath, name, hdl_type: fileHdlType, is_top };
  };

  if (rtlFiles && rtlFiles.length > 0) {
    return rtlFiles.map((f) => toEntry(f, hdlTypeFromPath(f)));
  }

  type FSEntry = { name?: string; files?: Array<{ path?: string; type?: string }> };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FSEntry[] | undefined;
  if (!Array.isArray(fileSets)) {
    return [];
  }
  const rtlSources = fileSets.find((fs) => fs.name === 'RTL_Sources');
  if (!rtlSources?.files) {
    return [];
  }
  return rtlSources.files
    .filter((f) => f.path)
    .slice()
    .sort((a, b) => hdlCompileRank(a.path!) - hdlCompileRank(b.path!))
    .map((f) => toEntry(`../${f.path!}`, hdlTypeFromFileType(f.type, isSv)));
}

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

/**
 * Returns the longest common ancestor directory of all entries in `dirs`.
 * Used to determine the Docker mount base that covers all referenced files.
 */
function commonAncestorDir(dirs: string[]): string {
  if (dirs.length === 0) {
    return path.sep;
  }
  const parts = dirs.map((d) => path.normalize(d).split(path.sep));
  const first = parts[0];
  let i = 0;
  while (i < first.length && parts.every((p) => p[i] === first[i])) {
    i++;
  }
  return first.slice(0, i).join(path.sep) || path.sep;
}

/**
 * Reads the .ip.yml to find all referenced fileset directories and computes
 * the common ancestor of ipDir and those directories.  This is the minimum
 * host path that must be mounted as /work so Docker Quartus can reach every
 * referenced RTL file, even when they live outside ipDir (e.g. shared libs).
 * Falls back to ipDir when the YAML cannot be read.
 */
async function computeMountBase(name: string, ipDir: string): Promise<string> {
  for (const ext of ['ip.yml', 'ip.yaml']) {
    const yamlPath = path.join(ipDir, `${name}.${ext}`);
    try {
      const content = await fsAsync.readFile(yamlPath, 'utf8');
      const data = yaml.load(content) as Record<string, unknown>;
      type FileSetEntry = { files?: Array<{ path?: string; type?: string }> };
      const fileSets = (data?.fileSets as FileSetEntry[] | undefined) ?? [];
      const HDL_TYPES = new Set(['vhdl', 'systemverilog']);
      const dirs = [
        ipDir,
        ...fileSets
          .flatMap((fs) => fs.files ?? [])
          .filter((f) => HDL_TYPES.has(f.type ?? '') && f.path)
          .map((f) => path.dirname(path.resolve(ipDir, f.path!))),
      ];
      return commonAncestorDir(dirs);
    } catch {
      // try next extension or fall through to default
    }
  }
  return ipDir;
}

export class QuartusToolchain implements SynthesisToolchain {
  readonly id = 'quartus';
  readonly displayName = 'Quartus (Intel/Altera)';
  readonly outputSubdir = 'altera';
  readonly contextKey = 'ipcraft.quartusFound';
  readonly subTools: ReadonlyArray<SubToolDeclaration> = [
    { name: 'qsys-edit', contextKey: 'ipcraft.qsysEditFound' },
  ];

  isSubToolAvailable(toolName: string, cfg: vscode.WorkspaceConfiguration): boolean {
    if (toolName !== 'qsys-edit') {
      return false;
    }
    const runner = cfg.get<string>('quartus.runner', 'local');
    const dockerImage = (cfg.get<string>('quartus.dockerImage') ?? '').trim();
    if (runner === 'docker') {
      return dockerImage.length > 0;
    }
    const installDir = cfg.get<string>('quartus.installDir', '').trim();
    if (installDir) {
      return findInInstallDir(toolName, installDir) !== null;
    }
    if (dockerImage) {
      return true;
    }
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(cmd, [toolName], { stdio: 'pipe' }).status === 0;
  }

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
    const { name, templateContext, templates, ipCoreData, isSv } = ctx;
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

    const rtlFileEntries = resolveHwTclRtlFiles(opts.rtlFiles, ipCoreData, isSv, name);
    files[`altera/${name}_hw.tcl`] = templates.render('altera_hw_tcl.j2', {
      ...templateContext,
      rtl_files: rtlFileEntries,
    });

    files[`altera/test.qsys`] = templates.render('altera_test_system.qsys.j2', templateContext);

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

    const mountBase = await computeMountBase(name, ipDir);
    const docker = this.getDocker(cfg, mountBase);
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
    const mountBase = await computeMountBase(name, ipDir);
    const docker = this.getDocker(cfg, mountBase);
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
