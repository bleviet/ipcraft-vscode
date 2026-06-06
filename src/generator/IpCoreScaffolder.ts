import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { BusLibraryService } from '../services/BusLibraryService';
import { TemplateLoader } from './TemplateLoader';
import { ScaffoldPackLoader } from './ScaffoldPackLoader';
import {
  checkDuplicatePhysicalPrefixes,
  evalWidthExpr,
  expandBusInterfaces,
  getActiveBusPortsFromDefinition,
  getBusTypeForTemplate,
  hasMemoryMappedSlaveInterface,
  normalizeBusType,
  normalizeIpCoreData,
  prepareRegisters,
  resolveMemoryMaps,
} from './registerProcessor';
import { sortByCompilationOrder } from '../utils/compilationOrder';
import { getToolchain } from '../services/toolchains/registry';
import { generateTestbenchFiles, DEFAULT_FRAMEWORK, DEFAULT_ENGINE } from './testbench';
import { YamlValidator } from '../services/YamlValidator';

/**
 * Resolve the IP core JSON schema path across all runtime environments:
 *   1. Packaged VSIX / compiled bundle: schema is copied by webpack into dist/resources/schemas/
 *   2. Dev (running from dist/ with source tree intact): schema is one level up at ../ipcraft-spec/
 *   3. Tests (ts-jest, __dirname = src/generator/): schema is two levels up at ../../ipcraft-spec/
 *
 * NOTE: With webpack `target:"node"`, `__dirname` inside the output bundle is the OUTPUT file's
 * directory (dist/), not the source file's directory. The original `../../ipcraft-spec/` path
 * resolves correctly from `src/generator/` but goes to the wrong (sibling) repo from `dist/`.
 */
