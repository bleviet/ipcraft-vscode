import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ResourceRoots } from '../services/ResourceRoots';
import { BusLibraryService } from '../services/BusLibraryService';
import { getVivadoInterfaceCacheDir, pathExists } from '../services/VivadoInterfaceScanner';
import { getWorkspaceBusDefinitionScanner } from '../services/WorkspaceBusDefinitionScanner';
import { TemplateLoader } from './TemplateLoader';
import { resolveScaffoldOutputPath, ScaffoldPackLoader } from './ScaffoldPackLoader';
import {
  getBusTypeForTemplate,
  hasMemoryMappedSlaveInterface,
  prepareRegisters,
  resolveMemoryMaps,
  projectMemoryMapsForTemplate,
} from './registerProcessor';
import { loadIpCoreData } from './loadIpCore';
import { sortByCompilationOrder, hdlLanguageFromPath } from '../utils/compilationOrder';
import { getToolchain } from '../services/toolchains/registry';
import { generateTestbenchFiles, DEFAULT_FRAMEWORK, DEFAULT_ENGINE } from './testbench';
import {
  assertValidContext,
  CONTRACT_VERSION,
  checkPackApiVersion,
  checkPackRequirements,
} from './contract';
import type { TemplateContext } from './contract';
import { BUS_REGISTRY } from './buses/builtin';
import { clockResetResolver } from './resolvers/clockReset';
import { genericsResolver } from './resolvers/generics';
import { addressingResolver } from './resolvers/addressing';
import { busResolver } from './resolvers/bus';
import { shadowRegistersResolver } from './resolvers/shadowRegisters';
import type { ResolverInput } from './resolvers/types';
import type { NormalizedMemoryMap } from '../domain/internal.types';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import type {
  BusDefinitions,
  GenerateOptions,
  GenerateResult,
  HdlLanguage,
  IpCoreData,
} from './types';
import { packOwnsGeneratedTree, shouldGenerateFrameworkTestbench } from './scaffoldPackOwnership';
import { DEFAULT_INDENT_SIZE, DEFAULT_INDENT_STYLE, reindentGeneratedSources } from './reindent';

/**
 * Add the POSIX executable bits (owner/group/other +x) to a freshly written file, preserving
 * every other permission bit (issue #153). Filesystems that don't support POSIX permission bits
 * (e.g. some Windows/exFAT mounts) reject or ignore chmod; that's treated as a no-op rather than
 * a generation failure so the same manifest stays portable across platforms.
 */
export async function applyExecutableMode(fullPath: string, logger: Logger): Promise<void> {
  try {
    const stat = await fs.stat(fullPath);
    const modeWithExecute = stat.mode | 0o111;
    if (modeWithExecute !== stat.mode) {
      await fs.chmod(fullPath, modeWithExecute);
    }
  } catch (error) {
    logger.warn(`Could not set executable bit on ${fullPath}`, error as Error);
  }
}

/**
 * Path prefixes IPCraft treats as "simulation content" — the same convention
 * `collectRtlAbsPaths` uses to exclude testbench sources from RTL compile order. Reused here to
 * detect when a scaffold pack's own file rules already render under one of these conventional
 * directories (issue #156).
 */
const SIM_PREFIXES = ['tb/', 'sim/', 'simulation/', 'testbench/', 'test/'];
const isSimulationPath = (p: string): boolean =>
  SIM_PREFIXES.some((prefix) => p.startsWith(prefix));

export class IpCoreScaffolder {
  private readonly logger: Logger;
  private readonly templates: TemplateLoader;
  private readonly busLibraryService: BusLibraryService;
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
      const ipCoreDir = path.dirname(inputPath);

      // Load per-IP custom bus library (useBusLibrary: ./path) without polluting the global cache
      const useBusLib = String((ipCoreData as Record<string, unknown>).useBusLibrary ?? '');
      if (useBusLib) {
        const busLibPath = path.resolve(ipCoreDir, useBusLib);
        const extraDefs = await this.busLibraryService.loadFromDirectories([busLibPath]);
        this.busDefinitions = { ...this.busDefinitions, ...extraDefs } as BusDefinitions;
      }

