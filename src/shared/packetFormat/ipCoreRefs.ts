import type { IpCore, Parameter } from '../../domain/ipcore.types';
import { resolveBusInterface, type NormalizedBusLibrary } from '../busContracts';
import type { IpcraftIssue } from '../issues';
import type { ResolvedFormat } from './types';

/** What the extension host found for one `packetFormatRef`: the resolved format, or why it did not resolve. */
export interface PacketFormatRefInfo {
  ref: string;
  format?: ResolvedFormat;
  error?: { code: string; message: string; file?: string; path?: string };
}

/** Result for a ref, or undefined while the host has not answered (no issue is reported then). */
export type PacketFormatLookup = (ref: string) => PacketFormatRefInfo | undefined;

/** Splits `<file>#<format>`; undefined when malformed. */
export function splitPacketFormatRef(ref: string): { file: string; format: string } | undefined {
  const i = ref.lastIndexOf('#');
  return i > 0 && i < ref.length - 1
    ? { file: ref.slice(0, i), format: ref.slice(i + 1) }
    : undefined;
}

const DATA_PORTS = ['tdata', 'data'];

function busTypeNames(contractKey: string, canonicalVlnv: string): string[] {
  const parts = canonicalVlnv.split(':');
  return [contractKey, parts.length >= 3 ? parts[parts.length - 2] : ''].map((n) =>
    n.toLowerCase()
  );
}

/**
 * Semantic checks of `packetFormatRef` on the bus interfaces: streaming bus type only, resolvable reference,
 * `busTypes` and `dataWidth` agreement, and a warning when `portFields` are present as well.
 */
export function checkPacketFormatRefs(
  ipCore: IpCore,
  library: NormalizedBusLibrary | undefined,
  lookup: PacketFormatLookup
): IpcraftIssue[] {
  const issues: IpcraftIssue[] = [];
  const parameters = (ipCore.parameters ?? []) as readonly Parameter[];
  (ipCore.busInterfaces ?? []).forEach((bus, busIndex) => {
    const ref = bus.packetFormatRef;
    if (ref === undefined || ref === null) {
      return;
    }
    const path = ['busInterfaces', busIndex, 'packetFormatRef'];
    const add = (code: string, severity: 'error' | 'warning', message: string): void => {
      issues.push({
        code,
        severity,
        source: 'packetFormat',
        path,
        message,
        interfaceName: bus.name,
      });
    };
    const resolution = library
      ? resolveBusInterface({ busInterface: bus, busIndex, parameters, library })
      : undefined;
    const contract = resolution?.match?.contract;
    if (library && contract?.interfaceKind !== 'streaming') {
      add(
        'PACKET_FORMAT_BUS_KIND',
        'error',
        `${bus.name}: packetFormatRef is only allowed on streaming bus interfaces (AXI4-Stream, Avalon-ST).`
      );
    }
    if (typeof ref !== 'string' || !splitPacketFormatRef(ref)) {
      add(
        'PACKET_FORMAT_REF',
        'error',
        `${bus.name}: packetFormatRef must be '<file>#<format name>'.`
      );
      return;
    }
    if (bus.portFields && Object.keys(bus.portFields).length > 0) {
      add(
        'PACKET_FORMAT_PORT_FIELDS',
        'warning',
        `${bus.name}: portFields and packetFormatRef are both set; the packet format wins.`
      );
    }
    const info = lookup(ref);
    if (info?.error) {
      add(
        'PACKET_FORMAT_UNRESOLVED',
        'error',
        `${bus.name}: ${info.ref} does not resolve: ${info.error.message}`
      );
      return;
    }
    const format = info?.format;
    if (!format || !contract || resolution === undefined) {
      return;
    }
    const names = busTypeNames(contract.key, contract.canonicalVlnv);
    if (
      format.busTypes.length > 0 &&
      !format.busTypes.some((t) => names.includes(t.toLowerCase()))
    ) {
      add(
        'PACKET_FORMAT_BUS_TYPE',
        'error',
        `${bus.name}: format ${format.name} is for ${format.busTypes.join(', ')}, not ${contract.key}.`
      );
    }
    const dataPort = contract.ports.find((p) => DATA_PORTS.includes(p.name.toLowerCase()));
    const width = dataPort ? resolution.portWidths[dataPort.name]?.value : undefined;
    if (width !== undefined && width !== format.dataWidth) {
      add(
        'PACKET_FORMAT_WIDTH',
        'error',
        `${bus.name}: format ${format.name} has dataWidth ${format.dataWidth}, the interface ${dataPort?.name} is ${width} bits.`
      );
    }
  });
  return issues;
}
