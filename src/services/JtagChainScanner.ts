/**
 * Parses `jtagconfig` output and matches a board's target device against the JTAG chain it
 * reports, so the JTAG programming helper (issue #79) can derive the `quartus_pgm -o
 * "p;file.sof@N"` device index instead of it being hand-set (the brittle `@2` both DE10-Nano
 * case studies had to hard-code).
 *
 * Sample `jtagconfig` output this parses:
 *   1) USB-Blaster [1-6]
 *     02D020DD   5CSEBA6(.|ES)/5CSEMA6/..
 *     020F30DD   SOCVHPS
 */

export interface JtagDevice {
  /** 1-based position in the chain — the `@N` device index quartus_pgm expects. */
  position: number;
  idcode: string;
  /** Raw device name/pattern as reported by jtagconfig, e.g. "5CSEBA6(.|ES)/5CSEMA6/..". */
  namePattern: string;
}

export interface JtagCable {
  /** Cable number as reported by jtagconfig — accepted directly by quartus_pgm's -c flag. */
  index: number;
  name: string;
  devices: JtagDevice[];
}

const CABLE_LINE = /^(\d+)\)\s+(.+?)\s*$/;
const DEVICE_LINE = /^\s+([0-9A-Fa-f]{6,8})\s+(\S.*?)\s*$/;

/** Parses `jtagconfig`'s stdout into a list of detected cables and their JTAG chain devices. */
export function parseJtagConfigOutput(stdout: string): JtagCable[] {
  const cables: JtagCable[] = [];
  let current: JtagCable | undefined;

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      continue;
    }
    const cableMatch = CABLE_LINE.exec(rawLine);
    if (cableMatch) {
      current = { index: Number(cableMatch[1]), name: cableMatch[2], devices: [] };
      cables.push(current);
      continue;
    }
    const deviceMatch = DEVICE_LINE.exec(rawLine);
    if (deviceMatch && current) {
      current.devices.push({
        position: current.devices.length + 1,
        idcode: deviceMatch[1],
        namePattern: deviceMatch[2],
      });
    }
  }

  return cables;
}

/** Family name shown to the user for a board device string, e.g. "5CSEBA6U23I7" -> "Cyclone V". */
const FAMILY_PREFIXES: Array<{ prefix: string; family: string }> = [
  { prefix: '5C', family: 'Cyclone V' },
  { prefix: '10M', family: 'MAX 10' },
  { prefix: '10AX', family: 'Arria 10' },
  { prefix: '10AS', family: 'Arria 10 SoC' },
  { prefix: 'EP4C', family: 'Cyclone IV' },
  { prefix: 'EP3C', family: 'Cyclone III' },
  { prefix: 'EP2C', family: 'Cyclone II' },
];

export function describeDeviceFamily(devicePart: string): string {
  const upper = devicePart.toUpperCase();
  const match = FAMILY_PREFIXES.find(({ prefix }) => upper.startsWith(prefix));
  return match?.family ?? devicePart;
}

/**
 * Splits a jtagconfig device pattern like "5CSEBA6(.|ES)/5CSEMA6/.." into its alternative
 * device-name prefixes: ["5CSEBA6", "5CSEMA6"] — everything before the first non-alphanumeric
 * character in each `/`-separated alternative.
 */
function extractNamePrefixes(namePattern: string): string[] {
  return namePattern
    .split('/')
    .map((segment) => segment.match(/^[A-Za-z0-9]+/)?.[0])
    .filter((prefix): prefix is string => Boolean(prefix));
}

export interface JtagNodeMatch {
  cable: JtagCable;
  device: JtagDevice;
}

/**
 * Finds the JTAG chain device matching a board's full device part number (e.g.
 * "5CSEBA6U23I7"), scanning every detected cable. A device matches when the board's part
 * number starts with one of the device's jtagconfig name-pattern prefixes (jtagconfig reports
 * only the die name, e.g. "5CSEBA6", not the full ordering code with package/speed suffix).
 */
export function findFpgaNode(
  cables: JtagCable[],
  boardDevicePart: string
): JtagNodeMatch | undefined {
  const target = boardDevicePart.toUpperCase();
  for (const cable of cables) {
    for (const device of cable.devices) {
      const prefixes = extractNamePrefixes(device.namePattern);
      if (prefixes.some((prefix) => target.startsWith(prefix.toUpperCase()))) {
        return { cable, device };
      }
    }
  }
  return undefined;
}
