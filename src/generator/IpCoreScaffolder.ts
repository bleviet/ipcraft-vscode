import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { BusLibraryService } from '../services/BusLibraryService';
import { TemplateLoader } from './TemplateLoader';
import {
  expandBusInterfaces,
  getActiveBusPortsFromDefinition,
  getBusTypeForTemplate,
  hasMemoryMappedSlaveInterface,
  normalizeBusType,
  normalizeIpCoreData,
  prepareRegisters,
  resolveMemoryMaps,
} from './registerProcessor';
import { generateComponentXml, generateCustomBusDefs } from './VivadoComponentXmlGenerator';
import type {
  BusDefinitions,
  BusPortDefinition,
  GenerateOptions,
  GenerateResult,
  IpCoreData,
} from './types';

export class IpCoreScaffolder {
  private readonly logger: Logger;
  private readonly templates: TemplateLoader;
  private readonly busLibraryService: BusLibraryService;
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
      const includeRegs = options.includeRegs !== false && hasMmSlave;
      const includeTestbench = options.includeTestbench !== false;
      const vendor = options.vendor ?? 'none';
      const includeVhdl = options.includeVhdl !== false;

      const files: Record<string, string> = {};
      const name = String(ipCoreData?.vlnv?.name ?? 'ip_core').toLowerCase();

      if (includeVhdl) {
        if (hasMmSlave) {
          files[`rtl/${name}_pkg.vhd`] = this.templates.render('package.vhdl.j2', context);
        }
        files[`rtl/${name}.vhd`] = this.templates.render('top.vhdl.j2', context);
        if (hasMmSlave) {
          files[`rtl/${name}_core.vhd`] = this.templates.render('core.vhdl.j2', context);
          files[`rtl/${name}_${busType}.vhd`] = this.templates.render(
            `bus_${busType}.vhdl.j2`,
            context
          );
        }
      }

      if (includeRegs) {
        files[`rtl/${name}_regs.vhd`] = this.templates.render('register_file.vhdl.j2', context);
      }

      if (includeTestbench) {
        files['tb/mm_loader.py'] = this.templates.render('mm_loader.py.j2', context);
        files[`tb/${name}_test.py`] = this.templates.render('cocotb_test.py.j2', context);
        files['tb/conftest.py'] = this.templates.render('cocotb_conftest.py.j2', context);
        files[`tb/test_${name}_sim.py`] = this.templates.render('cocotb_pytest.py.j2', context);
        files['tb/Makefile'] = this.templates.render('cocotb_makefile.j2', context);
        files['.vscode/settings.json'] = this.templates.render('vscode_settings.json.j2', context);
      }

      if (vendor === 'altera' || vendor === 'both') {
        files[`altera/${name}_hw.tcl`] = this.templates.render('altera_hw_tcl.j2', context);
      }

      if (vendor === 'xilinx' || vendor === 'both') {
        const versionStr = String(ipCoreData?.vlnv?.version ?? '1.0').replace(/\./g, '_');
        const xguiFile = `xgui/${name}_v${versionStr}.tcl`;
        const rtlFiles = Object.keys(files)
          .filter((f) => f.startsWith('rtl/'))
          .map((f) => `../${f}`);
        files['xilinx/component.xml'] = generateComponentXml(
          ipCoreData,
          this.busDefinitions ?? {},
          {
            rtlFiles,
            xguiFile,
          }
        );
        const customBusDefs = generateCustomBusDefs(ipCoreData, this.busDefinitions ?? {});
        for (const [relPath, content] of Object.entries(customBusDefs)) {
          files[`xilinx/${relPath}`] = content;
        }
        files[`xilinx/${xguiFile}`] = this.templates.render('amd_xgui.j2', context);
      }

      if (options.includeVivadoProject) {
        const targetPart = options.targetPart ?? 'xc7z020clg484-1';
        const rtlFiles = collectRtlFiles(files, ipCoreData);
        const xdcRelPath = `${name}_ooc.xdc`;
        const vivadoContext = {
          ...context,
          target_part: targetPart,
          rtl_files: rtlFiles,
          xdc_file: xdcRelPath,
        };
        files[`xilinx/${name}_project.tcl`] = this.templates.render(
          'vivado_project.tcl.j2',
          vivadoContext
        );
        files[`xilinx/${xdcRelPath}`] = this.templates.render('vivado_ooc.xdc.j2', vivadoContext);
        files[`xilinx/${name}_run_ooc.tcl`] = this.templates.render(
          'vivado_run_ooc.tcl.j2',
          vivadoContext
        );
        files[`xilinx/${name}_run_xpr.tcl`] = this.templates.render(
          'vivado_run_xpr.tcl.j2',
          vivadoContext
        );
      }

      if (options.includeQuartusProject) {
        const targetDevice = options.quartusDevice ?? '5CSEBA6U23I7';
        const deviceFamily = quartusDeviceFamily(targetDevice);
        const rtlFiles = collectRtlFiles(files, ipCoreData);
        const sdcRelPath = `${name}.sdc`;
        const quartusContext = {
          ...context,
          target_device: targetDevice,
          device_family: deviceFamily,
          rtl_files: rtlFiles,
          sdc_file: sdcRelPath,
        };
        files[`altera/${name}_project.tcl`] = this.templates.render(
          'quartus_project.tcl.j2',
          quartusContext
        );
        files[`altera/${sdcRelPath}`] = this.templates.render('quartus_sdc.j2', quartusContext);
      }

