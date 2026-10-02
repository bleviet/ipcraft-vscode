import {
  canonicalizeBusType,
  resolveBusInterface,
  type BusDefinitionContract,
  type NormalizedBusLibrary,
} from '../shared/busContracts';
import type { BusInterface, Parameter } from '../domain/ipcore.types';
import { resolveVivadoBusType, resolveVivadoBusTypeForInterface } from './VivadoBusTypes';
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

/**
 * The IP-XACT bus information for an IPCraft contract. It declares every polarity role
 * as a logical port, so per-IP and globally installed copies of one VLNV are identical.
 */
export function customBusInfoFromContract(contract: BusDefinitionContract): CustomBusInfo {
  const [vendor, library, name, version] = contract.canonicalVlnv.split(':');
  return {
    vendor,
    library,
    name,
    version,
    description: `${contract.displayName} interface`,
    ports: contract.ports.map((port) => ({
      name: port.name,
      width: port.width,
      direction: port.direction,
      presence: port.presence,
      interfaceRoles: port.polarity
        ? [port.polarity.roles.activeHigh, port.polarity.roles.activeLow]
        : [port.name],
      ...(port.role === 'data' || port.role === 'byteQualifier' ? { role: port.role } : {}),
    })),
    isAddressable: contract.interfaceKind === 'memoryMapped',
    source: contract.artifactSource,
  };
}

/** The IPCraft bus definition for a type that has no native Vivado bus. */
export function findCustomBusDef(
  ifaceType: string,
  busLibrary: NormalizedBusLibrary
): CustomBusInfo | null {
  if (resolveVivadoBusType(ifaceType, busLibrary)) {
    return null;
  }
  const canonical = canonicalizeBusType(ifaceType, busLibrary);
  return canonical ? customBusInfoFromContract(canonical.contract) : null;
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
    const canonicalName = String(port.name);
    if (['ACLK', 'ARESETn', 'clk', 'reset'].includes(canonicalName)) {
      continue;
    }
    const interfaceRoles = port.interfaceRoles ?? [canonicalName];
    const presence = interfaceRoles.length > 1 ? 'optional' : (port.presence ?? 'required');
    const masterDirection = port.direction ?? 'out';
    const slaveDirection = masterDirection === 'out' ? 'in' : 'out';
    const width = port.width ?? 1;

    for (const logicalName of interfaceRoles) {
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
    const resolution = resolveBusInterface({
      busInterface: iface as unknown as BusInterface,
      busIndex: 0,
      parameters: (ipCore.parameters ?? []) as unknown as Parameter[],
      library: busLibrary,
    });
    const contract = resolution.match?.contract;
    if (
      !contract ||
      seen.has(contract.canonicalVlnv) ||
      resolveVivadoBusTypeForInterface(ifaceType, busLibrary, resolution)
    ) {
      continue;
    }
    seen.add(contract.canonicalVlnv);
    const custom = customBusInfoFromContract(contract);
    if (custom.source === 'vivado') {
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
