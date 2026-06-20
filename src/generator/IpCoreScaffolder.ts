import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ResourceRoots } from '../services/ResourceRoots';
import { BusLibraryService } from '../services/BusLibraryService';
import { getVivadoInterfaceCacheDir, pathExists } from '../services/VivadoInterfaceScanner';
import { TemplateLoader } from './TemplateLoader';
import { ScaffoldPackLoader } from './ScaffoldPackLoader';
import {
  getBusTypeForTemplate,
  hasMemoryMappedSlaveInterface,
  normalizeIpCoreData,
  prepareRegisters,
  resolveMemoryMaps,
  projectMemoryMapsForTemplate,
} from './registerProcessor';
import { sortByCompilationOrder } from '../utils/compilationOrder';
import { getToolchain } from '../services/toolchains/registry';
import { generateTestbenchFiles, DEFAULT_FRAMEWORK, DEFAULT_ENGINE } from './testbench';
import { YamlValidator } from '../services/YamlValidator';
import { assertValidContext, CONTRACT_VERSION, checkPackApiVersion } from './contract';
import type { TemplateContext } from './contract';
import { BUS_REGISTRY } from './buses/builtin';
import { clockResetResolver } from './resolvers/clockReset';
import { genericsResolver } from './resolvers/generics';
import { addressingResolver } from './resolvers/addressing';
import { busResolver } from './resolvers/bus';
import { shadowRegistersResolver } from './resolvers/shadowRegisters';
import type { ResolverInput } from './resolvers/types';
import type {
  BusDefinitions,
  GenerateOptions,
  GenerateResult,
  HdlLanguage,
  IpCoreData,
} from './types';

export class IpCoreScaffolder {
  private readonly logger: Logger;
  private readonly templates: TemplateLoader;
  private readonly busLibraryService: BusLibraryService;
  private readonly validator = new YamlValidator();
  private busDefinitions: BusDefinitions | null = null;
  private readonly resourceRoots: ResourceRoots;

  constructor(logger: Logger, templates: TemplateLoader, resourceRoots: ResourceRoots) {
    this.logger = logger;
    this.templates = templates;
    this.resourceRoots = resourceRoots;
    this.busLibraryService = new BusLibraryService(logger, resourceRoots.busDefinitionsDir);
  }