      const written: Record<string, string> = {};

      // Collect paths marked managed: false — these are user-owned and must not be overwritten
      type FileSetEntry = { files?: Array<{ path?: string; managed?: boolean }> };
      const rawFileSets = (ipCoreData as Record<string, unknown>).fileSets as
        | FileSetEntry[]
        | undefined;
      const protectedPaths = new Set<string>();
      for (const fset of rawFileSets ?? []) {
        for (const f of fset.files ?? []) {
          if (f.managed === false && f.path) {
            protectedPaths.add(f.path);
          }
        }
      }

      await Promise.all(
        Object.entries(files).map(async ([relativePath, content]) => {
          if (protectedPaths.has(relativePath)) {
            this.logger.info(`Skipping managed:false file: ${relativePath}`);
            return;
          }
          const fullPath = path.join(outputDir, relativePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf8');
          written[relativePath] = fullPath;
        })
      );

      this.logger.info('Generated VHDL files', {
        count: Object.keys(written).length,
        busType,
        outputDir,
      });

      return {
        success: true,
        files: written,
        count: Object.keys(written).length,
        busType,
      };
    } catch (error) {
      this.logger.error('VHDL generation failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
    return normalizeIpCoreData(parsed as Record<string, unknown>);
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
    const busPorts: Array<Record<string, unknown>> = [];
    const secondaryBusPorts: Array<Record<string, unknown>> = [];
    let busPrefix = 's_axi';

    const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
      axil: 'axi4lite',
      axi4: 'axi4',
      axis: 'axi4stream',
      avmm: 'avalon',
      avst: 'avalon_streaming',
    };

    if (expandedBusInterfaces.length > 0) {
      const primary = expandedBusInterfaces[0];
      busPrefix = this.normalizePrefix(primary.physical_prefix ?? '');

      expandedBusInterfaces.forEach((iface, index) => {
        const busTypeInfo = normalizeBusType(this.getString(iface.type));
        iface.altera_type = TEMPLATE_TYPE_TO_ALTERA[busTypeInfo.templateType] ?? 'conduit';
        const busPortsForType = this.resolvePortsForInterface(
          busTypeInfo.libraryKey,
          this.getString(iface.type)
        );
        const activePorts = getActiveBusPortsFromDefinition(
          busPortsForType,
          iface.use_optional_ports ?? [],
          iface.physical_prefix ?? '',
          iface.mode ?? '',
          iface.port_width_overrides ?? {}
        );
        iface.ports = activePorts;
        if (index === 0) {
          busPorts.push(...activePorts);
        } else {
          secondaryBusPorts.push(...activePorts);
        }
      });
    }

    const clocksWithPeriod = clocks.map((clock) => ({
      name: clock.name ?? '',
      frequency: clock.frequency ?? null,
      period_ns: parseClockPeriodNs(clock.frequency),
    }));

    return {
      entity_name: name,
      registers,
      sw_registers: swRegisters,
      hw_registers: hwRegisters,
      generics: this.prepareGenerics(ipCore),
      user_ports: this.prepareUserPorts(ipCore),
      interrupt_ports: this.prepareInterruptPorts(ipCore),
      bus_type: busType,
      bus_ports: busPorts,
      secondary_bus_ports: secondaryBusPorts,
      expanded_bus_interfaces: expandedBusInterfaces,
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
        default_value: this.resolveGenericDefault(param.value, type),
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
      const widthValue = port.width ?? 1;
      const isParameterized = typeof widthValue === 'string';

      if (isParameterized) {
        const defaultWidth = (paramDefaults.get(widthValue) ?? 32) - 1;
        return {
          name: String(port.name).toLowerCase(),
          direction,
          type: `std_logic_vector(${widthValue}-1 downto 0)`,
          width: null,
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
          type: 'std_logic',
          width: 1,
          width_expr: null,
          is_parameterized: false,
          default_width: null,
        };
      }

      return {
        name: String(port.name).toLowerCase(),
        direction,
        type: `std_logic_vector(${width - 1} downto 0)`,
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

function collectRtlFiles(files: Record<string, string>, ipCoreData: IpCoreData): string[] {
  const fromFiles = Object.keys(files)
    .filter((f) => f.startsWith('rtl/'))
    .map((f) => `../${f}`);
  if (fromFiles.length > 0) {
    return fromFiles;
  }
  type FileSetEntry = { files?: Array<{ path?: string; type?: string }> };
  const fileSets = (ipCoreData as Record<string, unknown>).fileSets as FileSetEntry[] | undefined;
  return (fileSets ?? [])
    .flatMap((fs) => fs.files ?? [])
    .filter((f) => f.type === 'vhdl' && f.path?.startsWith('rtl/'))
    .map((f) => `../${f.path}`);
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

/**
 * Derive Quartus device family string from a part number.
 * Handles the most common Intel/Altera Cyclone, Arria, Stratix and MAX families.
 */
function quartusDeviceFamily(device: string): string {
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
