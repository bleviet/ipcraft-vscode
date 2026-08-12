import { BUS_VLNV } from '../../../shared/busVlnv';
import {
  canonicalizeBusType,
  type CanonicalPortRole,
  type NormalizedBusLibrary,
} from '../../../shared/busContracts';

export interface BusPortDef {
  name: string;
  width?: number | string;
  direction?: 'in' | 'out';
  presence: 'required' | 'optional';
  role: CanonicalPortRole;
}

export function isAssociatedPort(port: Pick<BusPortDef, 'role'>): boolean {
  return port.role === 'clock' || port.role === 'reset';
}

export function lookupBusDef(
  busType: string,
  library: NormalizedBusLibrary | undefined
): BusPortDef[] | null {
  if (busType === BUS_VLNV.CONDUIT) {
    return [];
  }
  const match = library ? canonicalizeBusType(busType, library) : null;
  return match ? match.contract.ports.map((port) => ({ ...port })) : null;
}

export function isConduitType(busType: string, library: NormalizedBusLibrary | undefined): boolean {
  if (busType === BUS_VLNV.CONDUIT) {
    return true;
  }
  const match = library ? canonicalizeBusType(busType, library) : null;
  return match?.contract.interfaceKind === 'conduit';
}

export function listBuiltinBusTypes(
  library: NormalizedBusLibrary | undefined
): Array<{ vlnv: string; label: string }> {
  if (!library) {
    return [];
  }
  return Object.values(library.definitions)
    .filter((contract) => contract.sourceKind === 'builtin')
    .map((contract) => ({
      vlnv: contract.canonicalVlnv,
      label: contract.displayName,
    }));
}

export function listLibraryBusTypes(
  library: NormalizedBusLibrary | undefined
): Array<{ vlnv: string; label: string }> {
  if (!library) {
    return [];
  }
  return Object.values(library.definitions)
    .filter((contract) => contract.sourceKind !== 'builtin')
    .map((contract) => {
      return {
        vlnv: contract.canonicalVlnv,
        label: contract.displayName,
      };
    });
}
