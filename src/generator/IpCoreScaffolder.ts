import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { BusLibraryService } from '../services/BusLibraryService';
import { TemplateLoader } from './TemplateLoader';
import { GenerateOptions, GenerateResult } from './types';

type BusDefinition = {
  ports?: Array<{
    name: string;
    width?: number;
    direction?: string;
    presence?: string;
  }>;
};

type BusDefinitions = Record<string, BusDefinition>;

export interface VlnvDef {
  vendor?: string;
  library?: string;
  name?: string;
  version?: string;
}

export interface BusInterfaceDef {
  name?: string;
  type?: string;
  mode?: string;
  physicalPrefix?: string;
  physical_prefix?: string;
  useOptionalPorts?: string[];
  use_optional_ports?: string[];
  portWidthOverrides?: Record<string, number>;
  port_width_overrides?: Record<string, number>;
  associatedClock?: string;
  associated_clock?: string;
  associatedReset?: string;
  associated_reset?: string;
  array?: {
    count?: number;
    indexStart?: number;
    index_start?: number;
    namingPattern?: string;
    naming_pattern?: string;
    physicalPrefixPattern?: string;
    physical_prefix_pattern?: string;
  };
  ports?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface IpCoreData {
  vlnv?: VlnvDef;
  description?: string;
  parameters?: Array<{
    name?: string;
    value?: number | string;
    data_type?: string;
    dataType?: string;
  }>;
  ports?: Array<{
    name?: string;
    direction?: string;
    width?: number | string;
    presence?: string;
  }>;
  busInterfaces?: BusInterfaceDef[];
  bus_interfaces?: BusInterfaceDef[];
  clocks?: Array<{ name?: string }>;
  resets?: Array<{ name?: string; polarity?: string }>;
  memoryMaps?: Record<string, unknown> | Record<string, unknown>[];
  memory_maps?: Record<string, unknown> | Record<string, unknown>[];
  [key: string]: unknown;
}

export class IpCoreScaffolder {
  private readonly logger: Logger;
  private readonly templates: TemplateLoader;
  private readonly busLibraryService: BusLibraryService;
  private busDefinitions: BusDefinitions | null = null;

  private static readonly BUS_TYPE_MAP: Record<string, string> = {
    AXI4L: 'axil',
    AXI4LITE: 'axil',
    AXILITE: 'axil',
    AVALONMM: 'avmm',
    AVMM: 'avmm',
    AVALON_MM: 'avmm',
    'AVALON-MM': 'avmm',
  };

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
      const busType = this.getBusType(ipCoreData);
      const context = await this.buildTemplateContext(ipCoreData, busType, inputPath);
      const includeRegs = options.includeRegs !== false;
      const includeTestbench = options.includeTestbench === true;
      const vendor = options.vendor ?? 'both';
      const includeVhdl = options.includeVhdl !== false;

      const files: Record<string, string> = {};
      const name = String(ipCoreData?.vlnv?.name ?? 'ip_core').toLowerCase();

      if (includeVhdl) {
        files[`rtl/${name}_pkg.vhd`] = this.templates.render('package.vhdl.j2', context);
        files[`rtl/${name}.vhd`] = this.templates.render('top.vhdl.j2', context);
        files[`rtl/${name}_core.vhd`] = this.templates.render('core.vhdl.j2', context);
        files[`rtl/${name}_${busType}.vhd`] = this.templates.render(
          `bus_${busType}.vhdl.j2`,
          context
        );
      }

      if (includeRegs) {
        files[`rtl/${name}_regs.vhd`] = this.templates.render('register_file.vhdl.j2', context);
      }

      if (includeTestbench) {
        files[`tb/${name}_test.py`] = this.templates.render('cocotb_test.py.j2', context);
        files['tb/Makefile'] = this.templates.render('cocotb_makefile.j2', context);
      }

      if (vendor === 'intel' || vendor === 'both') {
        files[`intel/${name}_hw.tcl`] = this.templates.render('intel_hw_tcl.j2', context);
      }

      if (vendor === 'xilinx' || vendor === 'both') {
        files['xilinx/component.xml'] = this.templates.render('xilinx_component_xml.j2', context);
        const versionStr = String(ipCoreData?.vlnv?.version ?? '1.0').replace(/\./g, '_');
        files[`xilinx/xgui/${name}_v${versionStr}.tcl`] = this.templates.render(
          'xilinx_xgui.j2',
          context
        );
      }