  async generateAll(
    inputPath: string,
    outputDir: string,
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    try {
      await this.ensureBusDefinitions();
      const ipCoreData = await this.loadIpCore(inputPath);

      // Load per-IP custom bus library (useBusLibrary: ./path) without polluting the global cache
      const useBusLib = String((ipCoreData as Record<string, unknown>).useBusLibrary ?? '');
      if (useBusLib) {
        const busLibPath = path.resolve(path.dirname(inputPath), useBusLib);
        const extraDefs = await this.busLibraryService.loadFromDirectories([busLibPath]);
        this.busDefinitions = { ...this.busDefinitions, ...extraDefs } as BusDefinitions;
      }

      const busType = getBusTypeForTemplate(ipCoreData);
      const hasMmSlave = hasMemoryMappedSlaveInterface(ipCoreData);
      const context = await this.buildTemplateContext(ipCoreData, busType, inputPath);
      context.has_memory_mapped_slave = hasMmSlave;
      const memmapRelpath = resolveMemmapRelpath(ipCoreData, inputPath, outputDir);
      if (memmapRelpath !== undefined) {
        context.memmap_relpath = memmapRelpath;
      }
      assertValidContext(context);
      const includeRegs = options.includeRegs !== false && hasMmSlave;
      const includeTestbench = options.includeTestbench !== false;
      const targets = options.targets ?? [];
      // simulation.* in the YAML overrides the workspace-setting defaults
      const simCfg = ipCoreData.simulation;
      const framework = simCfg?.framework ?? options.framework ?? DEFAULT_FRAMEWORK;
      const engine = simCfg?.engine ?? options.engine ?? DEFAULT_ENGINE;
      const includeVhdl = options.includeVhdl !== false;
      const hdlLanguage: HdlLanguage = options.hdlLanguage ?? 'vhdl';
      const isSv = hdlLanguage === 'systemverilog';
      context.hdl_language = hdlLanguage;
      context.is_systemverilog = isSv;
      context.includeRegs = includeRegs;

      // ── Resolve scaffold pack ──────────────────────────────────────────────
      // Cascade: explicit option (settings/picker) > scaffold_pack in .ip.yml
      const packName =
        options.scaffoldPack ??
        (typeof ipCoreData.scaffold_pack === 'string' ? ipCoreData.scaffold_pack : undefined);
      const workspacePackDirs = this.resolveWorkspacePackDirs();
      const scaffoldPackLoader = new ScaffoldPackLoader(this.resourceRoots.builtinPacksDir);
      const pack = packName
        ? scaffoldPackLoader.resolve(packName, workspacePackDirs)
        : scaffoldPackLoader.resolveDefault();
      checkPackApiVersion(pack);
      const resolvedPackName = path.basename(pack.packDir);

      // Pack-level template loader: searches pack dir first (user overrides), then built-in templates.
      const packLoader = new TemplateLoader(this.logger, [
        pack.packDir,
        this.resourceRoots.templatesDir,
      ]);

      const files: Record<string, string> = {};
      const packManagedFalse = new Set<string>();
      const name = String(ipCoreData?.vlnv?.name ?? 'ip_core').toLowerCase();

      // ── RTL files — data-driven from scaffold pack ─────────────────────────
      // Minimal packs (fullGeneration: false) suppress bus/register context so the
      // top-level template renders an empty architecture regardless of bus detection.
      const rtlCtx = pack.fullGeneration ? context : { ...context, has_memory_mapped_slave: false };

      if (includeVhdl) {
        for (const rule of pack.files) {
          if (!packLoader.evaluateCondition(rule.condition, rtlCtx)) {
            continue;
          }
          const sourceName = packLoader.renderString(rule.source, rtlCtx);
          const relativePath = packLoader.renderString(rule.target, rtlCtx);
          files[relativePath] = packLoader.render(sourceName, rtlCtx);
          if (rule.managed === false) {
            packManagedFalse.add(relativePath);
          }
        }
      }

      // ── Testbench ──────────────────────────────────────────────────────────
      // Minimal packs (fullGeneration: false) suppress bus/register context in testbench
      // so the TB doesn't import a package that wasn't generated.
      const tbCtx = pack.fullGeneration ? context : { ...context, has_memory_mapped_slave: false };

      if (includeTestbench) {
        const tbFiles = generateTestbenchFiles(framework, engine, {
          name,
          templateContext: tbCtx,
          templates: packLoader,
          isSv,
          hasMmSlave: pack.fullGeneration ? hasMmSlave : false,
          extraCompileArgs: simCfg?.compileArgs,
          extraSimArgs: simCfg?.simArgs,
          extraEnv: simCfg?.env,
          fileSets: (ipCoreData as Record<string, unknown>).fileSets as
            | import('./testbench/Framework').FileSetEntry[]
            | undefined,
        });
        Object.assign(files, tbFiles);
      }

      // Vendor packaging + optional project files — delegated to toolchain strategies.
      // rtlFiles are shared across targets so we compute them once lazily.
      let cachedRtlFiles: string[] | undefined;
      const getRtlFiles = async (): Promise<string[]> => {
        cachedRtlFiles ??= await collectRtlFiles(files, ipCoreData, inputPath, outputDir);
        return cachedRtlFiles;
      };

      for (const targetId of targets) {
        const toolchain = getToolchain(targetId);
        if (!toolchain) {
          this.logger.warn(`Unknown target '${targetId}' — skipping`);
          continue;
        }
        const isVivado = targetId === 'vivado';
        const isQuartus = targetId === 'quartus';
        const includeProject =
          (isVivado && (options.includeVivadoProject ?? false)) ||
          (isQuartus && (options.includeQuartusProject ?? false));

        // For Vivado, pass generated RTL paths from this run (or undefined when
        // includeVhdl: false so generateComponentXml falls back to fileSets).
        const rtlFilesFromGenerated = Object.keys(files)
          .filter((f) => f.startsWith('rtl/'))
          .map((f) => `../${f}`);
        const scaffoldRtlFiles = includeProject
          ? await getRtlFiles()
          : rtlFilesFromGenerated.length > 0
            ? rtlFilesFromGenerated
            : undefined;

        const vendorFiles = toolchain.scaffold(
          {
            name,
            templateContext: context,
            templates: packLoader,
            ipCoreData,
            busDefinitions: this.busDefinitions ?? {},
            isSv,
          },
          {
            includeProject,
            rtlFiles: scaffoldRtlFiles ?? undefined,
            targetPart: options.targetPart,
            quartusDevice: options.quartusDevice,
          }
        );

        for (const [relPath, content] of Object.entries(vendorFiles)) {
          files[relPath] = content;
        }
      }

      // Collect paths marked managed: false — these are user-owned and must not be overwritten.
      // Sources: (1) fileSets entries in the YAML, (2) scaffold pack managed:false rules.
      type FileSetEntry = { files?: Array<{ path?: string; managed?: boolean }> };
      const rawFileSets = (ipCoreData as Record<string, unknown>).fileSets as
        | FileSetEntry[]
        | undefined;
      const protectedSet = new Set<string>(packManagedFalse);
      for (const fset of rawFileSets ?? []) {
        for (const f of fset.files ?? []) {
          if (f.managed === false && f.path) {
            protectedSet.add(f.path);
          }
        }
      }

      // Dry-run: return generated content without writing to disk.
      // Identify which protected paths already exist so the caller can skip them.
      if (options.dryRun) {
        const protectedOnDisk: string[] = [];
        await Promise.all(
          [...protectedSet]
            .filter((p) => p in files)
            .map(async (relPath) => {
              try {
                await fs.stat(path.join(outputDir, relPath));
                protectedOnDisk.push(relPath);
              } catch {
                // not present on disk — not blocking
              }
            })
        );
        return {
          success: true,
          generatedContents: { ...files },
          protectedPaths: protectedOnDisk,
          resolvedPackName,
          count: Object.keys(files).length,
          busType,
        };
      }

      const written: Record<string, string> = {};
      await Promise.all(
        Object.entries(files).map(async ([relativePath, content]) => {
          const fullPath = path.join(outputDir, relativePath);
          if (protectedSet.has(relativePath)) {
            try {
              await fs.stat(fullPath);
              this.logger.info(`Skipping managed:false file: ${relativePath}`);
              return;
            } catch {
              // File does not exist, proceed to write it
            }
          }
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf8');
          written[relativePath] = fullPath;
        })
      );

      this.logger.info('Generated HDL files', {
        count: Object.keys(written).length,
        busType,
        hdlLanguage,
        outputDir,
      });

      return {
        success: true,
        files: written,
        generatedContents: { ...files },
        resolvedPackName,
        count: Object.keys(written).length,
        busType,
      };
    } catch (error) {
      this.logger.error('HDL generation failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveWorkspacePackDirs(): string[] {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return [];
      }
      return [path.join(workspaceRoot, '.vscode', 'ipcraft', 'packs')];
    } catch {
      return [];
    }
  }

