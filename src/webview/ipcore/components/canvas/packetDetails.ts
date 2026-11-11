export interface PacketDetailsTarget {
  /** Canvas id of the bus bundle, `bus:<index>`. */
  portId: string;
  ref: string;
  busName: string;
}

interface BusLike {
  name: string;
  packetFormatRef?: string | null;
}

/** The bus behind a canvas id, if it is a bus interface with a packet format. */
export function packetDetailsTarget(
  id: string | null,
  busInterfaces: readonly BusLike[] | undefined
): PacketDetailsTarget | null {
  const match = id ? /^bus:(\d+)$/.exec(id) : null;
  const bus = match ? busInterfaces?.[Number(match[1])] : undefined;
  return id && bus?.packetFormatRef
    ? { portId: id, ref: bus.packetFormatRef, busName: bus.name }
    : null;
}
