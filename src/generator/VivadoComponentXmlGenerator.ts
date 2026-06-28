import {
  evalWidthExpr,
  getActiveBusPortsFromDefinition,
  expandBusInterfaces,
  normalizeBusType,
} from './registerProcessor';
import { parse, serialize, IPXACT_UNSUPPORTED } from '../shared/widthExprAst';
import { detectVivadoVersion } from '../utils/detectVivadoVersion';
import { parseVlnv, isValidVlnv } from '../utils/vlnv';
import { BUS_VLNV } from '../shared/busVlnv';
import type {
  NormalizedAddressBlock,
  NormalizedField,
  NormalizedMemoryMap,
  NormalizedRegister,
} from '../domain/internal.types';
import type {
  BusDefinitions,
  BusInterfaceDef,
  BusPortDefinition,
  IpCoreData,
  ParameterDef,
  SubcoreRef,
} from './types';

// ── Custom bus definition support ─────────────────────────────────────────────

export interface CustomBusInfo {
  vendor: string;
  library: string;
  name: string;
  version: string;
  description: string;
  ports: BusPortDefinition[];
  /** 'vivado' when this definition came from a local Vivado install scan rather than
   *  a user-authored custom bus definition — see BusDefinition.source. */
  source?: string;
}

function findCustomBusDef(ifaceType: string, busDefinitions: BusDefinitions): CustomBusInfo | null {
  if (resolveVivadoBusType(ifaceType)) {
    return null;
  }
  for (const def of Object.values(busDefinitions)) {
    const bt = def.busType;
    if (!bt?.vendor || !bt.library || !bt.name || !bt.version) {
      continue;
    }
    const vlnv = `${bt.vendor}:${bt.library}:${bt.name}:${bt.version}`;
    if (vlnv === ifaceType) {
      return {
        vendor: bt.vendor,
        library: bt.library,
        name: bt.name,
        version: bt.version,
        description: bt.description ?? '',
        ports: def.ports ?? [],
        source: def.source,
      };
    }
  }
  return null;
}

function busDefPortMaps(
  ports: BusPortDefinition[],
  iface: BusInterfaceDef,
  mode: string
): string[] {
  const activePorts = getActiveBusPortsFromDefinition(
    ports as Array<{ name: string; width?: number; direction?: string; presence?: string }>,
    iface.useOptionalPorts ?? [],
    String(iface.physicalPrefix ?? ''),
    mode,
    iface.portWidthOverrides ?? {},
    undefined,
    undefined,
    iface.absentPorts
  );
  if (activePorts.length === 0) {
    return [];
  }
  const lines: string[] = ['      <spirit:portMaps>'];
  for (const port of activePorts) {
    lines.push('        <spirit:portMap>');
    lines.push('          <spirit:logicalPort>');
    lines.push(`            <spirit:name>${x(String(port.logical_name))}</spirit:name>`);
    lines.push('          </spirit:logicalPort>');
    lines.push('          <spirit:physicalPort>');
    lines.push(`            <spirit:name>${x(String(port.name))}</spirit:name>`);
    lines.push('          </spirit:physicalPort>');
    lines.push('        </spirit:portMap>');
  }
  lines.push('      </spirit:portMaps>');
  return lines;
}

export function renderBusDefinitionXml(busInfo: CustomBusInfo): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<spirit:busDefinition',
    '  xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <spirit:vendor>${x(busInfo.vendor)}</spirit:vendor>`,
    `  <spirit:library>${x(busInfo.library)}</spirit:library>`,
    `  <spirit:name>${x(busInfo.name)}</spirit:name>`,
    `  <spirit:version>${x(busInfo.version)}</spirit:version>`,
    '  <spirit:directConnection>false</spirit:directConnection>',
    '  <spirit:isAddressable>false</spirit:isAddressable>',
  ];
  if (busInfo.description) {
    lines.push(`  <spirit:description>${x(busInfo.description)}</spirit:description>`);
  }
  lines.push('</spirit:busDefinition>');
  return lines.join('\n');
}

export function renderAbstractionDefinitionXml(busInfo: CustomBusInfo): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<spirit:abstractionDefinition',
    '  xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <spirit:vendor>${x(busInfo.vendor)}</spirit:vendor>`,
    `  <spirit:library>${x(busInfo.library)}</spirit:library>`,
    `  <spirit:name>${x(busInfo.name)}_rtl</spirit:name>`,
    `  <spirit:version>${x(busInfo.version)}</spirit:version>`,
    `  <spirit:busType spirit:vendor="${x(busInfo.vendor)}" spirit:library="${x(busInfo.library)}" spirit:name="${x(busInfo.name)}" spirit:version="${x(busInfo.version)}"/>`,
    '  <spirit:ports>',
  ];

  for (const port of busInfo.ports) {
    const logicalName = String(port.name);
    if (['ACLK', 'ARESETn', 'clk', 'reset'].includes(logicalName)) {
      continue;
    }
    const presence = port.presence ?? 'required';
    const masterDir = port.direction ?? 'out';
    const slaveDir = masterDir === 'out' ? 'in' : 'out';
    const width = port.width ?? 1;

    lines.push('    <spirit:port>');
    lines.push(`      <spirit:logicalName>${x(logicalName)}</spirit:logicalName>`);
    lines.push('      <spirit:wire>');
    lines.push('        <spirit:onMaster>');
    lines.push(`          <spirit:presence>${x(presence)}</spirit:presence>`);
    lines.push(`          <spirit:width>${width}</spirit:width>`);
    lines.push(`          <spirit:direction>${x(masterDir)}</spirit:direction>`);
    lines.push('        </spirit:onMaster>');
    lines.push('        <spirit:onSlave>');
    lines.push(`          <spirit:presence>${x(presence)}</spirit:presence>`);
    lines.push(`          <spirit:width>${width}</spirit:width>`);
    lines.push(`          <spirit:direction>${x(slaveDir)}</spirit:direction>`);
    lines.push('        </spirit:onSlave>');
    lines.push('      </spirit:wire>');
    lines.push('    </spirit:port>');
  }

  lines.push('  </spirit:ports>');
  lines.push('</spirit:abstractionDefinition>');
  return lines.join('\n');
}

/**
 * Generate busDefinition and abstractionDefinition XML files for any custom
 * (non-standard) bus interfaces referenced by the IP core. Returns a map of
 * relative paths → file contents, intended to be placed inside the amd/ output
 * directory alongside component.xml.
 */
export function generateCustomBusDefs(
  ipCore: IpCoreData,
  busDefinitions: BusDefinitions
): Record<string, string> {
  const files: Record<string, string> = {};
  const seen = new Set<string>();

  // Build parameter defaults map so string port widths can be resolved to numbers
  const paramDefaults: Record<string, number> = {};
  for (const p of ipCore.parameters ?? []) {
    if (p.name && typeof p.value === 'number') {
      paramDefaults[String(p.name)] = p.value;
    }
  }

  for (const iface of ipCore.busInterfaces ?? []) {
    const ifaceType = String(iface.type ?? '');
    if (seen.has(ifaceType)) {
      continue;
    }
    seen.add(ifaceType);
    const custom = findCustomBusDef(ifaceType, busDefinitions);
    // Vivado-discovered interfaces (e.g. fifo_write) already ship their own
    // busDefinition/abstractionDefinition XML inside the Vivado install — only
    // user-authored custom interfaces need IPCraft to generate and bundle one.
    if (!custom || custom.source === 'vivado') {
      continue;
    }

    // Resolve any parameter-name widths to their numeric defaults so the
    // generated Vivado XML contains concrete numbers, not raw parameter strings.
    const resolvedPorts = custom.ports.map((p) => ({
      ...p,
      width: typeof p.width === 'string' ? (paramDefaults[p.width] ?? 1) : (p.width ?? 1),
    }));
    const customResolved: CustomBusInfo = { ...custom, ports: resolvedPorts };

    files[`busdef/${custom.name}.xml`] = renderBusDefinitionXml(customResolved);
    files[`busdef/${custom.name}_rtl.xml`] = renderAbstractionDefinitionXml(customResolved);
  }

  return files;
}

