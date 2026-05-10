import { getActiveBusPortsFromDefinition } from './registerProcessor';
import type {
  BusDefinitions,
  BusInterfaceDef,
  BusPortDefinition,
  IpCoreData,
  ParameterDef,
} from './types';

// ── Custom bus definition support ─────────────────────────────────────────────

interface CustomBusInfo {
  vendor: string;
  library: string;
  name: string;
  version: string;
  description: string;
  ports: BusPortDefinition[];
}

function findCustomBusDef(ifaceType: string, busDefinitions: BusDefinitions): CustomBusInfo | null {
  if (IPCRAFT_TO_VIVADO[ifaceType]) {
    return null;
  }
  for (const def of Object.values(busDefinitions)) {
    const bt = def.busType;
    if (!bt?.vendor || !bt.library || !bt.name || !bt.version) {
      continue;
    }
    const vlnv = `${bt.vendor}.${bt.library}.${bt.name}.${bt.version}`;
    if (vlnv === ifaceType) {
      return {
        vendor: bt.vendor,
        library: bt.library,
        name: bt.name,
        version: bt.version,
        description: bt.description ?? '',
        ports: def.ports ?? [],
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
    iface.use_optional_ports ?? [],
    String(iface.physical_prefix ?? ''),
    mode,
    iface.port_width_overrides ?? {}
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

function renderBusDefinitionXml(busInfo: CustomBusInfo): string {
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

function renderAbstractionDefinitionXml(busInfo: CustomBusInfo): string {
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

  for (const iface of ipCore.bus_interfaces ?? []) {
    const ifaceType = String(iface.type ?? '');
    if (seen.has(ifaceType)) {
      continue;
    }
    const custom = findCustomBusDef(ifaceType, busDefinitions);
    if (!custom) {
      continue;
    }
    seen.add(ifaceType);
    files[`busdef/${custom.name}.xml`] = renderBusDefinitionXml(custom);
    files[`busdef/${custom.name}_rtl.xml`] = renderAbstractionDefinitionXml(custom);
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
  'ipcraft.busif.axi4_lite.1.0': {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4LITE',
    libraryKey: 'AXI4_LITE',
  },
  'ipcraft.busif.axi4_full.1.0': {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4',
    libraryKey: 'AXI4_FULL',
  },
  'ipcraft.busif.axi_stream.1.0': {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'axis',
    abstraction: 'axis_rtl',
    libraryKey: 'AXI_STREAM',
  },
  'ipcraft.busif.avalon_mm.1.0': {
    vendor: 'altera.com',
    library: 'interface',
    name: 'avalon',
    abstraction: 'avalon_rtl',
    libraryKey: 'AVALON_MM',
  },
  'ipcraft.busif.avalon_st.1.0': {
    vendor: 'altera.com',
    library: 'interface',
    name: 'avalon_st',
    abstraction: 'avalon_st_rtl',
    libraryKey: 'AVALON_ST',
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export interface ComponentXmlOptions {
  filePathPrefix?: string;
  rtlFiles?: string[];
  simFiles?: string[];
  xguiFile?: string;
  displayName?: string;
}

export function generateComponentXml(
  ipCore: IpCoreData,
  busDefinitions: BusDefinitions,
  options: ComponentXmlOptions = {}
): string {
  const { filePathPrefix = '../', rtlFiles, simFiles, xguiFile, displayName } = options;

  const vendor = String(ipCore.vlnv?.vendor ?? 'user');
  const library = String(ipCore.vlnv?.library ?? 'ip');
  const name = String(ipCore.vlnv?.name ?? 'ip_core');
  const version = String(ipCore.vlnv?.version ?? '1.0.0');
  const description = String(ipCore.description ?? '');
  const clocks = ipCore.clocks ?? [];
  const resets = ipCore.resets ?? [];
  const busInterfaces = ipCore.bus_interfaces ?? [];
  const userPorts = ipCore.ports ?? [];
  const parameters = ipCore.parameters ?? [];

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

  lines.push('  <spirit:busInterfaces>');

  for (const iface of busInterfaces) {
    lines.push(...renderBusInterface(iface, busDefinitions));
  }

  for (const clock of clocks) {
    if (!clock.name) {
      continue;
    }
    const assocBusIfs = busInterfaces
      .filter((bi) => bi.associated_clock === clock.name)
      .map((bi) => String(bi.name).toUpperCase())
      .join(':');
    const assocReset = busInterfaces
      .filter((bi) => bi.associated_clock === clock.name && bi.associated_reset)
      .map((bi) => bi.associated_reset)[0];
    lines.push(...renderClockInterface(clock.name, assocBusIfs, assocReset));
  }

  for (const reset of resets) {
    if (!reset.name) {
      continue;
    }
    lines.push(...renderResetInterface(reset.name, reset.polarity ?? 'activeHigh'));
  }

  lines.push('  </spirit:busInterfaces>');

  // ── model ─────────────────────────────────────────────────────────────────

  lines.push('  <spirit:model>');
  lines.push(...renderViews(name));
  lines.push(...renderPorts(clocks, resets, busInterfaces, userPorts, busDefinitions));
  lines.push('  </spirit:model>');

  // ── fileSets ──────────────────────────────────────────────────────────────

  lines.push(...renderFileSets(resolvedRtlFiles, resolvedSimFiles, derivedXguiFile));

  // ── description ───────────────────────────────────────────────────────────

  if (description) {
    lines.push(`  <spirit:description>${x(description)}</spirit:description>`);
  }

  // ── parameters ────────────────────────────────────────────────────────────

  lines.push(...renderParameters(name, parameters));

  // ── vendorExtensions ──────────────────────────────────────────────────────

  lines.push(...renderVendorExtensions(derivedDisplayName));

  lines.push('</spirit:component>');

  return lines.join('\n');
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderBusInterface(iface: BusInterfaceDef, busDefinitions: BusDefinitions): string[] {
  const ifaceName = String(iface.name ?? '');
  const ifaceType = String(iface.type ?? '');
  const mode = String(iface.mode ?? 'slave').toLowerCase();

  const vivadoType = IPCRAFT_TO_VIVADO[ifaceType];
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
    lines.push(`      <!-- Unsupported type: ${x(ifaceType)} -->`);
    lines.push(
      `      <spirit:busType spirit:vendor="user.org" spirit:library="user" spirit:name="${x(ifaceType)}" spirit:version="1.0" />`
    );
    lines.push(
      `      <spirit:abstractionType spirit:vendor="user.org" spirit:library="user" spirit:name="${x(ifaceType)}_rtl" spirit:version="1.0" />`
    );
  }

  lines.push(`      <spirit:${modeToXmlTag(mode)} />`);

  // portMaps
  if (vivadoType) {
    const busDef = busDefinitions[vivadoType.libraryKey];
    if (busDef?.ports) {
      lines.push(...busDefPortMaps(busDef.ports, iface, mode));
    }
  } else if (customBus) {
    lines.push(...busDefPortMaps(customBus.ports, iface, mode));
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
  if (hasAssocBusIf || hasAssocReset) {
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
    lines.push('      </spirit:parameters>');
  }

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
    `          <spirit:value spirit:id="BUSIFPARAM_VALUE.${x(rstUpper)}.POLARITY">${polarityValue}</spirit:value>`
  );
  lines.push('        </spirit:parameter>');
  lines.push('      </spirit:parameters>');
  lines.push('    </spirit:busInterface>');
  return lines;
}

function renderViews(entityName: string): string[] {
  function view(
    viewName: string,
    displayName: string,
    envId: string,
    fileSetRef: string,
    language?: string
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
    out.push('        <spirit:fileSetRef>');
    out.push(`          <spirit:localName>${x(fileSetRef)}</spirit:localName>`);
    out.push('        </spirit:fileSetRef>');
    out.push('        <spirit:parameters>');
    out.push('          <spirit:parameter>');
    out.push('            <spirit:name>viewChecksum</spirit:name>');
    out.push('            <spirit:value>00000000</spirit:value>');
    out.push('          </spirit:parameter>');
    out.push('        </spirit:parameters>');
    out.push('      </spirit:view>');
    return out;
  }

  const lines: string[] = [];
  lines.push('    <spirit:views>');
  lines.push(
    ...view(
      'xilinx_vhdlsynthesis',
      'VHDL Synthesis',
      'vhdlSource:vivado.xilinx.com:synthesis',
      'xilinx_vhdlsynthesis_view_fileset',
      'vhdl'
    )
  );
  lines.push(
    ...view(
      'xilinx_vhdlbehavioralsimulation',
      'VHDL Simulation',
      'vhdlSource:vivado.xilinx.com:simulation',
      'xilinx_vhdlbehavioralsimulation_view_fileset',
      'vhdl'
    )
  );
  lines.push(
    ...view('xilinx_xpgui', 'UI Layout', ':vivado.xilinx.com:xgui.ui', 'xilinx_xpgui_view_fileset')
  );
  lines.push('    </spirit:views>');
  return lines;
}

function renderPorts(
  clocks: Array<{ name?: string }>,
  resets: Array<{ name?: string; polarity?: string }>,
  busInterfaces: BusInterfaceDef[],
  userPorts: Array<{ name?: string; direction?: string; width?: number | string }>,
  busDefinitions: BusDefinitions
): string[] {
  const lines: string[] = [];
  lines.push('    <spirit:ports>');

  for (const clock of clocks) {
    if (!clock.name) {
      continue;
    }
    lines.push(...renderModelPort(clock.name, 'in', 1));
  }

  for (const reset of resets) {
    if (!reset.name) {
      continue;
    }
    lines.push(...renderModelPort(reset.name, 'in', 1));
  }

  for (const iface of busInterfaces) {
    const ifaceType = String(iface.type ?? '');
    const mode = String(iface.mode ?? 'slave').toLowerCase();
    const vivadoType = IPCRAFT_TO_VIVADO[ifaceType];
    const sourcePorts: BusPortDefinition[] | undefined = vivadoType
      ? busDefinitions[vivadoType.libraryKey]?.ports
      : findCustomBusDef(ifaceType, busDefinitions)?.ports;

    if (!sourcePorts) {
      continue;
    }
    const activePorts = getActiveBusPortsFromDefinition(
      sourcePorts as Array<{ name: string; width?: number; direction?: string; presence?: string }>,
      iface.use_optional_ports ?? [],
      String(iface.physical_prefix ?? ''),
      mode,
      iface.port_width_overrides ?? {}
    );
    for (const port of activePorts) {
      lines.push(...renderModelPort(String(port.name), String(port.direction), Number(port.width)));
    }
  }

  for (const port of userPorts) {
    if (!port.name) {
      continue;
    }
    const width = typeof port.width === 'number' ? port.width : 1;
    lines.push(...renderModelPort(String(port.name), String(port.direction ?? 'in'), width));
  }

  lines.push('    </spirit:ports>');
  return lines;
}

function renderModelPort(name: string, direction: string, width: number): string[] {
  const lines: string[] = [];
  lines.push('      <spirit:port>');
  lines.push(`        <spirit:name>${x(name)}</spirit:name>`);
  lines.push('        <spirit:wire>');
  lines.push(`          <spirit:direction>${x(direction)}</spirit:direction>`);
  if (width > 1) {
    lines.push('          <spirit:vector>');
    lines.push(`            <spirit:left spirit:format="long">${width - 1}</spirit:left>`);
    lines.push('            <spirit:right spirit:format="long">0</spirit:right>');
    lines.push('          </spirit:vector>');
  }
  lines.push('          <spirit:wireTypeDefs>');
  lines.push('            <spirit:wireTypeDef>');
  lines.push(
    `              <spirit:typeName>${width > 1 ? 'std_logic_vector' : 'std_logic'}</spirit:typeName>`
  );
  lines.push('              <spirit:viewNameRef>xilinx_vhdlsynthesis</spirit:viewNameRef>');
  lines.push(
    '              <spirit:viewNameRef>xilinx_vhdlbehavioralsimulation</spirit:viewNameRef>'
  );
  lines.push('            </spirit:wireTypeDef>');
  lines.push('          </spirit:wireTypeDefs>');
  lines.push('        </spirit:wire>');
  lines.push('      </spirit:port>');
  return lines;
}

function renderFileSets(rtlFiles: string[], simFiles: string[], xguiFile: string): string[] {
  const lines: string[] = [];
  lines.push('  <spirit:fileSets>');

  lines.push('    <spirit:fileSet>');
  lines.push('      <spirit:name>xilinx_vhdlsynthesis_view_fileset</spirit:name>');
  for (const f of rtlFiles) {
    lines.push(...renderVhdlFile(f));
  }
  lines.push('    </spirit:fileSet>');

  lines.push('    <spirit:fileSet>');
  lines.push('      <spirit:name>xilinx_vhdlbehavioralsimulation_view_fileset</spirit:name>');
  for (const f of simFiles) {
    lines.push(...renderVhdlFile(f));
  }
  lines.push('    </spirit:fileSet>');

  lines.push('    <spirit:fileSet>');
  lines.push('      <spirit:name>xilinx_xpgui_view_fileset</spirit:name>');
  lines.push('      <spirit:file>');
  lines.push(`        <spirit:name>${x(xguiFile)}</spirit:name>`);
  lines.push('        <spirit:fileType>tclSource</spirit:fileType>');
  lines.push('        <spirit:userFileType>XGUI_VERSION_2</spirit:userFileType>');
  lines.push('      </spirit:file>');
  lines.push('    </spirit:fileSet>');

  lines.push('  </spirit:fileSets>');
  return lines;
}

function renderVhdlFile(filePath: string): string[] {
  return [
    '      <spirit:file>',
    `        <spirit:name>${x(filePath)}</spirit:name>`,
    '        <spirit:fileType>vhdlSource</spirit:fileType>',
    '        <spirit:userFileType>VHDL 2008</spirit:userFileType>',
    '        <spirit:logicalName>xil_defaultlib</spirit:logicalName>',
    '      </spirit:file>',
  ];
}

function renderParameters(entityName: string, parameters: ParameterDef[]): string[] {
  const lines: string[] = [];
  lines.push('  <spirit:parameters>');

  lines.push('    <spirit:parameter>');
  lines.push('      <spirit:name>Component_Name</spirit:name>');
  lines.push(
    `      <spirit:value spirit:id="PARAM_VALUE.Component_Name">${x(entityName)}</spirit:value>`
  );
  lines.push('    </spirit:parameter>');

  for (const param of parameters) {
    if (!param.name) {
      continue;
    }
    const pName = String(param.name);
    const pType = String(param.data_type ?? 'integer').toLowerCase();
    const format = pType === 'integer' ? 'long' : 'string';
    const paramId = `PARAM_VALUE.${pName.toUpperCase()}`;
    lines.push('    <spirit:parameter>');
    lines.push(`      <spirit:name>${x(pName)}</spirit:name>`);
    lines.push(`      <spirit:displayName>${x(pName.replace(/_/g, ' '))}</spirit:displayName>`);
    lines.push(
      `      <spirit:value spirit:format="${format}" spirit:resolve="user" spirit:id="${x(paramId)}">${x(String(param.value ?? ''))}</spirit:value>`
    );
    lines.push('    </spirit:parameter>');
  }

  lines.push('  </spirit:parameters>');
  return lines;
}

function renderVendorExtensions(displayName: string): string[] {
  const families = ['artix7', 'kintex7', 'virtex7', 'zynq', 'kintexu', 'virtexu', 'zynquplus'];

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
  lines.push('      <xilinx:xilinxVersion>2024.2</xilinx:xilinxVersion>');
  lines.push('    </xilinx:packagingInfo>');
  lines.push('  </spirit:vendorExtensions>');
  return lines;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

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