  private async ensureBusDefinitions(): Promise<void> {
    if (this.busDefinitions) {
      return;
    }
    const library = await this.busLibraryService.loadDefaultLibrary();

    let userLibrary: Record<string, unknown> = {};
    try {
      const config = vscode.workspace.getConfiguration('ipcraft');
      const userPaths = [...config.get<string[]>('busLibraryPaths', [])];
      // Cached Vivado interface catalog (if "Scan Vivado Interface Catalog" has been
      // run) — a single global cache shared by every IP core, never duplicated per
      // project. Same merge point used by ImportResolver for the webview.
      const vivadoCacheDir = getVivadoInterfaceCacheDir();
      if (await pathExists(vivadoCacheDir)) {
        userPaths.push(vivadoCacheDir);
      }
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (userPaths.length > 0) {
        userLibrary = await this.busLibraryService.loadFromUserPaths(userPaths, workspaceRoot);
      }
    } catch {
      // VS Code workspace API unavailable (e.g. test environment)
    }

    this.busDefinitions = { ...(library || {}), ...userLibrary } as BusDefinitions;
  }

  private async loadIpCore(inputPath: string): Promise<IpCoreData> {
    const content = await fs.readFile(inputPath, 'utf8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid IP core YAML');
    }
    const schemaPath = path.join(this.resourceRoots.schemasDir, 'ip_core.schema.json');
    const schemaResult = this.validator.validateAgainstSchema(parsed, schemaPath);
    if (!schemaResult.valid) {
      throw new Error(`IP core YAML schema validation failed: ${schemaResult.error}`);
    }
    return normalizeIpCoreData(parsed as Record<string, unknown>);
  }

  /**
   * Public entry point for building a template context from an IP core YAML path.
   * Used by TemplatePreviewProvider to render .j2 previews without writing files.
   */
  async buildTemplateContextPublic(inputPath: string): Promise<TemplateContext> {
    await this.ensureBusDefinitions();
    const ipCore = await this.loadIpCore(inputPath);
    const busType = getBusTypeForTemplate(ipCore);
    const hasMmSlave = hasMemoryMappedSlaveInterface(ipCore);
    const context = await this.buildTemplateContext(ipCore, busType, inputPath);
    context.has_memory_mapped_slave = hasMmSlave;
    assertValidContext(context);
    return context;
  }

  private async buildTemplateContext(
    ipCore: IpCoreData,
    busType: string,
    inputPath: string
  ): Promise<Record<string, unknown>> {
    const name = String(ipCore?.vlnv?.name ?? 'ip_core').toLowerCase();
    const registers = await prepareRegisters(ipCore, inputPath);

    const resolverInput: ResolverInput = {
      ipCore,
      registers,
      busDefinitions: this.busDefinitions ?? {},
      registry: BUS_REGISTRY,
    };

    const shadow = shadowRegistersResolver.resolve(resolverInput);
    const clockReset = clockResetResolver.resolve(resolverInput);
    const bus = busResolver.resolve(resolverInput);
    const generics = genericsResolver.resolve(resolverInput);
    const addressing = addressingResolver.resolve(resolverInput);

    const memoryMaps = projectMemoryMapsForTemplate(
      (await resolveMemoryMaps(ipCore, inputPath)) ?? []
    );

    return {
      contract_version: CONTRACT_VERSION,
      name,
      entity_name: name,
      bus_type: busType,
      ...shadow,
      ...clockReset,
      ...bus,
      ...generics,
      ...addressing,
      memory_maps: memoryMaps,
      memmap_relpath: `../${name}.mm.yml`,
      vendor: ipCore?.vlnv?.vendor,
      library: ipCore?.vlnv?.library,
      version: ipCore?.vlnv?.version,
      description: ipCore?.description ?? '',
      author: ipCore?.vlnv?.vendor,
      display_name: String(ipCore?.vlnv?.name ?? 'ip_core')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    };
  }
}