// ── Vivado bus type mapping ───────────────────────────────────────────────────

interface VivadoBusTypeInfo {
  vendor: string;
  library: string;
  name: string;
  abstraction: string;
  protocol?: string;
  libraryKey: string;
}

const IPCRAFT_TO_VIVADO: Record<string, VivadoBusTypeInfo> = {
  [BUS_VLNV.AXI4_LITE]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4LITE',
    libraryKey: 'AXI4_LITE',
  },
  [BUS_VLNV.AXI4_FULL]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4',
    libraryKey: 'AXI4_FULL',
  },
  [BUS_VLNV.AXI_STREAM]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'axis',
    abstraction: 'axis_rtl',
    libraryKey: 'AXI_STREAM',
  },
  [BUS_VLNV.AVALON_MM]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'avalon',
    abstraction: 'avalon_rtl',
    libraryKey: 'AVALON_MEMORY_MAPPED',
  },
};

/**
 * Resolves an interface type string (short alias, VLNV, or full VLNV) to a
 * VivadoBusTypeInfo entry. Falls back to normalizeBusType() alias resolution so
 * that short tokens produced by the parser (e.g. 'AXI4L', 'AXI4F', 'AXI4S')
 * map correctly even if not listed as explicit keys in IPCRAFT_TO_VIVADO.
 */