      const busType = getBusTypeForTemplate(ipCoreData);
      const hasMmSlave = hasMemoryMappedSlaveInterface(ipCoreData);
      // Resolve memory maps once: shared by the template context (RTL/testbench)
      // and the vendor packaging step (component.xml <spirit:memoryMaps>).
      const resolvedMemoryMaps = await resolveMemoryMaps(ipCoreData, inputPath);
      const context = await this.buildTemplateContext(
        ipCoreData,
        busType,
        inputPath,
        resolvedMemoryMaps
      );
      context.has_memory_mapped_slave = hasMmSlave;
      const memmapRelpath = resolveMemmapRelpath(ipCoreData, inputPath, outputDir);
      if (memmapRelpath !== undefined) {
        context.memmap_relpath = memmapRelpath;
      }
      assertValidContext(context);
      const includeRegs = options.includeRegs !== false && hasMmSlave;
      const includeTestbench = options.includeTestbench !== false;
      const includeDocs = options.includeDocs === true;
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
      checkPackRequirements(pack, {
        hdlLanguage,
        busType,
        hasMemoryMappedSlave: hasMmSlave,
        activeBusPortNames: extractActiveBusPortNames(context),
      });
      const resolvedPackName = path.basename(pack.packDir);
      const packOwnsOutput = packOwnsGeneratedTree(pack);

      // Pack-level template loader: searches pack dir first (user overrides), then built-in templates.
      const packLoader = new TemplateLoader(this.logger, [
        pack.packDir,
        this.resourceRoots.templatesDir,
      ]);

      let files: Record<string, string> = {};
      const packManagedFalse = new Set<string>();
      const executableTargets = new Set<string>();
      const name = String(ipCoreData?.vlnv?.name ?? 'ip_core').toLowerCase();

      // User-declared managed:false paths (fileSets in the .ip.yml) that collide with a
      // scaffold-pack target — e.g. a no-bus IP whose hand-authored top lives at the same
      // path the pack would otherwise stub out (rtl/<name>.sv). These must never be
      // (re)generated, even on the very first run before the user has created the file —
      // unlike pack-declared managed:false rules (see packManagedFalse below), which exist
      // specifically to seed a first-time stub for the user to then take ownership of.
      const userManagedPaths = collectUserManagedPaths(ipCoreData);

      // ── RTL files — data-driven from scaffold pack ─────────────────────────
      // Minimal packs (fullGeneration: false) suppress bus/register context so the
      // top-level template renders an empty architecture regardless of bus detection.
      // Endianness reflow is suppressed too: it needs a generated core to wire through,
      // which a minimal pack never produces.
      const rtlCtx = pack.fullGeneration
        ? context
        : {
            ...context,
            has_memory_mapped_slave: false,
            has_endian_swap: false,
            endian_swap_ports: [],
            endian_swap_widths: [],
          };

      if (includeVhdl) {
        for (const rule of pack.files) {
          if (!packLoader.evaluateCondition(rule.condition, rtlCtx)) {
            continue;
          }
          const sourceName = packLoader.renderString(rule.source, rtlCtx);
          const relativePath = packLoader.renderString(rule.target, rtlCtx);
          if (userManagedPaths.has(relativePath)) {
            this.logger.info(
              `Skipping scaffold target owned by fileSets managed:false: ${relativePath}`
            );
            continue;
          }
          files[relativePath] = packLoader.render(sourceName, rtlCtx);
          if (rule.managed === false) {
            packManagedFalse.add(relativePath);
          }
          if (rule.executable === true) {
            executableTargets.add(relativePath);
          }
        }
      }

      // ── Testbench ──────────────────────────────────────────────────────────
      // Minimal packs (fullGeneration: false) suppress bus/register context in testbench
      // so the TB doesn't import a package that wasn't generated.
      const tbCtx = pack.fullGeneration ? context : { ...context, has_memory_mapped_slave: false };

      // Files the pack's own rules already rendered under a conventional simulation directory
      // (tb/, sim/, simulation/, testbench/, test/) — computed before the framework testbench is
      // merged in, so it reflects only what the pack itself owns (issue #156).
      const packOwnSimPaths = Object.keys(files).filter(isSimulationPath);
      const warnings: string[] = [];
      let frameworkTestbenchPaths: string[] = [];