      const written: Record<string, string> = {};
      await Promise.all(
        Object.entries(files).map(async ([relativePath, content]) => {
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
    this.busDefinitions = (library || {}) as BusDefinitions;
  }

  private async loadIpCore(inputPath: string): Promise<IpCoreData> {
    const content = await fs.readFile(inputPath, 'utf8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid IP core YAML');
    }
    return parsed as IpCoreData;
  }

  private getBusType(ipCore: IpCoreData): string {
    const busInterfaces = ipCore?.busInterfaces ?? ipCore?.bus_interfaces ?? [];

    for (const bus of busInterfaces) {
      const mode = this.getString(bus?.mode);
      if (mode === 'slave') {
        const rawType = this.getString(bus?.type).toUpperCase();
        return IpCoreScaffolder.BUS_TYPE_MAP[rawType] || 'axil';
      }
    }

    return 'axil';
  }

  private async buildTemplateContext(
    ipCore: IpCoreData,
    busType: string,
    inputPath: string
  ): Promise<Record<string, unknown>> {
    const name = String(ipCore?.vlnv?.name ?? 'ip_core').toLowerCase();
    const registers = await this.prepareRegisters(ipCore, inputPath);
    const swAccess = new Set(['read-write', 'write-only', 'rw', 'wo']);
    const hwAccess = new Set(['read-only', 'ro']);

    const swRegisters = registers.filter((reg) => swAccess.has(this.getString(reg.access)));
    const hwRegisters = registers.filter((reg) => hwAccess.has(this.getString(reg.access)));

    const clocks = ipCore?.clocks ?? [];
    const resets = ipCore?.resets ?? [];
    const clockPort = clocks[0]?.name ?? 'clk';
    const resetPort = resets[0]?.name ?? 'rst';
    const resetPolarity = this.getString(resets[0]?.polarity ?? 'activeHigh');
    const resetActiveHigh = resetPolarity.toLowerCase().includes('high');

    const expandedBusInterfaces = this.expandBusInterfaces(ipCore);
    const busPorts: Array<Record<string, unknown>> = [];
    const secondaryBusPorts: Array<Record<string, unknown>> = [];
    let busPrefix = 's_axi';

    if (expandedBusInterfaces.length > 0) {
      const primary = expandedBusInterfaces[0];
      busPrefix = this.normalizePrefix(primary.physical_prefix ?? primary.physicalPrefix ?? '');

      expandedBusInterfaces.forEach((iface, index) => {
        const busTypeKey = this.normalizeBusTypeKey(iface.type ?? '');
        const activePorts = this.getActiveBusPorts(
          busTypeKey,
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

    return {
      entity_name: name,
      registers: registers,
      sw_registers: swRegisters,
      hw_registers: hwRegisters,
      generics: this.prepareGenerics(ipCore),
      user_ports: this.prepareUserPorts(ipCore),
      bus_type: busType,
      bus_ports: busPorts,
      secondary_bus_ports: secondaryBusPorts,
      expanded_bus_interfaces: expandedBusInterfaces,
      bus_prefix: expandedBusInterfaces.length > 0 ? busPrefix : 's_axi',
      data_width: 32,
      addr_width: 8,
      reg_width: 4,
      memory_maps: (await this.resolveMemoryMaps(ipCore, inputPath)) ?? [],
      clock_port: clockPort,
      reset_port: resetPort,
      reset_active_high: resetActiveHigh,
      memmap_relpath: `../../${name}.mm.yml`,
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
    return params.map((param) => ({
      name: param.name,
      type: this.getString(param.data_type ?? param.dataType),
      default_value: param.value,
    }));
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

  private expandBusInterfaces(ipCore: IpCoreData): BusInterfaceDef[] {
    const busInterfaces = ipCore?.busInterfaces ?? ipCore?.bus_interfaces ?? [];
    if (!Array.isArray(busInterfaces)) {
      return [];
    }

    const expanded: BusInterfaceDef[] = [];
    for (const iface of busInterfaces) {
      const arrayDef = iface?.array;
      if (arrayDef) {
        const count = Number(arrayDef.count ?? 1);
        const start = Number(arrayDef.indexStart ?? arrayDef.index_start ?? 0);
        for (let i = 0; i < count; i += 1) {
          const idx = start + i;
          const namePattern =
            arrayDef.namingPattern ?? arrayDef.naming_pattern ?? `${String(iface.name)}_{index}`;
          const prefixPattern =
            arrayDef.physicalPrefixPattern ??
            arrayDef.physical_prefix_pattern ??
            `${String(iface.physicalPrefix ?? iface.physical_prefix ?? 's_axi_')}{index}_`;

          expanded.push({
            name: String(namePattern).replace('{index}', String(idx)),
            type: this.getString(iface.type),
            mode: this.getString(iface.mode).toLowerCase(),
            physical_prefix: String(prefixPattern).replace('{index}', String(idx)),
            use_optional_ports: iface.useOptionalPorts ?? iface.use_optional_ports ?? [],
            port_width_overrides: iface.portWidthOverrides ?? iface.port_width_overrides ?? {},
            associated_clock: iface.associatedClock ?? iface.associated_clock,
            associated_reset: iface.associatedReset ?? iface.associated_reset,
          });
        }
      } else {
        expanded.push({
          name: iface.name,
          type: this.getString(iface.type),
          mode: this.getString(iface.mode).toLowerCase(),
          physical_prefix: iface.physicalPrefix ?? iface.physical_prefix ?? 's_axi_',
          use_optional_ports: iface.useOptionalPorts ?? iface.use_optional_ports ?? [],
          port_width_overrides: iface.portWidthOverrides ?? iface.port_width_overrides ?? {},
          associated_clock: iface.associatedClock ?? iface.associated_clock,
          associated_reset: iface.associatedReset ?? iface.associated_reset,
        });
      }
    }

    return expanded;
  }

  private getActiveBusPorts(
    busTypeName: string,
    useOptionalPorts: string[],
    physicalPrefix: string,
    mode: string,
    portWidthOverrides: Record<string, number>
  ): Array<Record<string, unknown>> {
    const busDef = this.busDefinitions?.[busTypeName.toUpperCase()] ?? {};
    const ports = busDef.ports ?? [];
    const optionalSet = new Set(useOptionalPorts || []);
    const activePorts: Array<Record<string, unknown>> = [];

    ports.forEach((port) => {
      const logicalName = port.name;
      if (['ACLK', 'ARESETn', 'clk', 'reset'].includes(logicalName)) {
        return;
      }

      const presence = port.presence ?? 'required';
      const isRequired = presence === 'required';
      const isSelected = optionalSet.has(logicalName);
      if (!isRequired && !isSelected) {
        return;
      }

      let direction = port.direction ?? 'in';
      if (mode === 'slave') {
        direction = direction === 'out' ? 'in' : direction === 'in' ? 'out' : direction;
      }

      let width = port.width ?? 1;
      if (portWidthOverrides?.[logicalName] !== undefined) {
        width = portWidthOverrides[logicalName];
      }

      activePorts.push({
        logical_name: logicalName,
        name: `${physicalPrefix}${logicalName.toLowerCase()}`,
        direction,
        width,
        type: this.getVhdlPortType(Number(width), logicalName),
      });
    });

    return activePorts;
  }

  private getVhdlPortType(width: number, logicalName: string): string {
    if (['AWADDR', 'ARADDR', 'address'].includes(logicalName)) {
      return 'std_logic_vector(C_ADDR_WIDTH-1 downto 0)';
    }
    if (['WDATA', 'RDATA', 'writedata', 'readdata'].includes(logicalName)) {
      return 'std_logic_vector(C_DATA_WIDTH-1 downto 0)';
    }
    if (logicalName === 'WSTRB') {
      return 'std_logic_vector((C_DATA_WIDTH/8)-1 downto 0)';
    }
    if (width === 1) {
      return 'std_logic';
    }
    return `std_logic_vector(${width - 1} downto 0)`;
  }

  private normalizeBusTypeKey(typeName: string): string {
    let key = typeName.toUpperCase();
    if (['AXIL', 'AXI4-LITE', 'AXI4LITE'].includes(key)) {
      key = 'AXI4L';
    } else if (['AVMM', 'AVALON-MM'].includes(key)) {
      key = 'AVALON_MM';
    } else if (key === 'AXIS') {
      key = 'AXIS';
    } else if (key === 'AVALON_ST') {
      key = 'AVALON_ST';
    }
    return key;
  }

  private normalizePrefix(prefix: string): string {
    if (!prefix) {
      return 's_axi';
    }
    return prefix.endsWith('_') ? prefix.slice(0, -1) : prefix;
  }

  private async resolveMemoryMaps(
    ipCore: IpCoreData,
    inputPath: string
  ): Promise<Array<Record<string, unknown>>> {
    const memoryMaps = ipCore?.memoryMaps ?? ipCore?.memory_maps;
    if (!memoryMaps) {
      return [];
    }

    if (!Array.isArray(memoryMaps) && 'import' in memoryMaps) {
      const baseDir = path.dirname(inputPath);
      const importPath = path.resolve(baseDir, memoryMaps.import as string);
      const content = await fs.readFile(importPath, 'utf8');
      const parsed = yaml.load(content);
      if (Array.isArray(parsed)) {
        return parsed as Array<Record<string, unknown>>;
      }
      return parsed ? [parsed as Record<string, unknown>] : [];
    }

    return Array.isArray(memoryMaps) ? memoryMaps : [memoryMaps];
  }

  private async prepareRegisters(
    ipCore: IpCoreData,
    inputPath: string
  ): Promise<Array<Record<string, unknown>>> {
    const memoryMaps = await this.resolveMemoryMaps(ipCore, inputPath);
    const registers: Array<Record<string, unknown>> = [];

    const processRegister = (reg: Record<string, unknown>, baseOffset: number, prefix: string) => {
      const currentOffset =
        baseOffset + this.parseNumber(reg.address_offset ?? reg.addressOffset ?? reg.offset ?? 0);
      const regName = reg.name || 'REG';

      const nestedRegs = reg.registers || [];
      if (Array.isArray(nestedRegs) && nestedRegs.length > 0) {
        const count = Number(reg.count ?? 1) || 1;
        const stride = Number(reg.stride ?? 0) || 0;
        for (let i = 0; i < count; i += 1) {
          const instanceOffset = currentOffset + i * stride;
          const instancePrefix =
            count > 1 ? `${prefix}${String(regName)}_${i}_` : `${prefix}${String(regName)}_`;
          (nestedRegs as Array<Record<string, unknown>>).forEach((child) => {
            processRegister(child, instanceOffset, instancePrefix);
          });
        }
        return;
      }

      const fields = ((reg.fields as Array<Record<string, unknown>>) || []).map((field) => {
        let bitOffset = field.bit_offset ?? field.bitOffset ?? field.bit_range;
        let bitWidth = field.bit_width ?? field.bitWidth ?? field.bitWidth;

        if (bitOffset === undefined || bitWidth === undefined) {
          const parsedBits = this.parseBits(this.getString(field.bits));
          if (bitOffset === undefined) {
            bitOffset = parsedBits.offset;
          }
          if (bitWidth === undefined) {
            bitWidth = parsedBits.width;
          }
        }

        const access = this.getString(field.access || reg.access || 'read-write');
        const resetValue = field.reset_value ?? field.resetValue ?? field.reset ?? 0;

        return {
          name: field.name,
          offset: Number(bitOffset ?? 0),
          width: Number(bitWidth ?? 1),
          access: access.toLowerCase(),
          reset_value: resetValue,
          description: field.description || '',
        };
      });

      const regAccess = this.getString(reg.access || 'read-write');
      registers.push({
        name: `${prefix}${String(regName)}`,
        offset: currentOffset,
        access: regAccess.toLowerCase(),
        description: reg.description || '',
        fields,
      });
    };

    memoryMaps.forEach((map) => {
      const blocks =
        (map.addressBlocks as Array<Record<string, unknown>>) ||
        (map.address_blocks as Array<Record<string, unknown>>) ||
        [];
      blocks.forEach((block) => {
        const baseOffset = this.parseNumber(
          block.base_address ?? block.baseAddress ?? block.offset ?? 0
        );
        const regs = (block.registers as Array<Record<string, unknown>>) || [];
        regs.forEach((reg) => processRegister(reg, baseOffset, ''));
      });
    });

    return registers.sort((a, b) => (a.offset as number) - (b.offset as number));
  }

  private parseBits(bits: string): { offset: number; width: number } {
    if (!bits || typeof bits !== 'string') {
      return { offset: 0, width: 1 };
    }
    const range = bits.match(/\[(\d+):(\d+)\]/);
    if (range) {
      const high = Number(range[1]);
      const low = Number(range[2]);
      return { offset: Math.min(low, high), width: Math.abs(high - low) + 1 };
    }
    const single = bits.match(/\[(\d+)\]/);
    if (single) {
      const bit = Number(single[1]);
      return { offset: bit, width: 1 };
    }
    return { offset: 0, width: 1 };
  }

  private parseNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 0);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
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
