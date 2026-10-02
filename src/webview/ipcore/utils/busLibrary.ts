import { BUS_VLNV } from '../../../shared/busVlnv';
import {
  canonicalizeBusType,
  type CanonicalPortRole,
  type NormalizedBusLibrary,
  type NormalizedPortPolarity,
} from '../../../shared/busContracts';

export { portNameCandidates, type PortNameCandidate } from '../../../shared/busContracts';

export interface BusPortDef {
  name: string;
  width?: number | string;
  direction?: 'in' | 'out';
  presence: 'required' | 'optional';
  role: CanonicalPortRole;
  polarity?: NormalizedPortPolarity;
}

export function isAssociatedPort(port: Pick<BusPortDef, 'role'>): boolean {
  return port.role === 'clock' || port.role === 'reset';
}

/** Resolve a bus type to its contract, tolerating an unloaded library. */
function matchContract(busType: string, library: NormalizedBusLibrary | undefined) {
  return library ? canonicalizeBusType(busType, library)?.contract : undefined;
}

/** Bus types whose contracts carry the given source, as palette entries. */
function listBusTypes(
  library: NormalizedBusLibrary | undefined,
  isBuiltin: boolean
): Array<{ vlnv: string; label: string }> {
  return Object.values(library?.definitions ?? {})
    .filter((contract) => (contract.sourceKind === 'builtin') === isBuiltin)
    .map((contract) => ({
      vlnv: contract.canonicalVlnv,
      label: contract.displayName,
    }));
}

export function lookupBusDef(
  busType: string,
  library: NormalizedBusLibrary | undefined
): BusPortDef[] | null {
  if (busType === BUS_VLNV.CONDUIT) {
    return [];
  }
  const contract = matchContract(busType, library);
  return contract ? contract.ports.map((port) => ({ ...port })) : null;
}

export function isConduitType(busType: string, library: NormalizedBusLibrary | undefined): boolean {
  if (busType === BUS_VLNV.CONDUIT) {
    return true;
  }
  return matchContract(busType, library)?.interfaceKind === 'conduit';
}

export function listBuiltinBusTypes(
  library: NormalizedBusLibrary | undefined
): Array<{ vlnv: string; label: string }> {
  return listBusTypes(library, true);
}

export function listLibraryBusTypes(
  library: NormalizedBusLibrary | undefined
): Array<{ vlnv: string; label: string }> {
  return listBusTypes(library, false);
}
