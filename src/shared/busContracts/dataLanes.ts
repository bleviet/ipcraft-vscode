import type { BusInterface } from '../../domain/ipcore.types';
import type { BusDefinitionContract, BusInterfaceResolution } from './types';

export const BYTE_LANE_WIDTH = 8;

export interface ResolvedDataLane {
  kind: 'byte' | 'symbol';
  width: number | string;
}

/** Classify payload lanes from the contract vocabulary in one place. */
export function dataLaneKind(
  contract: Pick<BusDefinitionContract, 'interfaceProperties'> | null | undefined
): ResolvedDataLane['kind'] {
  return contract &&
    Object.prototype.hasOwnProperty.call(contract.interfaceProperties, 'dataBitsPerSymbol')
    ? 'symbol'
    : 'byte';
}

/** Resolve data-lane semantics from contract metadata, independent of protocol identity. */
export function resolveDataLane(
  resolution: BusInterfaceResolution,
  busInterface: Pick<BusInterface, 'interfaceProperties'>
): ResolvedDataLane {
  const kind = dataLaneKind(resolution.match?.contract);
  if (kind === 'byte') {
    return { kind, width: BYTE_LANE_WIDTH };
  }

  const resolvedWidth = resolution.properties.dataBitsPerSymbol?.value;
  if (typeof resolvedWidth === 'number') {
    return { kind: 'symbol', width: resolvedWidth };
  }

  const authoredWidth = busInterface.interfaceProperties?.dataBitsPerSymbol;
  return {
    kind,
    width:
      typeof authoredWidth === 'number' || typeof authoredWidth === 'string'
        ? authoredWidth
        : BYTE_LANE_WIDTH,
  };
}