      if (includeTestbench && shouldGenerateFrameworkTestbench(pack)) {
        const tbFiles = generateTestbenchFiles(framework, engine, {
          name,
          templateContext: tbCtx,
          templates: packLoader,
          isSv,
          hasMmSlave: pack.fullGeneration ? hasMmSlave : false,
          topLevel: simCfg?.topLevel,
          extraCompileArgs: simCfg?.compileArgs,
          extraSimArgs: simCfg?.simArgs,
          extraEnv: simCfg?.env,
          fileSets: (ipCoreData as Record<string, unknown>).fileSets as
            | import('./testbench/Framework').FileSetEntry[]
            | undefined,
          rtlSourceFiles: await collectTestbenchRtlFiles(files, ipCoreData, inputPath, outputDir),
        });
        frameworkTestbenchPaths = Object.keys(tbFiles);
        Object.assign(files, tbFiles);

        // The pack already looks like it ships its own simulation environment, but never made
        // an explicit choice about IPCraft's framework testbench — flag it so the ambiguity is
        // visible before the output is staged/written, instead of silently blending a second,
        // unrelated simulation environment into the generated tree (issue #156). A pack that
        // explicitly set generateFrameworkTestbench (either value) made a deliberate choice and
        // never warrants this warning.
        if (!pack.generateFrameworkTestbenchDeclared && packOwnSimPaths.length > 0) {
          warnings.push(
            `Scaffold pack '${resolvedPackName}' renders its own simulation-looking output ` +
              `(e.g. ${packOwnSimPaths[0]}) but does not declare 'generateFrameworkTestbench' ` +
              `in scaffold.yml. IPCraft's default framework testbench (tb/*, .vscode/settings.json) ` +
              `will also be generated alongside it. If this pack owns its complete simulation ` +
              `environment, set 'generateFrameworkTestbench: false' in the pack manifest.`
          );
        }
      }

      // ── Documentation (datasheet) ──────────────────────────────────────────
      // IPCraft-owned output: rendered directly from the full context (not rtlCtx/tbCtx)
      // so ports/params/registers are present for packs that rely on IPCraft extras.
      // A pack inferred to own its complete tree must not receive a separate docs/ subtree.
      if (includeDocs && !packOwnsOutput) {
        const docTarget = `docs/${name}_datasheet.md`;
        if (!userManagedPaths.has(docTarget)) {
          files[docTarget] = packLoader.render('ip_datasheet.md.j2', context);
        }
      }

      // Vendor packaging + optional project files — delegated to toolchain strategies.
      // rtlFiles are shared across targets so we compute them once lazily.
      let cachedRtlFiles: string[] | undefined;
      const getRtlFiles = async (): Promise<string[]> => {
        cachedRtlFiles ??= await collectRtlFiles(files, ipCoreData, inputPath, outputDir);
        return cachedRtlFiles;
      };

      for (const targetId of packOwnsOutput ? [] : targets) {
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

        // Always resolve through collectRtlFiles so RTL files hand-authored by the user and
        // declared in fileSets (not generated by the scaffold pack this run) are still
        // included in the vendor packaging output, not just the generated ones.
        const scaffoldRtlFiles = await getRtlFiles();

        const vendorFiles = await toolchain.scaffold(
          {
            name,
            templateContext: context,
            templates: packLoader,
            ipCoreData,
            busDefinitions: this.busDefinitions ?? {},
            isSv,
            memoryMaps: resolvedMemoryMaps,
            ipCoreDir,
          },
          {
            includeProject,
            rtlFiles: scaffoldRtlFiles.length > 0 ? scaffoldRtlFiles : undefined,
            targetPart: options.targetPart,
            quartusDevice: options.quartusDevice,
          }
        );

        for (const [relPath, content] of Object.entries(vendorFiles)) {
          files[relPath] = content;
        }
      }

      files = reindentGeneratedSources(
        files,
        options.indentStyle ?? DEFAULT_INDENT_STYLE,
        options.indentSize ?? DEFAULT_INDENT_SIZE
      );

      // Surface fileSets HDL entries the pack never generates at all (issue #93) so they show
      // up in the Scaffold/Regenerate review list instead of silently vanishing from it. Only
      // meaningful when regenerating in place (outputDir is the .ip.yml's own directory) — into
      // a different directory, the file doesn't exist there yet regardless.
      const extraUserPaths = new Set<string>();
      if (path.resolve(outputDir) === path.resolve(ipCoreDir)) {
        const extraPaths = collectUserDeclaredExtraPaths(ipCoreData, files);
        await Promise.all(
          extraPaths.map(async (relativePath) => {
            try {
              files[relativePath] = await fs.readFile(path.join(ipCoreDir, relativePath), 'utf8');
              extraUserPaths.add(relativePath);
            } catch {
              // Declared in fileSets but not created on disk yet — nothing to show.
            }
          })
        );
      }