function resolveMemmapRelpath(
  ipCore: IpCoreData,
  inputPath: string,
  outputDir: string
): string | undefined {
  const memoryMaps = ipCore.memoryMaps;
  if (memoryMaps && !Array.isArray(memoryMaps) && typeof memoryMaps === 'object') {
    const importVal = (memoryMaps as Record<string, unknown>).import;
    if (typeof importVal === 'string') {
      const absPath = path.resolve(path.dirname(inputPath), importVal);
      return path.relative(path.join(outputDir, 'tb'), absPath).replace(/\\/g, '/');
    }
  }
  return undefined;
}

async function collectRtlFiles(
  files: Record<string, string>,
  ipCoreData: IpCoreData,
  inputPath: string,
  outputDir: string
): Promise<string[]> {
  const SIM_PREFIXES = ['tb/', 'sim/', 'simulation/', 'testbench/', 'test/'];
  const isSimPath = (p: string) => SIM_PREFIXES.some((prefix) => p.startsWith(prefix));

  // Scaffold pack generates files in compile order: pkg → regs → core → bus → top
  const fromFiles = Object.keys(files)
    .filter((f) => f.startsWith('rtl/'))
    .map((f) => `../${f}`);
  if (fromFiles.length > 0) {
    return fromFiles;
  }

  // Paths in fileSets are relative to the .ip.yml directory. The generated TCL lives one
  // level inside outputDir (e.g. altera/ or xilinx/), so we compute the path from that
  // subdirectory to each absolute RTL file path to handle cases where inputPath and
  // outputDir are not in the same directory.
  const ipCoreDir = path.dirname(inputPath);
  const tclSubDir = path.join(outputDir, '_sub');
  type FileSetEntry = { name?: string; files?: Array<{ path?: string; type?: string }> };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;

  // Imported IP cores can contain both VHDL and SV files (e.g. when a _hw.tcl sources
  // subpackage TCLs that contribute files in different languages). Include all HDL files
  // and pass the per-file language so the full cross-file dependency graph is built.
  const HDL_TYPES = new Set(['vhdl', 'systemverilog']);
  const fileItems = (fileSets ?? [])
    .filter((fs) => fs.name !== 'Simulation_Resources')
    .flatMap((fs) => fs.files ?? [])
    .filter((f) => HDL_TYPES.has(f.type ?? '') && f.path && !isSimPath(f.path))
    .map((f) => ({
      absPath: path.resolve(ipCoreDir, f.path!),
      language: f.type as 'vhdl' | 'systemverilog',
    }));

  const sortedAbsPaths = await sortByCompilationOrder(
    fileItems.map(({ absPath, language }) => ({ path: absPath, language })),
    async (p) => {
      try {
        return await fs.readFile(p, 'utf8');
      } catch {
        return null;
      }
    }
  );

  return sortedAbsPaths.map((absPath) => path.relative(tclSubDir, absPath).replace(/\\/g, '/'));
}
