import { canonicalizeBusType, type NormalizedBusLibrary } from '../shared/busContracts';
import { resolveVivadoBusType } from './VivadoBusTypes';
import type { BusPortDefinition, IpCoreData } from './types';

export interface CustomBusInfo {
  vendor: string;
  library: string;
  name: string;
  version: string;
  description: string;
  ports: BusPortDefinition[];
  isAddressable: boolean;
  /** Source metadata distinguishes installed Vivado definitions from authored definitions. */
  source?: string;
}

export function findCustomBusDef(
  ifaceType: string,
  busLibrary: NormalizedBusLibrary
): CustomBusInfo | null {
  if (resolveVivadoBusType(ifaceType, busLibrary)) {
    return null;
  }
  const canonical = canonicalizeBusType(ifaceType, busLibrary);
  if (canonical) {
    const [vendor, library, name, version] = canonical.canonicalVlnv.split(':');
    return {
      vendor,
      library,
      name,
      version,
      description: `${canonical.contract.displayName} interface`,
      ports: canonical.contract.ports.map((port) => ({
        name: port.name,
        width: port.width,
        direction: port.direction,
        presence: port.presence,
        ...(port.role === 'data' || port.role === 'byteQualifier' ? { role: port.role } : {}),
      })),
      isAddressable: canonical.contract.interfaceKind === 'memoryMapped',
      source: canonical.contract.artifactSource,
    };
  }
  return null;
}

export function renderBusDefinitionXml(busInfo: CustomBusInfo): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<spirit:busDefinition',
    '  xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <spirit:vendor>${escapeXml(busInfo.vendor)}</spirit:vendor>`,
    `  <spirit:library>${escapeXml(busInfo.library)}</spirit:library>`,
    `  <spirit:name>${escapeXml(busInfo.name)}</spirit:name>`,
    `  <spirit:version>${escapeXml(busInfo.version)}</spirit:version>`,
    '  <spirit:directConnection>false</spirit:directConnection>',
    `  <spirit:isAddressable>${busInfo.isAddressable ? 'true' : 'false'}</spirit:isAddressable>`,
  ];
  if (busInfo.description) {
    lines.push(`  <spirit:description>${escapeXml(busInfo.description)}</spirit:description>`);
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
    `  <spirit:vendor>${escapeXml(busInfo.vendor)}</spirit:vendor>`,
    `  <spirit:library>${escapeXml(busInfo.library)}</spirit:library>`,
    `  <spirit:name>${escapeXml(busInfo.name)}_rtl</spirit:name>`,
    `  <spirit:version>${escapeXml(busInfo.version)}</spirit:version>`,
    `  <spirit:busType spirit:vendor="${escapeXml(busInfo.vendor)}" spirit:library="${escapeXml(busInfo.library)}" spirit:name="${escapeXml(busInfo.name)}" spirit:version="${escapeXml(busInfo.version)}"/>`,
    '  <spirit:ports>',
  ];

  for (const port of busInfo.ports) {
    const logicalName = String(port.name);
    if (['ACLK', 'ARESETn', 'clk', 'reset'].includes(logicalName)) {
      continue;
    }
    const presence = port.presence ?? 'required';
    const masterDirection = port.direction ?? 'out';
    const slaveDirection = masterDirection === 'out' ? 'in' : 'out';
    const width = port.width ?? 1;

    lines.push('    <spirit:port>');
    lines.push(`      <spirit:logicalName>${escapeXml(logicalName)}</spirit:logicalName>`);
    lines.push('      <spirit:wire>');
    lines.push('        <spirit:onMaster>');
    lines.push(`          <spirit:presence>${escapeXml(presence)}</spirit:presence>`);
    lines.push(`          <spirit:width>${width}</spirit:width>`);
    lines.push(`          <spirit:direction>${escapeXml(masterDirection)}</spirit:direction>`);
    lines.push('        </spirit:onMaster>');
    lines.push('        <spirit:onSlave>');
    lines.push(`          <spirit:presence>${escapeXml(presence)}</spirit:presence>`);
    lines.push(`          <spirit:width>${width}</spirit:width>`);
    lines.push(`          <spirit:direction>${escapeXml(slaveDirection)}</spirit:direction>`);
    lines.push('        </spirit:onSlave>');
    lines.push('      </spirit:wire>');
    lines.push('    </spirit:port>');
  }

  lines.push('  </spirit:ports>');
  lines.push('</spirit:abstractionDefinition>');
  return lines.join('\n');
}

/** Generate bundled IP-XACT definitions for authored, non-native bus interfaces. */
export function generateCustomBusDefs(
  ipCore: IpCoreData,
  busLibrary: NormalizedBusLibrary
): Record<string, string> {
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  const parameterDefaults: Record<string, number> = {};
  for (const parameter of ipCore.parameters ?? []) {
    if (parameter.name && typeof parameter.value === 'number') {
      parameterDefaults[String(parameter.name)] = parameter.value;
    }
  }

  for (const iface of ipCore.busInterfaces ?? []) {
    const ifaceType = String(iface.type ?? '');
    const canonicalVlnv = canonicalizeBusType(ifaceType, busLibrary)?.canonicalVlnv ?? ifaceType;
    if (seen.has(canonicalVlnv)) {
      continue;
    }
    seen.add(canonicalVlnv);
    const custom = findCustomBusDef(ifaceType, busLibrary);
    if (!custom || custom.source === 'vivado') {
      continue;
    }
    const resolvedPorts = custom.ports.map((port) => ({
      ...port,
      width:
        typeof port.width === 'string' ? (parameterDefaults[port.width] ?? 1) : (port.width ?? 1),
    }));
    const resolved: CustomBusInfo = { ...custom, ports: resolvedPorts };
    files[`busdef/${custom.name}.xml`] = renderBusDefinitionXml(resolved);
    files[`busdef/${custom.name}_rtl.xml`] = renderAbstractionDefinitionXml(resolved);
  }
  return files;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