      // Collect paths marked managed: false — these are user-owned and must not be overwritten.
      // Sources: (1) fileSets entries in the YAML, (2) scaffold pack managed:false rules,
      // (3) fileSets entries the pack has no rule for at all (always protected — there is no
      // template to safely regenerate them from).
      const protectedSet = new Set<string>([
        ...packManagedFalse,
        ...userManagedPaths,
        ...extraUserPaths,
      ]);

      // Resolve every path before any write starts. Validating inside the Promise.all write
      // callback would allow safe siblings to be written before an unsafe target rejects.
      const outputPaths = new Map(
        Object.keys(files).map((relativePath) => [
          relativePath,
          resolveScaffoldOutputPath(outputDir, relativePath),
        ])
      );

      // Dry-run: return generated content without writing to disk.
      // Identify which protected paths already exist so the caller can skip them.
      if (options.dryRun) {
        const protectedOnDisk: string[] = [];
        await Promise.all(
          [...protectedSet]
            .filter((p) => p in files)
            .map(async (relPath) => {
              try {
                await fs.stat(outputPaths.get(relPath)!);
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
          userManagedPaths: [...userManagedPaths],
          executablePaths: [...executableTargets].filter((p) => p in files),
          frameworkTestbenchPaths,
          warnings,
          resolvedPackName,
          count: Object.keys(files).length,
          busType,
        };
      }

      const written: Record<string, string> = {};
      await Promise.all(
        Object.entries(files).map(async ([relativePath, content]) => {
          const fullPath = outputPaths.get(relativePath)!;
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
          if (executableTargets.has(relativePath)) {
            await applyExecutableMode(fullPath, this.logger);
          }
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
        executablePaths: [...executableTargets].filter((p) => p in written),
        frameworkTestbenchPaths,
        warnings,
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
    let workspaceLibrary: Record<string, unknown> = {};
    try {
      const config = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
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

    // Include bus definitions discovered in the workspace (via .busdef.yml files or
    // IP-XACT bus/abstraction definition XML pairs) so that port maps are emitted
    // for workspace-local custom bus types in component.xml, matching what the
    // Inspector already shows via WorkspaceBusDefinitionScanner.
    // Uses its own try/catch so a missing VS Code config block above does not
    // prevent workspace-discovered definitions from reaching the generator.
    try {
      const wsScanResult = await getWorkspaceBusDefinitionScanner().scan();
      workspaceLibrary = wsScanResult.library;
    } catch {
      // WorkspaceBusDefinitionScanner unavailable (e.g. test environment)
    }

    // Merge order: default library < workspace scan < explicitly configured user paths.
    // Explicit user paths win over workspace-discovered definitions; workspace wins over
    // the bundled defaults.
    this.busDefinitions = {
      ...(library || {}),
      ...workspaceLibrary,
      ...userLibrary,
    } as BusDefinitions;
  }

  private async loadIpCore(inputPath: string): Promise<IpCoreData> {
    return loadIpCoreData(inputPath, this.resourceRoots);
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
    inputPath: string,
    resolvedMemoryMaps?: NormalizedMemoryMap[]
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
      resolvedMemoryMaps ?? (await resolveMemoryMaps(ipCore, inputPath)) ?? []
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
      author: ipCore?.author ?? '',
      display_name: String(ipCore?.vlnv?.name ?? 'ip_core')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    };
  }
}

/**
 * Logical port names active on the IP core's primary bus interface, read off the template
 * context's `bus_ports` (built once in buildTemplateContext, independent of the resolved
 * scaffold pack) for the requirements check in checkPackRequirements (issue #152).
 */
function extractActiveBusPortNames(context: Record<string, unknown>): string[] {
  const busPorts = context.bus_ports;
  if (!Array.isArray(busPorts)) {
    return [];
  }
  return busPorts
    .map((port) => {
      const p = port as Record<string, unknown>;
      return String(p.logical_name ?? p.name ?? '');
    })
    .filter((name) => name.length > 0);
}

/**
 * Paths declared managed: false in the .ip.yml's fileSets — these are user-owned and, when
 * they collide with a scaffold-pack target, must never be (re)generated (issue #75). The full
 * set (regardless of collision) is surfaced on GenerateResult.userManagedPaths in dry-run mode
 * — see `ipcraft verify`'s orphaned-file scan, which needs paths that don't collide too.
 */
function collectUserManagedPaths(ipCoreData: IpCoreData): Set<string> {
  type FileSetEntry = { files?: Array<{ path?: string; managed?: boolean }> };
  const rawFileSets = (ipCoreData as Record<string, unknown>).fileSets as
    | FileSetEntry[]
    | undefined;
  const paths = new Set<string>();
  for (const fset of rawFileSets ?? []) {
    for (const f of fset.files ?? []) {
      if (f.managed === false && f.path) {
        paths.add(f.path);
      }
    }
  }
  return paths;
}

const EXTRA_HDL_FILE_TYPES = new Set(['vhdl', 'verilog', 'systemverilog']);

/**
 * fileSets HDL entries the scaffold pack has no rule for at all — e.g. an additional
 * hand-authored module the user added directly to fileSets, not a stub the pack ever
 * generated (issue #93). These never appear in `files` above (no template renders them), so
 * without this they're invisible to the Scaffold/Regenerate review list even though they're a
 * real, tracked part of the project — indistinguishable, from the user's point of view, from
 * the list simply having dropped their file.
 */
function collectUserDeclaredExtraPaths(
  ipCoreData: IpCoreData,
  files: Record<string, string>
): string[] {
  type FileSetEntry = { name?: string; files?: Array<{ path?: string; type?: string }> };
  const rawFileSets = (ipCoreData as Record<string, unknown>).fileSets as
    | FileSetEntry[]
    | undefined;
  const extras: string[] = [];
  for (const fset of rawFileSets ?? []) {
    if (fset.name === 'Simulation_Resources') {
      continue;
    }
    for (const f of fset.files ?? []) {
      if (f.path && EXTRA_HDL_FILE_TYPES.has(f.type ?? '') && !(f.path in files)) {
        extras.push(f.path);
      }
    }
  }
  return extras;
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

/**
 * Resolve the full, compile-ordered list of RTL source files for an IP core — the union of
 * files the scaffold pack generated this run and any hand-authored ones declared in the
 * .ip.yml's fileSets (typically managed: false) that the pack did not itself generate.
 * Returns absolute paths; callers relativize to wherever they need to reference them from.
 */
export async function collectRtlAbsPaths(
  files: Record<string, string>,
  ipCoreData: IpCoreData,
  inputPath: string,
  outputDir: string
): Promise<string[]> {
  const isSimPath = isSimulationPath;

  // Paths in fileSets are relative to the .ip.yml directory.
  const ipCoreDir = path.dirname(inputPath);

  // Scaffold pack generates files in compile order: pkg → regs → core → bus → top
  const generatedRelPaths = Object.keys(files).filter((f) => f.startsWith('rtl/'));
  // Same-stem check ignores the extension: a fileSets entry left over from a previous
  // generation in the *other* HDL language (e.g. rtl/foo.vhd on disk while this run
  // regenerates rtl/foo.sv) names the same conceptual file the pack just (re)generated,
  // just under its old extension — it must not also be pulled in as "extra" content.
  const stripExt = (p: string) => p.replace(/\.[^./]+$/, '');
  const generatedStemSet = new Set(generatedRelPaths.map(stripExt));

  // Imported IP cores can contain both VHDL and SV files (e.g. when a _hw.tcl sources
  // subpackage TCLs that contribute files in different languages). Include all HDL files
  // and pass the per-file language so the full cross-file dependency graph is built.
  type FileSetEntry = {
    name?: string;
    files?: Array<{ path?: string; type?: string; logicalName?: string }>;
  };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;

  // Resolve a fileSets entry's compile-order language, or undefined when it is genuinely
  // not an RTL file (xdc/sdc/pdf/...) and must stay excluded. Explicit vhdl/systemverilog/
  // verilog all win as-is — 'verilog' (plain, non-SV) gets the same real module/`define`
  // dependency parsing as SystemVerilog (issue #91 — don't silently drop or skip-parse
  // legitimately-typed RTL files); a missing/unrecognized type is rescued from the file
  // extension before falling back to exclusion.
  const resolveExtraLanguage = (f: { path: string; type?: string }): string | undefined => {
    if (f.type === 'vhdl' || f.type === 'systemverilog') {
      return f.type;
    }
    if (f.type === 'verilog') {
      return 'verilog';
    }
    return hdlLanguageFromPath(f.path);
  };

  // Files declared in fileSets that the scaffold pack did not (re)generate this run —
  // typically hand-authored user logic (e.g. managed: false) that still needs to be
  // referenced from the vendor packaging output (component.xml, hw.tcl, project TCLs)
  // and the testbench build. De-dupe against the generated set by the fileSets-declared
  // relative path with its extension stripped (fileSets paths resolve against ipCoreDir
  // while generated paths resolve against outputDir, two directories that are almost
  // never the same, so we can't dedupe by resolved absolute path either).
  const extraFileItems = (fileSets ?? [])
    .filter((fs) => fs.name !== 'Simulation_Resources')
    .flatMap((fs) => fs.files ?? [])
    .filter(
      (f): f is { path: string; type?: string; logicalName?: string } =>
        typeof f.path === 'string' && f.path.length > 0 && !isSimPath(f.path)
    )
    .filter((f) => !generatedStemSet.has(stripExt(f.path)))
    .map((f) => ({
      path: f.path,
      language: resolveExtraLanguage(f),
      logicalName: f.logicalName,
    }))
    .filter(
      (f): f is { path: string; language: string; logicalName: string | undefined } =>
        f.language !== undefined
    )
    .map((f) => ({
      absPath: path.resolve(ipCoreDir, f.path),
      language: f.language,
      logicalName: f.logicalName,
    }));

  if (generatedRelPaths.length === 0 && extraFileItems.length === 0) {
    return [];
  }
  if (extraFileItems.length === 0) {
    // No user-authored extras beyond what the pack generated this run — keep the pack's
    // own compile order rather than re-deriving it from file content.
    return generatedRelPaths.map((f) => path.resolve(outputDir, f));
  }

  // Merge the generated files with the extra user-declared ones and derive a full compile
  // order across both, since the user's files may depend on (or be depended on by) the
  // generated package/register/core files.
  const generatedItems = generatedRelPaths.map((relPath) => ({
    absPath: path.resolve(outputDir, relPath),
    relPath: relPath as string | undefined,
    language: relPath.endsWith('.sv') ? ('systemverilog' as const) : ('vhdl' as const),
    logicalName: undefined as string | undefined,
  }));
  const combined = [
    ...generatedItems,
    ...extraFileItems.map((f) => ({ ...f, relPath: undefined as string | undefined })),
  ];
  const relPathByAbsPath = new Map(combined.map((item) => [item.absPath, item.relPath]));

  return sortByCompilationOrder(
    combined.map(({ absPath, language, logicalName }) => ({
      path: absPath,
      language,
      logicalName,
    })),
    async (p) => {
      const relPath = relPathByAbsPath.get(p);
      if (relPath !== undefined) {
        return files[relPath] ?? null;
      }
      try {
        return await fs.readFile(p, 'utf8');
      } catch {
        return null;
      }
    }
  );
}

/**
 * RTL source paths for vendor packaging (component.xml, hw.tcl, project TCLs), which live
 * one level inside outputDir (e.g. xilinx/ or altera/) — paths are relativized from there.
 */
async function collectRtlFiles(
  files: Record<string, string>,
  ipCoreData: IpCoreData,
  inputPath: string,
  outputDir: string
): Promise<string[]> {
  const tclSubDir = path.join(outputDir, '_sub');
  const absPaths = await collectRtlAbsPaths(files, ipCoreData, inputPath, outputDir);
  return absPaths.map((absPath) => path.relative(tclSubDir, absPath).replace(/\\/g, '/'));
}

/**
 * RTL source paths for the testbench build, relative to outputDir directly (matching the
 * `BASE_DIR = $(CURDIR)/..` / `BASE_DIR.parent` convention used from tb/).
 */
async function collectTestbenchRtlFiles(
  files: Record<string, string>,
  ipCoreData: IpCoreData,
  inputPath: string,
  outputDir: string
): Promise<string[]> {
  const absPaths = await collectRtlAbsPaths(files, ipCoreData, inputPath, outputDir);
  return absPaths.map((absPath) => path.relative(outputDir, absPath).replace(/\\/g, '/'));
}