const IP_CORE_SCHEMA_PATH = (() => {
  const rel = (...parts: string[]): string => path.join(__dirname, ...parts);
  // Packaged extension: schema copied to dist/resources/schemas/ by CopyWebpackPlugin
  const fromResources = rel('resources', 'schemas', 'ip_core.schema.json');
  if (existsSync(fromResources)) {
    return fromResources;
  }
  // Dev: running compiled bundle from dist/ with the source tree still present
  const fromRoot = rel('..', 'ipcraft-spec', 'schemas', 'ip_core.schema.json');
  if (existsSync(fromRoot)) {
    return fromRoot;
  }
  // Tests: ts-jest resolves __dirname to src/generator/
  return rel('..', '..', 'ipcraft-spec', 'schemas', 'ip_core.schema.json');
})();
import type {
  BusDefinitions,
  BusPortDefinition,
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

  constructor(logger: Logger, templates: TemplateLoader, context: vscode.ExtensionContext) {
    this.logger = logger;
    this.templates = templates;
    this.busLibraryService = new BusLibraryService(logger, context);
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
      const bahonaviMethodology = options.bahonaviMethodology ?? false;
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
      // Pack is always determined by options (workspace setting / canvas picker).
      // The .ip.yml spec does not carry generation preferences.
      const packName = options.scaffoldPack;
      const workspacePackDirs = this.resolveWorkspacePackDirs();
      const pack = packName
        ? ScaffoldPackLoader.resolve(packName, workspacePackDirs)
        : ScaffoldPackLoader.resolveDefault(bahonaviMethodology);

      // Pack-level template loader: searches pack dir first (user overrides), then built-in templates.
      const packLoader = new TemplateLoader(this.logger, [
        pack.packDir,
        TemplateLoader.resolveTemplatesPath(),
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
          templates: this.templates,
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
            templates: this.templates,
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
      const userPaths = config.get<string[]>('busLibraryPaths', []);
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
    const schemaResult = this.validator.validateAgainstSchema(parsed, IP_CORE_SCHEMA_PATH);
    if (!schemaResult.valid) {
      throw new Error(`IP core YAML schema validation failed: ${schemaResult.error}`);
    }
    return normalizeIpCoreData(parsed as Record<string, unknown>);
  }

  /**
   * Public entry point for building a template context from an IP core YAML path.
   * Used by TemplatePreviewProvider to render .j2 previews without writing files.
   */
  async buildTemplateContextPublic(inputPath: string): Promise<Record<string, unknown>> {
    await this.ensureBusDefinitions();
    const ipCore = await this.loadIpCore(inputPath);
    const busType = getBusTypeForTemplate(ipCore);
    const hasMmSlave = hasMemoryMappedSlaveInterface(ipCore);
    const context = await this.buildTemplateContext(ipCore, busType, inputPath);
    context.has_memory_mapped_slave = hasMmSlave;
    return context;
  }

  private async buildTemplateContext(
    ipCore: IpCoreData,
    busType: string,
    inputPath: string
  ): Promise<Record<string, unknown>> {
    const name = String(ipCore?.vlnv?.name ?? 'ip_core').toLowerCase();
    const registers = await prepareRegisters(ipCore, inputPath);
    const swAccess = new Set([
      'read-write',
      'write-only',
      'rw',
      'wo',
      'read-write-1-to-clear',
      'write-1-to-clear',
    ]);
    const hwAccess = new Set(['read-only', 'ro']);

    const swRegisters = registers.filter((reg) => swAccess.has(this.getString(reg.access)));
    const hwRegisters = registers.filter((reg) => hwAccess.has(this.getString(reg.access)));

    const clocks = ipCore?.clocks ?? [];
    const resets = ipCore?.resets ?? [];
    const clockPort = clocks[0]?.name ?? 'clk';
    const resetPort = resets[0]?.name ?? 'rst';
    const resetPolarity = this.getString(resets[0]?.polarity ?? 'activeHigh');
    const resetActiveHigh = resetPolarity.toLowerCase().includes('high');

    const expandedBusInterfaces = expandBusInterfaces(ipCore);
    const prefixError = checkDuplicatePhysicalPrefixes(ipCore);
    if (prefixError) {
      throw new Error(prefixError);
    }
    const busPorts: Array<Record<string, unknown>> = [];
    const secondaryBusPorts: Array<Record<string, unknown>> = [];
    let busPrefix = 's_axi';

    const parameterNames = (ipCore?.parameters ?? []).map((p) => String(p.name));

    if (expandedBusInterfaces.length > 0) {
      const primary = expandedBusInterfaces[0];
      busPrefix = this.normalizePrefix(primary.physical_prefix ?? '');

      expandedBusInterfaces.forEach((iface, index) => {
        const busTypeInfo = normalizeBusType(this.getString(iface.type));
        const busPortsForType = this.resolvePortsForInterface(
          busTypeInfo.libraryKey,
          this.getString(iface.type)
        );
        const activePorts = getActiveBusPortsFromDefinition(
          busPortsForType,
          iface.use_optional_ports ?? [],
          iface.physical_prefix ?? '',
          iface.mode ?? '',
          iface.port_width_overrides ?? {},
          ipCore?.parameters as
            | { name: string; value?: string | number; data_type?: string }[]
            | undefined
        ) as unknown as (TemplatePort & Record<string, unknown>)[];
        activePorts.forEach((port) => {
          port.tcl_width = toTclWidth(port.width, port.width_expr, parameterNames);
        });
        iface.ports = activePorts;
        if (index === 0) {
          busPorts.push(...activePorts);
        } else {
          secondaryBusPorts.push(...activePorts);
        }
      });
    }

    const userPorts = this.prepareUserPorts(ipCore) as unknown as TemplatePort[];
    userPorts.forEach((port) => {
      port.tcl_width = toTclWidth(port.width, port.width_expr, parameterNames);
    });

    // Collect all parameterized ports for the elaborate proc.
    // add_interface_port with get_parameter_value widths must be inside an elaborate callback,
    // not at global scope. set_port_property WIDTH is deprecated since SOPC 11.0.
    const elaboratePortWidths: Array<{
      iface_name: string;
      port_name: string;
      logical_name: string;
      direction: string;
      tcl_width: string;
    }> = [];
    for (const iface of expandedBusInterfaces) {
      const ifaceName = String((iface as Record<string, unknown>).name ?? '');
      const ifacePorts = (iface as Record<string, unknown>).ports as TemplatePort[] | undefined;
      if (ifacePorts) {
        for (const port of ifacePorts) {
          if (port.is_parameterized && port.tcl_width) {
            elaboratePortWidths.push({
              iface_name: ifaceName,
              port_name: port.name,
              logical_name: String(port.logical_name ?? port.name),
              direction: port.direction,
              tcl_width: port.tcl_width,
            });
          }
        }
      }
    }
    for (const port of userPorts) {
      if (port.is_parameterized && port.tcl_width) {
        elaboratePortWidths.push({
          iface_name: port.name,
          port_name: port.name,
          logical_name: port.name,
          direction: port.direction,
          tcl_width: port.tcl_width,
        });
      }
    }

    const clocksWithPeriod = clocks.map((clock) => ({
      name: clock.name ?? '',
      frequency: clock.frequency ?? null,
      period_ns: parseClockPeriodNs(clock.frequency),
    }));

    return {
      name,
      entity_name: name,
      registers,
      sw_registers: swRegisters,
      hw_registers: hwRegisters,
      generics: this.prepareGenerics(ipCore),
      user_ports: userPorts,
      interrupt_ports: this.prepareInterruptPorts(ipCore),
      bus_type: busType,
      bus_ports: busPorts,
      secondary_bus_ports: secondaryBusPorts,
      expanded_bus_interfaces: expandedBusInterfaces,
      elaborate_port_widths: elaboratePortWidths,
      bus_prefix: expandedBusInterfaces.length > 0 ? busPrefix : 's_axi',
      data_width: 32,
      addr_width: 8,
      reg_width: 4,
      memory_maps: (await resolveMemoryMaps(ipCore, inputPath)) ?? [],
      clock_port: clockPort,
      reset_port: resetPort,
      reset_active_high: resetActiveHigh,
      clocks_with_period: clocksWithPeriod,
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

  private prepareGenerics(ipCore: IpCoreData): Array<Record<string, unknown>> {
    const params = ipCore?.parameters ?? [];
    return params.map((param) => {
      const type = this.getString(param.data_type);
      return {
        name: param.name,
        type,
        sv_type: this.resolveSvGenericType(type),
        default_value: this.resolveGenericDefault(param.value, type),
        sv_default: this.resolveSvGenericDefault(param.value, type),
        description: param.description ? this.getString(param.description) : '',
      };
    });
  }

  private resolveGenericDefault(
    value: number | string | undefined,
    type: string
  ): number | string | null {
    if (value !== undefined && value !== null) {
      return value;
    }
    const t = type.toLowerCase().trim();
    if (t === 'integer' || t === 'natural' || t === 'positive') {
      return 0;
    }
    if (t === 'boolean') {
      return 'false';
    }
    if (t === 'string') {
      return '""';
    }
    return null;
  }

  private resolveSvGenericType(vhdlType: string): string {
    const t = vhdlType.toLowerCase().trim();
    if (t === 'integer' || t === 'natural' || t === 'positive') {
      return 'int';
    }
    if (t === 'boolean') {
      return 'bit';
    }
    if (t === 'string') {
      return 'string';
    }
    return 'int';
  }

  private resolveSvGenericDefault(
    value: number | string | undefined,
    type: string
  ): number | string | null {
    if (value !== undefined && value !== null) {
      return value;
    }
    const t = type.toLowerCase().trim();
    if (t === 'integer' || t === 'natural' || t === 'positive') {
      return 0;
    }
    if (t === 'boolean') {
      return "1'b0";
    }
    if (t === 'string') {
      return '""';
    }
    return null;
  }

  private prepareUserPorts(ipCore: IpCoreData): Array<Record<string, unknown>> {
    const params = ipCore?.parameters ?? [];
    const paramDefaults = new Map<string, number>();
    params.forEach((param) => {
      if (param?.name && param?.value !== undefined) {
        paramDefaults.set(String(param.name), Number(param.value));
      }
    });

    const ports = ipCore?.ports ?? [];
    return ports.map((port) => {
      const direction = this.getString(port.direction).toLowerCase();
      const svDirection = direction === 'in' ? 'input' : direction === 'out' ? 'output' : 'inout';
      const widthValue = port.width ?? 1;
      const isParameterized = typeof widthValue === 'string';

      if (isParameterized) {
        const numericDefault = evalWidthExpr(widthValue, paramDefaults) ?? 32;
        const defaultWidth = numericDefault - 1;
        return {
          name: String(port.name).toLowerCase(),
          direction,
          sv_direction: svDirection,
          type: `std_logic_vector(${widthValue}-1 downto 0)`,
          sv_type: `logic [${widthValue}-1:0]`,
          width: numericDefault,
          width_expr: widthValue,
          is_parameterized: true,
          default_width: defaultWidth,
        };
      }

      const width = Number(widthValue);
      if (width === 1) {
        return {
          name: String(port.name).toLowerCase(),
          direction,
          sv_direction: svDirection,
          type: 'std_logic',
          sv_type: 'logic',
          width: 1,
          width_expr: null,
          is_parameterized: false,
          default_width: null,
        };
      }

      return {
        name: String(port.name).toLowerCase(),
        direction,
        sv_direction: svDirection,
        type: `std_logic_vector(${width - 1} downto 0)`,
        sv_type: `logic [${width - 1}:0]`,
        width,
        width_expr: null,
        is_parameterized: false,
        default_width: null,
      };
    });
  }

  private prepareInterruptPorts(ipCore: IpCoreData): Array<Record<string, unknown>> {
    const interrupts = (ipCore as Record<string, unknown>)?.interrupts as
      | Array<Record<string, unknown>>
      | undefined;
    if (!interrupts || interrupts.length === 0) {
      return [];
    }
    return interrupts.map((intr) => ({
      name: String(intr.name ?? '').toLowerCase(),
      direction: String(intr.direction ?? 'out').toLowerCase(),
      sensitivity: String(intr.sensitivity ?? 'LEVEL_HIGH'),
    }));
  }

  private resolvePortsForInterface(libraryKey: string, ifaceType: string): BusPortDefinition[] {
    const knownPorts = libraryKey ? this.busDefinitions?.[libraryKey]?.ports : undefined;
    if (knownPorts) {
      return knownPorts;
    }
    for (const def of Object.values(this.busDefinitions ?? {})) {
      const bt = (def as { busType?: Record<string, string> }).busType;
      if (!bt?.vendor || !bt.library || !bt.name || !bt.version) {
        continue;
      }
      if (`${bt.vendor}.${bt.library}.${bt.name}.${bt.version}` === ifaceType) {
        return def.ports ?? [];
      }
    }
    return [];
  }

  private normalizePrefix(prefix: string): string {
    if (!prefix) {
      return 's_axi';
    }
    return prefix.endsWith('_') ? prefix.slice(0, -1) : prefix;
  }

  private getString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && value !== null && 'value' in value) {
      return String((value as Record<string, unknown>).value);
    }
    return String(value);
  }
}

function resolveMemmapRelpath(
  ipCore: IpCoreData,
  inputPath: string,
  outputDir: string
): string | undefined {
  const memoryMaps = ipCore.memory_maps as unknown;
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

  // Generated files are inserted in correct dependency order (pkg → top → core → bus → regs)
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

function parseClockPeriodNs(frequency: string | null | undefined): string | null {
  if (!frequency) {
    return null;
  }
  const m = /^(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)$/i.exec(frequency.trim());
  if (!m) {
    return null;
  }
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  let hz: number;
  if (unit === 'ghz') {
    hz = value * 1e9;
  } else if (unit === 'mhz') {
    hz = value * 1e6;
  } else if (unit === 'khz') {
    hz = value * 1e3;
  } else {
    hz = value;
  }
  const periodNs = 1e9 / hz;
  return periodNs.toFixed(3);
}

function toTclWidthExpression(exprStr: string, paramNames: string[]): string {
  let converted = exprStr;
  let hasParam = false;
  const upperParamNames = paramNames.map((p) => p.toUpperCase());

  converted = converted.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
    const upper = match.toUpperCase();
    if (upperParamNames.includes(upper)) {
      hasParam = true;
      return `[get_parameter_value ${upper}]`;
    }
    return match;
  });

  if (!hasParam) {
    return exprStr;
  }

  const isSimpleRef = /^\[get_parameter_value [a-zA-Z0-9_]+\]$/.test(converted.trim());
  if (isSimpleRef) {
    return converted;
  } else {
    return `[expr ${converted}]`;
  }
}

interface TemplatePort extends Record<string, unknown> {
  name: string;
  direction: string;
  width: number | string | null;
  width_expr: string | null;
  is_parameterized: boolean;
  tcl_width?: string;
  logical_name?: string;
  sv_direction?: string;
  type?: string;
  sv_type?: string;
  default_width?: number | null;
}

function toTclWidth(
  width: number | string | null,
  widthExpr: string | null,
  paramNames: string[]
): string {
  if (widthExpr) {
    return toTclWidthExpression(widthExpr, paramNames);
  }
  if (typeof width === 'string') {
    return toTclWidthExpression(width, paramNames);
  }
  return String(width ?? 1);
}
