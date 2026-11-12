/** Human labels for the details panel: source formats and capability keys. */

import type { SystemGraph } from '../../domain/systemGraph';

type Format = SystemGraph['source']['format'];
type Capabilities = SystemGraph['capabilities'];

const FORMAT_LABELS: Record<Format, string> = {
  'vivado-bd-tcl': 'Vivado block design script',
  'vivado-bd': 'Vivado block design',
  qsys: 'Platform Designer system',
  'qsys-tcl': 'Platform Designer script',
};

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  hierarchy: 'Hierarchy',
  connections: 'Connections',
  addressMap: 'Address map',
  userParameters: 'User-set parameters',
  propagatedParameters: 'Default and propagated parameters',
  unconnectedPins: 'Unconnected pins',
};

export function formatLabel(format: Format): string {
  return FORMAT_LABELS[format];
}

/** Eyebrow of the design summary: what kind of design the file describes. */
export function designEyebrow(format: Format): string {
  return format === 'vivado-bd-tcl' || format === 'vivado-bd'
    ? 'Block design'
    : 'Platform Designer system';
}

export function capabilityRows(
  capabilities: Capabilities
): { key: keyof Capabilities; label: string; state: Capabilities[keyof Capabilities] }[] {
  return (Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[]).map((key) => ({
    key,
    label: CAPABILITY_LABELS[key],
    state: capabilities[key],
  }));
}