function resolveVivadoBusType(ifaceType: string): VivadoBusTypeInfo | undefined {
  const direct = IPCRAFT_TO_VIVADO[ifaceType];
  if (direct) {
    return direct;
  }
  const { libraryKey } = normalizeBusType(ifaceType);
  if (!libraryKey) {
    return undefined;
  }
  return Object.values(IPCRAFT_TO_VIVADO).find((v) => v.libraryKey === libraryKey);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ComponentXmlOptions {
  filePathPrefix?: string;
  rtlFiles?: string[];
  simFiles?: string[];
  xguiFile?: string;
  xguiChecksum?: string;
  displayName?: string;
  isSv?: boolean;
  /**
   * Resolved memory maps (from the IP's `.mm.yml`) to serialize into the
   * `<spirit:memoryMaps>` section. When absent or empty, no memory-map section
   * is emitted (the Spirit XSD allows it to be omitted).
   */
  memoryMaps?: NormalizedMemoryMap[];
}

/**
 * Standard CRC32 (IEEE 802.3 / zlib) matching Vivado's checksum algorithm.
 * Returns the 8-character lowercase hex string Vivado embeds in CHECKSUM_ tags.
 */
export function crc32Hex(content: string): string {
  const buf = Buffer.from(content, 'utf8');
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (~crc >>> 0).toString(16).padStart(8, '0');
}

export function generateComponentXml(
  ipCore: IpCoreData,
  busDefinitions: BusDefinitions,
  options: ComponentXmlOptions = {}
): string {
  const {
    filePathPrefix = '../',
    rtlFiles,
    simFiles,
    xguiFile,
    xguiChecksum,
    displayName,
    isSv = false,
    memoryMaps,
  } = options;

  const vendor = String(ipCore.vlnv?.vendor ?? 'user');
  const library = String(ipCore.vlnv?.library ?? 'ip');
  const name = String(ipCore.vlnv?.name ?? 'ip_core');
  const version = String(ipCore.vlnv?.version ?? '1.0.0');
  const description = String(ipCore.description ?? '');
  const clocks = ipCore.clocks ?? [];
  const resets = ipCore.resets ?? [];
  // Use expanded bus interfaces so array-type entries produce one entry per instance.
  const busInterfaces = expandBusInterfaces(ipCore);
  const userPorts = ipCore.ports ?? [];
  const parameters = ipCore.parameters ?? [];
  const interrupts =
    ((ipCore as Record<string, unknown>).interrupts as Array<{
      name: string;
      direction: string;
      sensitivity?: string;
    }>) ?? [];

  const derivedDisplayName =
    displayName ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const versionStr = version.replace(/\./g, '_');
  const derivedXguiFile = xguiFile ?? `xgui/${name}_v${versionStr}.tcl`;

  const resolvedRtlFiles = rtlFiles ?? getFileSetPaths(ipCore, 'RTL_Sources', filePathPrefix) ?? [];
  const resolvedSimFiles =
    simFiles ?? rtlFiles ?? getFileSetPaths(ipCore, 'RTL_Sources', filePathPrefix) ?? [];

  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<spirit:component xmlns:xilinx="http://www.xilinx.com"');
  lines.push('  xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"');
  lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');

  lines.push(`  <spirit:vendor>${x(vendor)}</spirit:vendor>`);
  lines.push(`  <spirit:library>${x(library)}</spirit:library>`);
  lines.push(`  <spirit:name>${x(name)}</spirit:name>`);
  lines.push(`  <spirit:version>${x(version)}</spirit:version>`);

  // ── busInterfaces ─────────────────────────────────────────────────────────
  // Spirit XSD requires busInterfaces to be absent when empty — never emit an
  // empty <spirit:busInterfaces/> element.

  const busIfLines: string[] = [];

  for (const iface of busInterfaces) {
    busIfLines.push(...renderBusInterface(iface, busDefinitions));
  }

  for (const clock of clocks) {
    if (!clock.name) {
      continue;
    }
    const assocBusIfs = busInterfaces
      .filter((bi) => bi.associatedClock === clock.name)
      .map((bi) => String(bi.name).toUpperCase())
      .join(':');
    const assocReset =
      clock.associatedReset ??
      busInterfaces
        .filter((bi) => bi.associatedClock === clock.name && bi.associatedReset)
        .map((bi) => bi.associatedReset)[0];
    busIfLines.push(...renderClockInterface(clock.name, assocBusIfs, assocReset));
  }

  for (const reset of resets) {
    if (!reset.name) {
      continue;
    }
    busIfLines.push(...renderResetInterface(reset.name, reset.polarity ?? 'activeHigh'));
  }

  for (const intr of interrupts) {
    if (!intr.name) {
      continue;
    }
    busIfLines.push(...renderInterruptInterface(intr));
  }

  if (busIfLines.length > 0) {
    lines.push('  <spirit:busInterfaces>');
    lines.push(...busIfLines);
    lines.push('  </spirit:busInterfaces>');
  }

  // ── memoryMaps ────────────────────────────────────────────────────────────
  // IP-XACT places <spirit:memoryMaps> after busInterfaces and before model.
  // Omit the element entirely when there is nothing to emit (XSD requires it
  // to be absent rather than empty).
  if (memoryMaps?.some((m) => (m.addressBlocks ?? []).length > 0)) {
    lines.push(...renderMemoryMaps(memoryMaps));
  }

  // ── model ─────────────────────────────────────────────────────────────────

  lines.push('  <spirit:model>');
  lines.push(...renderViews(name, ipCore.subcores ?? [], isSv, xguiChecksum));
  lines.push(
    ...renderPorts(
      clocks,
      resets,
      busInterfaces,
      userPorts,
      interrupts,
      busDefinitions,
      isSv,
      parameters
    )
  );
  lines.push(...renderModelParameters(parameters));
  lines.push('  </spirit:model>');

  // ── choices ───────────────────────────────────────────────────────────────

  const hasResets = resets.length > 0;
  const hasParamChoices = parameters.some(
    (p) => Array.isArray(p.allowedValues) && p.allowedValues.length > 0
  );
  if (hasResets || hasParamChoices) {
    lines.push(...renderChoices(resets.length, parameters));
  }

  // ── fileSets ──────────────────────────────────────────────────────────────

  lines.push(
    ...renderFileSets(
      resolvedRtlFiles,
      resolvedSimFiles,
      derivedXguiFile,
      ipCore.subcores ?? [],
      isSv,
      xguiChecksum
    )
  );

  // ── description ───────────────────────────────────────────────────────────

  if (description) {
    lines.push(`  <spirit:description>${x(description)}</spirit:description>`);
  }

  // ── parameters ────────────────────────────────────────────────────────────

  lines.push(...renderParameters(`${name}_v${versionStr}`, parameters));

  // ── vendorExtensions ──────────────────────────────────────────────────────

  const xilinxVersion = detectVivadoVersion();
  lines.push(...renderVendorExtensions(derivedDisplayName, xilinxVersion));

  lines.push('</spirit:component>');

  return lines.join('\n');
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderBusInterface(iface: BusInterfaceDef, busDefinitions: BusDefinitions): string[] {
  const ifaceName = String(iface.name ?? '');
  const ifaceType = String(iface.type ?? '');
  const mode = String(iface.mode ?? 'slave').toLowerCase();

  const vivadoType = resolveVivadoBusType(ifaceType);
  const customBus = vivadoType ? null : findCustomBusDef(ifaceType, busDefinitions);

  const lines: string[] = [];
  lines.push('    <spirit:busInterface>');
  lines.push(`      <spirit:name>${x(ifaceName)}</spirit:name>`);

  if (vivadoType) {
    lines.push(
      `      <spirit:busType spirit:vendor="${vivadoType.vendor}" spirit:library="${vivadoType.library}" spirit:name="${vivadoType.name}" spirit:version="1.0" />`
    );
    lines.push(
      `      <spirit:abstractionType spirit:vendor="${vivadoType.vendor}" spirit:library="${vivadoType.library}" spirit:name="${vivadoType.abstraction}" spirit:version="1.0" />`
    );
  } else if (customBus) {
    lines.push(
      `      <spirit:busType spirit:vendor="${x(customBus.vendor)}" spirit:library="${x(customBus.library)}" spirit:name="${x(customBus.name)}" spirit:version="${x(customBus.version)}" />`
    );
    lines.push(
      `      <spirit:abstractionType spirit:vendor="${x(customBus.vendor)}" spirit:library="${x(customBus.library)}" spirit:name="${x(customBus.name)}_rtl" spirit:version="${x(customBus.version)}" />`
    );
  } else {
    // Use preserved VLNV components when available (set by ComponentXmlParser for
    // unknown bus types imported from a component.xml). Otherwise, if ifaceType
    // is itself a well-formed colon-separated VLNV (e.g. a custom/external type
    // entered directly in the editor), split it into its real components instead
    // of dumping the whole string into "name" under a synthetic user.org:user wrapper.
    const vlnv = iface.busTypeVlnv as
      | { vendor: string; library: string; name: string; version: string }
      | undefined;
    const parsedType = !vlnv && isValidVlnv(ifaceType) ? parseVlnv(ifaceType) : undefined;
    const fallbackVendor = vlnv?.vendor ?? parsedType?.vendor ?? 'user.org';
    const fallbackLibrary = vlnv?.library ?? parsedType?.library ?? 'user';
    const fallbackName = vlnv?.name ?? parsedType?.name ?? ifaceType;
    const fallbackVersion = vlnv?.version ?? parsedType?.version ?? '1.0';
    lines.push(
      `      <spirit:busType spirit:vendor="${x(fallbackVendor)}" spirit:library="${x(fallbackLibrary)}" spirit:name="${x(fallbackName)}" spirit:version="${x(fallbackVersion)}" />`
    );
    lines.push(
      `      <spirit:abstractionType spirit:vendor="${x(fallbackVendor)}" spirit:library="${x(fallbackLibrary)}" spirit:name="${x(fallbackName)}_rtl" spirit:version="${x(fallbackVersion)}" />`
    );
  }

  // A slave that exposes a memory map must reference it here, otherwise Vivado
  // reports the map as orphaned (IP_Flow 19-1980). The referenced name matches
  // the <spirit:memoryMap><spirit:name> emitted in renderMemoryMaps.
  const xmlMode = modeToXmlTag(mode);
  const memoryMapRef = typeof iface.memoryMapRef === 'string' ? iface.memoryMapRef : undefined;
  if (xmlMode === 'slave' && memoryMapRef) {
    lines.push('      <spirit:slave>');
    lines.push(`        <spirit:memoryMapRef spirit:memoryMapRef="${x(memoryMapRef)}" />`);
    lines.push('      </spirit:slave>');
  } else {
    lines.push(`      <spirit:${xmlMode} />`);
  }

  // portMaps
  if (vivadoType) {
    const busDef = busDefinitions[vivadoType.libraryKey];
    if (busDef?.ports) {
      lines.push(...busDefPortMaps(busDef.ports, iface, mode));
    }
  } else if (iface.conduitPorts && (iface.conduitPorts as unknown[]).length > 0) {
    // Ports already authored directly on the interface take priority over a
    // newly-discovered library match (e.g. from the Vivado interface catalog):
    // the user's physical port names are presumably already wired up in their real
    // HDL, and a library match alone doesn't tell us how to remap them to the
    // library's official logical names. Silently switching here would produce a
    // component.xml with physical names that don't exist on the actual entity.
    lines.push(...busDefPortMaps(iface.conduitPorts as BusPortDefinition[], iface, mode));
  } else if (customBus) {
    lines.push(...busDefPortMaps(customBus.ports, iface, mode));
  } else {
    const rawPortMaps = iface.rawPortMaps as
      | Array<{ logical: string; physical: string }>
      | undefined;
    if (rawPortMaps && rawPortMaps.length > 0) {
      lines.push('      <spirit:portMaps>');
      for (const pm of rawPortMaps) {
        lines.push('        <spirit:portMap>');
        lines.push('          <spirit:logicalPort>');
        lines.push(`            <spirit:name>${x(pm.logical)}</spirit:name>`);
        lines.push('          </spirit:logicalPort>');
        lines.push('          <spirit:physicalPort>');
        lines.push(`            <spirit:name>${x(pm.physical)}</spirit:name>`);
        lines.push('          </spirit:physicalPort>');
        lines.push('        </spirit:portMap>');
      }
      lines.push('      </spirit:portMaps>');
    }
  }

  // PROTOCOL parameter for AXI4/AXI4LITE
  if (vivadoType?.protocol) {
    const ifaceUpper = ifaceName.toUpperCase();
    lines.push('      <spirit:parameters>');
    lines.push('        <spirit:parameter>');
    lines.push('          <spirit:name>PROTOCOL</spirit:name>');
    lines.push(
      `          <spirit:value spirit:id="BUSIFPARAM_VALUE.${x(ifaceUpper)}.PROTOCOL">${x(vivadoType.protocol)}</spirit:value>`
    );
    lines.push('        </spirit:parameter>');
    lines.push('      </spirit:parameters>');
  }

  lines.push('    </spirit:busInterface>');
  return lines;
}

function renderClockInterface(
  clockPort: string,
  associatedBusIfs: string,
  associatedReset?: string
): string[] {
  const clkUpper = clockPort.toUpperCase();
  const lines: string[] = [];

  lines.push('    <spirit:busInterface>');
  lines.push(`      <spirit:name>${x(clockPort)}</spirit:name>`);
  lines.push(
    '      <spirit:busType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock" spirit:version="1.0" />'
  );
  lines.push(
    '      <spirit:abstractionType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="clock_rtl" spirit:version="1.0" />'
  );
  lines.push('      <spirit:slave />');
  lines.push('      <spirit:portMaps>');
  lines.push('        <spirit:portMap>');
  lines.push('          <spirit:logicalPort>');
  lines.push('            <spirit:name>CLK</spirit:name>');
  lines.push('          </spirit:logicalPort>');
  lines.push('          <spirit:physicalPort>');
  lines.push(`            <spirit:name>${x(clockPort)}</spirit:name>`);
  lines.push('          </spirit:physicalPort>');
  lines.push('        </spirit:portMap>');
  lines.push('      </spirit:portMaps>');

  const hasAssocBusIf = associatedBusIfs.length > 0;
  const hasAssocReset = associatedReset && associatedReset.length > 0;
  lines.push('      <spirit:parameters>');
  if (hasAssocBusIf) {
    lines.push('        <spirit:parameter>');
    lines.push('          <spirit:name>ASSOCIATED_BUSIF</spirit:name>');
    lines.push(
      `          <spirit:value spirit:id="BUSIFPARAM_VALUE.${x(clkUpper)}.ASSOCIATED_BUSIF">${x(associatedBusIfs)}</spirit:value>`
    );
    lines.push('        </spirit:parameter>');
  }
  if (hasAssocReset) {
    lines.push('        <spirit:parameter>');
    lines.push('          <spirit:name>ASSOCIATED_RESET</spirit:name>');
    lines.push(
      `          <spirit:value spirit:id="BUSIFPARAM_VALUE.${x(clkUpper)}.ASSOCIATED_RESET">${x(String(associatedReset))}</spirit:value>`
    );
    lines.push('        </spirit:parameter>');
  }
  lines.push('        <spirit:parameter>');
  lines.push('          <spirit:name>FREQ_HZ</spirit:name>');
  lines.push(
    `          <spirit:value spirit:format="long" spirit:resolve="user" spirit:id="BUSIFPARAM_VALUE.${x(clkUpper)}.FREQ_HZ">100000000</spirit:value>`
  );
  lines.push('        </spirit:parameter>');
  lines.push('      </spirit:parameters>');

  lines.push('    </spirit:busInterface>');
  return lines;
}

function renderResetInterface(resetPort: string, polarity: string): string[] {
  const rstUpper = resetPort.toUpperCase();
  const polarityValue = polarity.toLowerCase().includes('low') ? 'ACTIVE_LOW' : 'ACTIVE_HIGH';
  const lines: string[] = [];

  lines.push('    <spirit:busInterface>');
  lines.push(`      <spirit:name>${x(resetPort)}</spirit:name>`);
  lines.push(
    '      <spirit:busType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="reset" spirit:version="1.0" />'
  );
  lines.push(
    '      <spirit:abstractionType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="reset_rtl" spirit:version="1.0" />'
  );
  lines.push('      <spirit:slave />');
  lines.push('      <spirit:portMaps>');
  lines.push('        <spirit:portMap>');
  lines.push('          <spirit:logicalPort>');
  lines.push('            <spirit:name>RST</spirit:name>');
  lines.push('          </spirit:logicalPort>');
  lines.push('          <spirit:physicalPort>');
  lines.push(`            <spirit:name>${x(resetPort)}</spirit:name>`);
  lines.push('          </spirit:physicalPort>');
  lines.push('        </spirit:portMap>');
  lines.push('      </spirit:portMaps>');
  lines.push('      <spirit:parameters>');
  lines.push('        <spirit:parameter>');
  lines.push('          <spirit:name>POLARITY</spirit:name>');
  lines.push(
    `          <spirit:value spirit:id="BUSIFPARAM_VALUE.${x(rstUpper)}.POLARITY" spirit:choiceRef="choice_list_9d8b0d81">${polarityValue}</spirit:value>`
  );
  lines.push('        </spirit:parameter>');
  lines.push('      </spirit:parameters>');
  lines.push('    </spirit:busInterface>');
  return lines;
}

function renderInterruptInterface(intr: {
  name: string;
  direction: string;
  sensitivity?: string;
}): string[] {
  const intrUpper = intr.name.toUpperCase();
  const modeTag = intr.direction === 'in' ? 'slave' : 'master';
  const sensitivity = intr.sensitivity ?? 'LEVEL_HIGH';
  const lines: string[] = [];

  lines.push('    <spirit:busInterface>');
  lines.push(`      <spirit:name>${x(intr.name)}</spirit:name>`);
  lines.push(
    '      <spirit:busType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="interrupt" spirit:version="1.0" />'
  );
  lines.push(
    '      <spirit:abstractionType spirit:vendor="xilinx.com" spirit:library="signal" spirit:name="interrupt_rtl" spirit:version="1.0" />'
  );
  lines.push(`      <spirit:${modeTag} />`);
  lines.push('      <spirit:portMaps>');
  lines.push('        <spirit:portMap>');
  lines.push('          <spirit:logicalPort>');
  lines.push('            <spirit:name>INTERRUPT</spirit:name>');
  lines.push('          </spirit:logicalPort>');
  lines.push('          <spirit:physicalPort>');
  lines.push(`            <spirit:name>${x(intr.name)}</spirit:name>`);
  lines.push('          </spirit:physicalPort>');
  lines.push('        </spirit:portMap>');
  lines.push('      </spirit:portMaps>');
  lines.push('      <spirit:parameters>');
  lines.push('        <spirit:parameter>');
  lines.push('          <spirit:name>SENSITIVITY</spirit:name>');
  lines.push(
    `          <spirit:value spirit:id="BUSIFPARAM_VALUE.${x(intrUpper)}.SENSITIVITY">${x(sensitivity)}</spirit:value>`
  );
  lines.push('        </spirit:parameter>');
  lines.push('      </spirit:parameters>');
  lines.push('    </spirit:busInterface>');
  return lines;
}

// ── Memory map rendering ──────────────────────────────────────────────────────

/** A register flattened to a single emittable entry with a block-relative byte offset. */
interface FlatRegister {
  name: string;
  offset: number;
  size: number;
  access?: string;
  resetValue: number;
  description: string;
  fields: NormalizedField[];
}

/**
 * Map an `.mm.yml` access token to one of the IP-XACT 1685-2009 `<spirit:access>`
 * enum values. The `.mm.yml` vocabulary is richer (e.g. write-1-to-clear,
 * self-clearing); IP-XACT models those nuances elsewhere, so here we collapse
 * each to its closest software read/write capability.
 */
function toSpiritAccess(access: string | undefined): string {
  switch ((access ?? 'read-write').toLowerCase()) {
    case 'read-only':
    case 'ro':
      return 'read-only';
    case 'write-only':
    case 'wo':
    case 'write-self-clearing':
      return 'write-only';
    case 'write-once':
    case 'writeonce':
      return 'writeOnce';
    case 'read-writeonce':
    case 'read-write-once':
      return 'read-writeOnce';
    default:
      // read-write, rw, read-write-1-to-clear, write-1-to-clear,
      // read-write-self-clearing and any unknown token are software-accessible
      // for both read and write.
      return 'read-write';
  }
}

/**
 * Register-level access: use the register's own access when set, otherwise
 * derive it from its fields (read-only iff every field is read-only, etc.).
 */
function registerSpiritAccess(reg: FlatRegister): string {
  if (reg.access) {
    return toSpiritAccess(reg.access);
  }
  const fieldAccesses = reg.fields.map((f) => toSpiritAccess(f.access));
  if (fieldAccesses.length === 0) {
    return 'read-write';
  }
  if (fieldAccesses.every((a) => a === 'read-only')) {
    return 'read-only';
  }
  if (fieldAccesses.every((a) => a === 'write-only')) {
    return 'write-only';
  }
  return 'read-write';
}

/**
 * Flatten a register tree (expanding register arrays into individual instances)
 * into emittable entries with block-relative byte offsets. Mirrors the flat
 * register shape that ComponentXmlParser reads back on import, so a generated
 * memory map round-trips through the parser.
 */
function flattenRegisters(
  registers: NormalizedRegister[],
  baseOffset: number,
  prefix: string,
  defaultRegBytes: number,
  out: FlatRegister[]
): void {
  for (const reg of registers) {
    const regName = reg.name || 'REG';
    const regOffset = baseOffset + reg.offset;

    if (reg.__kind === 'array') {
      const count = Math.max(1, reg.count ?? 1);
      const stride = reg.stride ?? defaultRegBytes;
      const children = reg.registers ?? [];
      for (let i = 0; i < count; i += 1) {
        const instanceOffset = regOffset + i * stride;
        if (children.length > 0) {
          const instancePrefix = count > 1 ? `${prefix}${regName}_${i}_` : `${prefix}${regName}_`;
          flattenRegisters(children, instanceOffset, instancePrefix, defaultRegBytes, out);
        } else {
          out.push({
            name: `${prefix}${regName}_${i}`,
            offset: instanceOffset,
            size: reg.size,
            access: reg.access,
            resetValue: reg.resetValue,
            description: reg.description,
            fields: reg.fields,
          });
        }
      }
      continue;
    }

    out.push({
      name: `${prefix}${regName}`,
      offset: regOffset,
      size: reg.size,
      access: reg.access,
      resetValue: reg.resetValue,
      description: reg.description,
      fields: reg.fields,
    });
  }
}

/**
 * Determine an address block's `<spirit:range>` (mandatory in IP-XACT). Prefer
 * the authored range; otherwise compute the byte extent spanned by its
 * registers so the block is at least large enough to hold them.
 */
function resolveBlockRange(
  block: NormalizedAddressBlock,
  flat: FlatRegister[],
  defaultRegBytes: number
): number {
  if (typeof block.range === 'number' && block.range > 0) {
    return block.range;
  }
  if (typeof block.range === 'string') {
    const parsed = Number(block.range);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  let extent = 0;
  for (const reg of flat) {
    const regBytes = reg.size > 0 ? Math.max(1, Math.floor(reg.size / 8)) : defaultRegBytes;
    extent = Math.max(extent, reg.offset + regBytes);
  }
  return extent > 0 ? extent : defaultRegBytes;
}

function renderMemoryMaps(maps: NormalizedMemoryMap[]): string[] {
  const lines: string[] = [];
  lines.push('  <spirit:memoryMaps>');
  for (const map of maps) {
    if ((map.addressBlocks ?? []).length === 0) {
      continue;
    }
    lines.push('    <spirit:memoryMap>');
    lines.push(`      <spirit:name>${x(map.name)}</spirit:name>`);
    for (const block of map.addressBlocks) {
      lines.push(...renderAddressBlock(block));
    }
    lines.push('    </spirit:memoryMap>');
  }
  lines.push('  </spirit:memoryMaps>');
  return lines;
}

function renderAddressBlock(block: NormalizedAddressBlock): string[] {
  const regWidth = block.defaultRegWidth > 0 ? block.defaultRegWidth : 32;
  const defaultRegBytes = Math.max(1, Math.floor(regWidth / 8));

  const flat: FlatRegister[] = [];
  flattenRegisters(block.registers ?? [], 0, '', defaultRegBytes, flat);

  const range = resolveBlockRange(block, flat, defaultRegBytes);

  const lines: string[] = [];
  lines.push('      <spirit:addressBlock>');
  lines.push(`        <spirit:name>${x(block.name)}</spirit:name>`);
  lines.push(
    `        <spirit:baseAddress spirit:format="long">${block.baseAddress}</spirit:baseAddress>`
  );
  lines.push(`        <spirit:range spirit:format="long">${range}</spirit:range>`);
  lines.push(`        <spirit:width spirit:format="long">${regWidth}</spirit:width>`);
  lines.push(`        <spirit:usage>${x(block.usage || 'register')}</spirit:usage>`);
  for (const reg of flat) {
    lines.push(...renderRegister(reg, regWidth));
  }
  lines.push('      </spirit:addressBlock>');
  return lines;
}

function renderRegister(reg: FlatRegister, regWidth: number): string[] {
  const size = reg.size > 0 ? reg.size : regWidth;
  const offsetHex = `0x${reg.offset.toString(16).toUpperCase()}`;
  const lines: string[] = [];
  lines.push('        <spirit:register>');
  lines.push(`          <spirit:name>${x(reg.name)}</spirit:name>`);
  if (reg.description) {
    lines.push(`          <spirit:description>${x(reg.description)}</spirit:description>`);
  }
  lines.push(`          <spirit:addressOffset>${offsetHex}</spirit:addressOffset>`);
  lines.push(`          <spirit:size spirit:format="long">${size}</spirit:size>`);
  lines.push(`          <spirit:access>${registerSpiritAccess(reg)}</spirit:access>`);
  for (const field of reg.fields) {
    lines.push(...renderField(field));
  }
  lines.push('        </spirit:register>');
  return lines;
}

function renderField(field: NormalizedField): string[] {
  const width = field.width > 0 ? field.width : 1;
  const lines: string[] = [];
  lines.push('          <spirit:field>');
  lines.push(`            <spirit:name>${x(field.name)}</spirit:name>`);
  if (field.description) {
    lines.push(`            <spirit:description>${x(field.description)}</spirit:description>`);
  }
  lines.push(`            <spirit:bitOffset>${field.offset}</spirit:bitOffset>`);
  lines.push(`            <spirit:bitWidth spirit:format="long">${width}</spirit:bitWidth>`);
  lines.push(`            <spirit:access>${toSpiritAccess(field.access)}</spirit:access>`);
  if (field.resetValue) {
    lines.push(
      `            <spirit:reset>0x${field.resetValue.toString(16).toUpperCase()}</spirit:reset>`
    );
  }
  lines.push('          </spirit:field>');
  return lines;
}

function renderViews(
  entityName: string,
  subcores: SubcoreRef[] = [],
  isSv = false,
  xguiChecksum?: string
): string[] {
  function view(
    viewName: string,
    displayName: string,
    envId: string,
    mainFileSetRef: string,
    language?: string,
    extraFileSetRefs: string[] = [],
    viewChecksum?: string
  ): string[] {
    const out: string[] = [];
    out.push('      <spirit:view>');
    out.push(`        <spirit:name>${x(viewName)}</spirit:name>`);
    out.push(`        <spirit:displayName>${x(displayName)}</spirit:displayName>`);
    out.push(`        <spirit:envIdentifier>${x(envId)}</spirit:envIdentifier>`);
    if (language) {
      out.push(`        <spirit:language>${x(language)}</spirit:language>`);
      out.push(`        <spirit:modelName>${x(entityName)}</spirit:modelName>`);
    }
    for (const fsRef of extraFileSetRefs) {
      out.push('        <spirit:fileSetRef>');
      out.push(`          <spirit:localName>${x(fsRef)}</spirit:localName>`);
      out.push('        </spirit:fileSetRef>');
    }
    out.push('        <spirit:fileSetRef>');
    out.push(`          <spirit:localName>${x(mainFileSetRef)}</spirit:localName>`);
    out.push('        </spirit:fileSetRef>');
    if (viewChecksum) {
      out.push('        <spirit:parameters>');
      out.push('          <spirit:parameter>');
      out.push('            <spirit:name>viewChecksum</spirit:name>');
      out.push(`            <spirit:value>${x(viewChecksum)}</spirit:value>`);
      out.push('          </spirit:parameter>');
      out.push('        </spirit:parameters>');
    }
    out.push('      </spirit:view>');
    return out;
  }

  const synthViewName = 'xilinx_anylanguagesynthesis';
  const simViewName = 'xilinx_anylanguagebehavioralsimulation';
  const language = isSv ? 'verilog' : 'VHDL';

  const synthRefs = subcores.map((ref) => {
    const v = parseVlnv(ref.vlnv);
    return `${synthViewName}_${makeRefFileSetSuffix(v)}__ref_view_fileset`;
  });
  const simRefs = subcores.map((ref) => {
    const v = parseVlnv(ref.vlnv);
    return `${simViewName}_${makeRefFileSetSuffix(v)}__ref_view_fileset`;
  });

  const lines: string[] = [];
  lines.push('    <spirit:views>');
  lines.push(
    ...view(
      synthViewName,
      'Synthesis',
      ':vivado.xilinx.com:synthesis',
      `${synthViewName}_view_fileset`,
      language,
      synthRefs
    )
  );
  lines.push(
    ...view(
      simViewName,
      'Simulation',
      ':vivado.xilinx.com:simulation',
      `${simViewName}_view_fileset`,
      language,
      simRefs
    )
  );
  lines.push(
    ...view(
      'xilinx_xpgui',
      'UI Layout',
      ':vivado.xilinx.com:xgui.ui',
      'xilinx_xpgui_view_fileset',
      undefined,
      [],
      xguiChecksum
    )
  );
  lines.push('    </spirit:views>');
  return lines;
}

/**
 * Resolves a port width that may be a literal number, a parameter name,
 * or an arithmetic expression (e.g. "AxiDataWidth_g/8") to a concrete integer
 * using the IP's parameter default values.
 */
function resolveWidth(
  width: number | string | undefined,
  parameters: Array<{ name?: string; value?: unknown; defaultValue?: unknown }>
): number {
  if (typeof width === 'number') {
    return width;
  }
  if (typeof width === 'string') {
    const defaults: Record<string, number> = {};
    for (const p of parameters) {
      if (p.name) {
        const v = Number(p.value ?? p.defaultValue);
        if (!isNaN(v)) {
          defaults[String(p.name)] = v;
        }
      }
    }
    const result = evalWidthExpr(width, defaults);
    if (result !== undefined && result > 0) {
      return result;
    }
  }
  return 1;
}

function renderPorts(
  clocks: Array<{ name?: string }>,
  resets: Array<{ name?: string; polarity?: string }>,
  busInterfaces: BusInterfaceDef[],
  userPorts: Array<{ name?: string; direction?: string; width?: number | string }>,
  interrupts: Array<{ name: string; direction: string }>,
  busDefinitions: BusDefinitions,
  isSv = false,
  parameters: Array<{ name?: string; value?: unknown; defaultValue?: unknown }> = []
): string[] {
  const portLines: string[] = [];
  const paramNames = parameters.map((p) => String(p.name ?? ''));

  // Aggregate portWidthOverrides across all interfaces of the same bus type.
  // An interface with no overrides inherits from siblings of the same type, so
  // e.g. a master and slave of xcvr both get parameterised port widths when only
  // the slave carries explicit portWidthOverrides.
  const typeOverrides: Record<string, Record<string, number | string>> = {};
  for (const iface of busInterfaces) {
    const overrides = iface.portWidthOverrides ?? {};
    if (Object.keys(overrides).length > 0) {
      const t = String(iface.type ?? '');
      typeOverrides[t] = { ...(typeOverrides[t] ?? {}), ...overrides };
    }
  }

  for (const clock of clocks) {
    if (!clock.name) {
      continue;
    }
    portLines.push(...renderModelPort(clock.name, 'in', 1, isSv));
  }

  for (const reset of resets) {
    if (!reset.name) {
      continue;
    }
    portLines.push(...renderModelPort(reset.name, 'in', 1, isSv));
  }

  for (const iface of busInterfaces) {
    const ifaceType = String(iface.type ?? '');
    const mode = String(iface.mode ?? 'slave').toLowerCase();
    const vivadoType = resolveVivadoBusType(ifaceType);
    const sourcePorts: BusPortDefinition[] | undefined = vivadoType
      ? busDefinitions[vivadoType.libraryKey]?.ports
      : findCustomBusDef(ifaceType, busDefinitions)?.ports;

    if (!sourcePorts) {
      // Unknown bus type with preserved rawPortMaps: emit physical ports directly
      const rawPortMaps = iface.rawPortMaps as
        | Array<{ logical: string; physical: string; direction: 'in' | 'out'; width: number }>
        | undefined;
      if (rawPortMaps) {
        for (const pm of rawPortMaps) {
          portLines.push(...renderModelPort(pm.physical, pm.direction, pm.width, isSv));
        }
      }
      continue;
    }
    const typedParams = parameters
      .filter((p): p is { name: string; value?: number | string } => typeof p.name === 'string')
      .map((p) => {
        const v = p.value ?? (p as Record<string, unknown>).defaultValue;
        return {
          name: p.name,
          value: typeof v === 'number' || typeof v === 'string' ? v : undefined,
        };
      });
    // Effective overrides: bus-type inherited overrides as base, interface-specific as override
    const effectiveOverrides: Record<string, number | string> = {
      ...(typeOverrides[ifaceType] ?? {}),
      ...(iface.portWidthOverrides ?? {}),
    };
    const activePorts = getActiveBusPortsFromDefinition(
      sourcePorts as Array<{
        name: string;
        width?: number | string;
        direction?: string;
        presence?: string;
      }>,
      iface.useOptionalPorts ?? [],
      String(iface.physicalPrefix ?? ''),
      mode,
      effectiveOverrides,
      typedParams,
      undefined,
      iface.absentPorts
    );
    for (const port of activePorts) {
      portLines.push(
        ...renderModelPort(
          String(port.name),
          String(port.direction),
          Number(port.width),
          isSv,
          port.width_expr ? String(port.width_expr) : undefined,
          paramNames
        )
      );
    }
  }

  for (const port of userPorts) {
    if (!port.name) {
      continue;
    }
    const rawWidth = port.width;
    const resolvedWidth = resolveWidth(rawWidth, parameters);
    const widthParamName = typeof rawWidth === 'string' ? rawWidth : undefined;
    portLines.push(
      ...renderModelPort(
        String(port.name),
        String(port.direction ?? 'in'),
        resolvedWidth,
        isSv,
        widthParamName,
        paramNames
      )
    );
  }

  for (const intr of interrupts) {
    if (!intr.name) {
      continue;
    }
    portLines.push(...renderModelPort(intr.name, intr.direction === 'in' ? 'in' : 'out', 1, isSv));
  }

  // Spirit XSD requires ports to be absent when empty
  if (portLines.length === 0) {
    return [];
  }
  return ['    <spirit:ports>', ...portLines, '    </spirit:ports>'];
}

function renderModelPort(
  name: string,
  direction: string,
  width: number,
  isSv = false,
  widthParamName?: string,
  paramNames: string[] = []
): string[] {
  const isVector = widthParamName !== undefined || width > 1;
  const lines: string[] = [];
  lines.push('      <spirit:port>');
  lines.push(`        <spirit:name>${x(name)}</spirit:name>`);
  lines.push('        <spirit:wire>');
  lines.push(`          <spirit:direction>${x(direction)}</spirit:direction>`);
  if (isVector) {
    lines.push('          <spirit:vector>');
    if (widthParamName) {
      if (/^\w+$/.test(widthParamName)) {
        // Simple parameter name: reference via MODELPARAM_VALUE
        const paramUpper = widthParamName.toUpperCase();
        lines.push(
          `            <spirit:left spirit:format="long" spirit:resolve="dependent" spirit:dependency="(spirit:decode(id(&apos;MODELPARAM_VALUE.${paramUpper}&apos;)) - 1)">${width - 1}</spirit:left>`
        );
      } else {
        // Complex expression (e.g. "AxiDataWidth_g/8" or "clog2(DEPTH)"): expand
        // to an IP-XACT XPATH dependency, substituting each known parameter with
        // its spirit:decode(id('MODELPARAM_VALUE.NAME')) form (UG1118).
        const upperParamNames = paramNames.map((p) => p.toUpperCase());
        const ast = parse(widthParamName);
        const dependency = ast
          ? serialize(ast, 'ipxact', {
              paramRef: (name) => {
                const upper = name.toUpperCase();
                return upperParamNames.includes(upper)
                  ? `spirit:decode(id(&apos;MODELPARAM_VALUE.${upper}&apos;))`
                  : name;
              },
            }).code
          : IPXACT_UNSUPPORTED;
        if (dependency === IPXACT_UNSUPPORTED) {
          // No parameterized XPATH form (e.g. max/min, or an unparseable
          // expression) — fall back to the resolved literal width.
          lines.push(`            <spirit:left spirit:format="long">${width - 1}</spirit:left>`);
        } else {
          lines.push(
            `            <spirit:left spirit:format="long" spirit:resolve="dependent" spirit:dependency="(${dependency} - 1)">${width - 1}</spirit:left>`
          );
        }
      }
    } else {
      lines.push(`            <spirit:left spirit:format="long">${width - 1}</spirit:left>`);
    }
    lines.push('            <spirit:right spirit:format="long">0</spirit:right>');
    lines.push('          </spirit:vector>');
  }
  lines.push('          <spirit:wireTypeDefs>');
  lines.push('            <spirit:wireTypeDef>');
  const typeName = isSv ? 'wire' : isVector ? 'std_logic_vector' : 'std_logic';
  lines.push(`              <spirit:typeName>${typeName}</spirit:typeName>`);
  lines.push('              <spirit:viewNameRef>xilinx_anylanguagesynthesis</spirit:viewNameRef>');
  lines.push(
    '              <spirit:viewNameRef>xilinx_anylanguagebehavioralsimulation</spirit:viewNameRef>'
  );
  lines.push('            </spirit:wireTypeDef>');
  lines.push('          </spirit:wireTypeDefs>');
  lines.push('        </spirit:wire>');
  lines.push('      </spirit:port>');
  return lines;
}

function toIpXactDataType(pType: string): string {
  switch (pType) {
    case 'natural':
    case 'positive':
      return 'integer';
    default:
      return pType;
  }
}

function renderModelParameters(parameters: ParameterDef[]): string[] {
  if (parameters.length === 0) {
    return [];
  }
  const lines: string[] = [];
  lines.push('    <spirit:modelParameters>');
  for (const param of parameters) {
    if (!param.name) {
      continue;
    }
    const pName = String(param.name);
    const pType = String(param.dataType ?? 'integer').toLowerCase();
    const ipXactType = toIpXactDataType(pType);
    const { format, defaultValue } = paramSpiritFormat(pType);
    const value =
      param.value !== undefined && param.value !== null ? String(param.value) : defaultValue;
    const isInteger = format === 'long';
    const displayName = pName
      .split('_')
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    lines.push(
      `      <spirit:modelParameter xsi:type="spirit:nameValueTypeType" spirit:dataType="${x(ipXactType)}">`
    );
    lines.push(`        <spirit:name>${x(pName)}</spirit:name>`);
    lines.push(`        <spirit:displayName>${x(displayName)}</spirit:displayName>`);
    const hasChoices = Array.isArray(param.allowedValues) && param.allowedValues.length > 0;
    if (isInteger) {
      const rangeTypeAttr = !hasChoices ? ' spirit:rangeType="long"' : '';
      lines.push(
        `        <spirit:value spirit:format="${format}" spirit:resolve="generated" spirit:id="MODELPARAM_VALUE.${x(pName.toUpperCase())}"${rangeTypeAttr}>${x(value)}</spirit:value>`
      );
    } else {
      lines.push(
        `        <spirit:value spirit:format="${format}" spirit:resolve="generated" spirit:id="MODELPARAM_VALUE.${x(pName.toUpperCase())}">${x(value)}</spirit:value>`
      );
    }
    lines.push('      </spirit:modelParameter>');
  }
  lines.push('    </spirit:modelParameters>');
  return lines;
}

function renderFileSets(
  rtlFiles: string[],
  simFiles: string[],
  xguiFile: string,
  subcores: SubcoreRef[] = [],
  isSv = false,
  xguiChecksum?: string
): string[] {
  const synthViewName = 'xilinx_anylanguagesynthesis';
  const simViewName = 'xilinx_anylanguagebehavioralsimulation';
  const renderFile = isSv ? renderSvFile : renderVhdlFile;

  const lines: string[] = [];
  lines.push('  <spirit:fileSets>');

  lines.push('    <spirit:fileSet>');
  lines.push(`      <spirit:name>${synthViewName}_view_fileset</spirit:name>`);
  for (const f of rtlFiles) {
    lines.push(...renderFile(f));
  }
  lines.push('    </spirit:fileSet>');

  lines.push('    <spirit:fileSet>');
  lines.push(`      <spirit:name>${simViewName}_view_fileset</spirit:name>`);
  for (const f of simFiles) {
    lines.push(...renderFile(f));
  }
  lines.push('    </spirit:fileSet>');

  lines.push('    <spirit:fileSet>');
  lines.push('      <spirit:name>xilinx_xpgui_view_fileset</spirit:name>');
  lines.push('      <spirit:file>');
  lines.push(`        <spirit:name>${x(xguiFile)}</spirit:name>`);
  lines.push('        <spirit:fileType>tclSource</spirit:fileType>');
  if (xguiChecksum) {
    lines.push(`        <spirit:userFileType>CHECKSUM_${xguiChecksum}</spirit:userFileType>`);
  }
  lines.push('        <spirit:userFileType>XGUI_VERSION_2</spirit:userFileType>');
  lines.push('      </spirit:file>');
  lines.push('    </spirit:fileSet>');

  for (const ref of subcores) {
    const v = parseVlnv(ref.vlnv);
    const suffix = makeRefFileSetSuffix(v);
    for (const prefix of [synthViewName, simViewName]) {
      lines.push('    <spirit:fileSet>');
      lines.push(`      <spirit:name>${prefix}_${suffix}__ref_view_fileset</spirit:name>`);
      lines.push('      <spirit:vendorExtensions>');
      lines.push('        <xilinx:subCoreRef>');
      lines.push(
        `          <xilinx:componentRef xilinx:vendor="${x(v.vendor)}" xilinx:library="${x(v.library)}" xilinx:name="${x(v.name)}" xilinx:version="${x(v.version)}">`
      );
      lines.push('            <xilinx:mode xilinx:name="create_mode"/>');
      lines.push('          </xilinx:componentRef>');
      lines.push('        </xilinx:subCoreRef>');
      lines.push('      </spirit:vendorExtensions>');
      lines.push('    </spirit:fileSet>');
    }
  }

  lines.push('  </spirit:fileSets>');
  return lines;
}

function renderVhdlFile(filePath: string): string[] {
  return [
    '      <spirit:file>',
    `        <spirit:name>${x(filePath)}</spirit:name>`,
    '        <spirit:fileType>vhdlSource</spirit:fileType>',
    '      </spirit:file>',
  ];
}

function renderSvFile(filePath: string): string[] {
  return [
    '      <spirit:file>',
    `        <spirit:name>${x(filePath)}</spirit:name>`,
    '        <spirit:fileType>systemVerilogSource</spirit:fileType>',
    '      </spirit:file>',
  ];
}

function paramSpiritFormat(pType: string): { format: string; defaultValue: string } {
  switch (pType) {
    case 'integer':
    case 'natural':
    case 'positive':
      return { format: 'long', defaultValue: '0' };
    case 'boolean':
      return { format: 'bool', defaultValue: 'false' };
    case 'real':
      return { format: 'float', defaultValue: '0.0' };
    default:
      return { format: 'string', defaultValue: '' };
  }
}

function renderParameters(entityName: string, parameters: ParameterDef[]): string[] {
  const lines: string[] = [];
  lines.push('  <spirit:parameters>');

  for (const param of parameters) {
    if (!param.name) {
      continue;
    }
    const pName = String(param.name);
    const pType = String(param.dataType ?? 'integer').toLowerCase();
    const { format, defaultValue } = paramSpiritFormat(pType);
    const value =
      param.value !== undefined && param.value !== null ? String(param.value) : defaultValue;
    const paramId = `PARAM_VALUE.${pName.toUpperCase()}`;
    const isInteger = format === 'long';
    const displayName = pName
      .split('_')
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    lines.push('    <spirit:parameter>');
    lines.push(`      <spirit:name>${x(pName)}</spirit:name>`);
    lines.push(`      <spirit:displayName>${x(displayName)}</spirit:displayName>`);
    if (param.description) {
      lines.push(`      <spirit:description>${x(param.description)}</spirit:description>`);
    }
    const choicesList = param.allowedValues;
    const hasChoices = Array.isArray(choicesList) && choicesList.length > 0;
    const choiceRefAttr = hasChoices ? ` spirit:choiceRef="choice_${pName}"` : '';
    const minAttr =
      !hasChoices && param.min !== undefined && param.min !== null
        ? ` spirit:minimum="${param.min}"`
        : '';
    const maxAttr =
      !hasChoices && param.max !== undefined && param.max !== null
        ? ` spirit:maximum="${param.max}"`
        : '';
    // spirit:rangeType and spirit:choiceRef are mutually exclusive in IP-XACT
    const rangeTypeAttr = isInteger && !hasChoices ? ' spirit:rangeType="long"' : '';

    if (isInteger) {
      lines.push(
        `      <spirit:value spirit:format="${format}" spirit:resolve="user" spirit:id="${x(paramId)}"${minAttr}${maxAttr}${rangeTypeAttr}${choiceRefAttr}>${x(value)}</spirit:value>`
      );
    } else {
      lines.push(
        `      <spirit:value spirit:format="${format}" spirit:resolve="user" spirit:id="${x(paramId)}"${choiceRefAttr}>${x(value)}</spirit:value>`
      );
    }
    lines.push('    </spirit:parameter>');
  }

  lines.push('    <spirit:parameter>');
  lines.push('      <spirit:name>Component_Name</spirit:name>');
  lines.push(
    `      <spirit:value spirit:resolve="user" spirit:id="PARAM_VALUE.Component_Name" spirit:order="1">${x(entityName)}</spirit:value>`
  );
  lines.push('    </spirit:parameter>');

  lines.push('  </spirit:parameters>');
  return lines;
}

function renderChoices(resetsCount: number, parameters: ParameterDef[] = []): string[] {
  const lines: string[] = [];
  lines.push('  <spirit:choices>');
  if (resetsCount > 0) {
    lines.push(
      '    <spirit:choice>',
      '      <spirit:name>choice_list_9d8b0d81</spirit:name>',
      '      <spirit:enumeration>ACTIVE_HIGH</spirit:enumeration>',
      '      <spirit:enumeration>ACTIVE_LOW</spirit:enumeration>',
      '    </spirit:choice>'
    );
  }
  for (const param of parameters) {
    const choicesList = param.allowedValues;
    if (Array.isArray(choicesList) && choicesList.length > 0) {
      lines.push('    <spirit:choice>');
      lines.push(`      <spirit:name>choice_${param.name}</spirit:name>`);
      for (const val of choicesList) {
        lines.push(`      <spirit:enumeration>${val}</spirit:enumeration>`);
      }
      lines.push('    </spirit:choice>');
    }
  }
  lines.push('  </spirit:choices>');
  return lines;
}

function renderVendorExtensions(displayName: string, xilinxVersion: string): string[] {
  const families = [
    'virtex7',
    'qvirtex7',
    'versal',
    'kintex7',
    'kintex7l',
    'qkintex7',
    'qkintex7l',
    'akintex7',
    'artix7',
    'artix7l',
    'aartix7',
    'qartix7',
    'zynq',
    'qzynq',
    'azynq',
    'spartan7',
    'aspartan7',
    'virtexu',
    'zynquplus',
    'virtexuplus',
    'virtexuplusHBM',
    'virtexuplus58g',
    'kintexuplus',
    'artixuplus',
    'kintexu',
  ];

  const lines: string[] = [];
  lines.push('  <spirit:vendorExtensions>');
  lines.push('    <xilinx:coreExtensions>');
  lines.push('      <xilinx:supportedFamilies>');
  for (const family of families) {
    lines.push(`        <xilinx:family xilinx:lifeCycle="Production">${x(family)}</xilinx:family>`);
  }
  lines.push('      </xilinx:supportedFamilies>');
  lines.push('      <xilinx:taxonomies>');
  lines.push('        <xilinx:taxonomy>/UserIP</xilinx:taxonomy>');
  lines.push('      </xilinx:taxonomies>');
  lines.push(`      <xilinx:displayName>${x(displayName)}</xilinx:displayName>`);
  lines.push('      <xilinx:coreRevision>1</xilinx:coreRevision>');
  lines.push('    </xilinx:coreExtensions>');
  lines.push('    <xilinx:packagingInfo>');
  lines.push(`      <xilinx:xilinxVersion>${x(xilinxVersion)}</xilinx:xilinxVersion>`);
  lines.push('    </xilinx:packagingInfo>');
  lines.push('  </spirit:vendorExtensions>');
  return lines;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function makeRefFileSetSuffix(v: {
  vendor: string;
  library: string;
  name: string;
  version: string;
}): string {
  return [v.vendor, v.library, v.name, v.version]
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, '_'))
    .join('_');
}

function x(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function modeToXmlTag(mode: string): string {
  switch (mode) {
    case 'master':
      return 'master';
    case 'source':
      return 'master';
    case 'sink':
      return 'slave';
    default:
      return 'slave';
  }
}

function getFileSetPaths(ipCore: IpCoreData, fileSetName: string, prefix: string): string[] | null {
  const fileSets = (ipCore as Record<string, unknown>).fileSets as
    | Array<{ name?: string; files?: Array<{ path?: string; type?: string }> }>
    | undefined;
  if (!Array.isArray(fileSets)) {
    return null;
  }
  const match = fileSets.find((fs) => fs.name === fileSetName);
  if (!match?.files) {
    return null;
  }
  return match.files.map((f) => `${prefix}${f.path ?? ''}`);
}
