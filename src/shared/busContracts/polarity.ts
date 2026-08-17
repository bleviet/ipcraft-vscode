import type { BusInterface } from '../../domain/ipcore.types';
import type {
  BusDefinitionContract,
  BusInterfacePortMutation,
  CanonicalizedBusInterface,
  MatchedBusPortRole,
  NormalizedBusPort,
  PortPolarity,
} from './types';

type CanonicalPortField =
  | 'useOptionalPorts'
  | 'portWidthOverrides'
  | 'portNameOverrides'
  | 'absentPorts';

interface LegacyRoleMatch {
  port: NormalizedBusPort;
  polarity: PortPolarity;
  suffix: string;
  isLegacyAlias: boolean;
}

export interface PortNameCandidate {
  /** Contract-declared spelling accepted while matching a physical port. */
  suffix: string;
  /** Default physical suffix for the polarity selected by this candidate. */
  roleSuffix: string;
  polarity?: PortPolarity;
  isDefaultRole?: boolean;
}

/** Derive the physical suffix used when no literal name override is authored. */
export function resolveDefaultPhysicalSuffix<
  T extends Pick<NormalizedBusPort, 'name' | 'polarity'>,
>(port: T, polarity?: PortPolarity): string {
  const selectedPolarity = polarity ?? port.polarity?.default;
  const role =
    selectedPolarity && port.polarity ? port.polarity.roles[selectedPolarity] : port.name;
  return role.toLowerCase();
}

/**
 * Lists only canonical and explicitly declared role spellings for a port. The
 * default role is first, and a distinct canonical spelling retains that role's
 * selected suffix for literal physical-name override comparisons.
 */
export function portNameCandidates<T extends Pick<NormalizedBusPort, 'name' | 'polarity'>>(
  port: T
): PortNameCandidate[] {
  if (!port.polarity) {
    return [{ suffix: port.name, roleSuffix: resolveDefaultPhysicalSuffix(port) }];
  }

  const { default: defaultPolarity, roles } = port.polarity;
  const otherPolarity = defaultPolarity === 'activeHigh' ? 'activeLow' : 'activeHigh';
  const candidates: PortNameCandidate[] = [
    {
      suffix: roles[defaultPolarity],
      roleSuffix: resolveDefaultPhysicalSuffix(port, defaultPolarity),
      polarity: defaultPolarity,
      isDefaultRole: true,
    },
    {
      suffix: port.name,
      roleSuffix: resolveDefaultPhysicalSuffix(port, defaultPolarity),
      polarity: defaultPolarity,
      isDefaultRole: true,
    },
    {
      suffix: roles[otherPolarity],
      roleSuffix: resolveDefaultPhysicalSuffix(port, otherPolarity),
      polarity: otherPolarity,
    },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.suffix.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isPortPolarity(value: unknown): value is PortPolarity {
  return value === 'activeHigh' || value === 'activeLow';
}

function sameValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every(
        ([key, value], index) =>
          key === rightEntries[index]?.[0] && value === rightEntries[index][1]
      )
    );
  }
  return false;
}

function isCanonicalName(match: MatchedBusPortRole, name: string): boolean {
  return match.port.name.toLowerCase() === name.toLowerCase();
}

function recordRole(
  match: MatchedBusPortRole | null,
  authoredName: string,
  roles: Map<string, LegacyRoleMatch>
): void {
  if (!match?.port.polarity || !match.polarity) {
    return;
  }
  const key = match.port.name.toLowerCase();
  roles.delete(key);
  roles.set(key, {
    port: match.port,
    polarity: match.polarity,
    suffix: match.port.polarity.roles[match.polarity],
    isLegacyAlias: !isCanonicalName(match, authoredName),
  });
}

function canonicalizeNames(
  ports: readonly NormalizedBusPort[],
  names: readonly string[] | undefined,
  roles: Map<string, LegacyRoleMatch>
): string[] | undefined {
  if (!names) {
    return undefined;
  }
  const result: string[] = [];
  for (const authoredName of names) {
    const match = matchBusPortRole(ports, authoredName);
    if (!match) {
      result.push(authoredName);
      continue;
    }
    const name = match.port.name;
    const existing = result.findIndex(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    );
    if (existing >= 0) {
      result.splice(existing, 1);
    }
    result.push(name);
    recordRole(match, authoredName, roles);
  }
  return result;
}

function canonicalizeMap<T>(
  ports: readonly NormalizedBusPort[],
  entries: Readonly<Record<string, T>> | undefined,
  roles: Map<string, LegacyRoleMatch>
): Record<string, T> | undefined {
  if (!entries) {
    return undefined;
  }
  const result: Record<string, T> = {};
  for (const [authoredName, value] of Object.entries(entries)) {
    const match = matchBusPortRole(ports, authoredName);
    const name = match?.port.name ?? authoredName;
    const existing = Object.keys(result).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    );
    if (existing !== undefined) {
      delete result[existing];
    }
    result[name] = value;
    recordRole(match, authoredName, roles);
  }
  return result;
}

function canonicalizePolarityOverrides(
  ports: readonly NormalizedBusPort[],
  overrides: BusInterface['portPolarityOverrides']
): Record<string, PortPolarity> | undefined {
  if (!overrides) {
    return undefined;
  }
  const result: Record<string, PortPolarity> = {};
  for (const [authoredName, polarity] of Object.entries(overrides)) {
    const name = matchBusPortRole(ports, authoredName)?.port.name ?? authoredName;
    const existing = Object.keys(result).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    );
    if (existing !== undefined) {
      delete result[existing];
    }
    result[name] = polarity;
  }
  return result;
}

function hasExplicitCanonicalOverride(
  overrides: Readonly<Record<string, PortPolarity>> | undefined,
  port: NormalizedBusPort
): boolean {
  return Object.entries(overrides ?? {}).some(
    ([name]) => name.toLowerCase() === port.name.toLowerCase()
  );
}

function appendMutation(
  mutations: BusInterfacePortMutation[],
  busIndex: number,
  field: CanonicalPortField | 'portPolarityOverrides',
  original: unknown,
  canonical: unknown
): void {
  if (!sameValues(original, canonical)) {
    mutations.push([['busInterfaces', busIndex, field], canonical]);
  }
}

function lookupOverride(
  overrides: Readonly<Record<string, unknown>> | undefined,
  name: string
): unknown {
  let result: unknown;
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (key.toLowerCase() === name.toLowerCase()) {
      result = value;
    }
  }
  return result;
}

/** Match a canonical port name or a declared polarity role without suffix heuristics. */
export function matchBusPortRole(
  ports: readonly NormalizedBusPort[],
  authoredName: string
): MatchedBusPortRole | null {
  const normalizedName = authoredName.toLowerCase();
  const canonical = ports.find((port) => port.name.toLowerCase() === normalizedName);
  if (canonical) {
    return {
      port: canonical,
      ...(canonical.polarity ? { polarity: canonical.polarity.default } : {}),
    };
  }
  for (const port of ports) {
    if (!port.polarity) {
      continue;
    }
    for (const polarity of ['activeHigh', 'activeLow'] as const) {
      if (port.polarity.roles[polarity].toLowerCase() === normalizedName) {
        return { port, polarity };
      }
    }
  }
  return null;
}

/** Convert legacy declared role names to one canonical bus-port identity. */
export function canonicalizeBusInterfacePorts(
  contract: BusDefinitionContract,
  busInterface: BusInterface,
  busIndex: number
): CanonicalizedBusInterface {
  const identityRoles = new Map<string, LegacyRoleMatch>();
  const keyedRoles = new Map<string, LegacyRoleMatch>();
  const useOptionalPorts = canonicalizeNames(
    contract.ports,
    busInterface.useOptionalPorts,
    identityRoles
  );
  const portWidthOverrides = canonicalizeMap(
    contract.ports,
    busInterface.portWidthOverrides,
    keyedRoles
  );
  let portNameOverrides = canonicalizeMap(
    contract.ports,
    busInterface.portNameOverrides,
    keyedRoles
  );
  // Preserve the historical deterministic field order: absentPorts is the
  // later identity-bearing field and wins when both selection lists conflict.
  const absentPorts = canonicalizeNames(contract.ports, busInterface.absentPorts, identityRoles);
  const portPolarityOverrides = canonicalizePolarityOverrides(
    contract.ports,
    busInterface.portPolarityOverrides
  );

  // Keyed-map aliases are migration evidence only when neither identity-bearing
  // selection list establishes that canonical port's role.
  const roles = new Map(keyedRoles);
  for (const [key, role] of identityRoles) {
    roles.set(key, role);
  }

  const mergedPolarityOverrides: Record<string, PortPolarity> = {
    ...(portPolarityOverrides ?? {}),
  };
  for (const { port, polarity } of roles.values()) {
    if (hasExplicitCanonicalOverride(portPolarityOverrides, port)) {
      continue;
    }
    if (polarity === port.polarity?.default) {
      continue;
    }
    mergedPolarityOverrides[port.name] = polarity;
  }

  for (const legacyRole of roles.values()) {
    if (
      !legacyRole.isLegacyAlias ||
      !legacyRole.port.polarity ||
      !hasExplicitCanonicalOverride(portPolarityOverrides, legacyRole.port) ||
      resolveEffectivePortPolarity(legacyRole.port, {
        ...busInterface,
        ...(Object.keys(mergedPolarityOverrides).length > 0
          ? { portPolarityOverrides: mergedPolarityOverrides }
          : {}),
      }) === legacyRole.polarity
    ) {
      continue;
    }
    if (lookupOverride(portNameOverrides, legacyRole.port.name) === undefined) {
      portNameOverrides = {
        ...(portNameOverrides ?? {}),
        [legacyRole.port.name]: legacyRole.suffix,
      };
    }
  }

  const canonicalUseOptionalPorts = useOptionalPorts?.length ? useOptionalPorts : undefined;
  const canonicalPortWidthOverrides =
    portWidthOverrides && Object.keys(portWidthOverrides).length > 0
      ? portWidthOverrides
      : undefined;
  const canonicalPortNameOverrides =
    portNameOverrides && Object.keys(portNameOverrides).length > 0 ? portNameOverrides : undefined;
  const canonicalAbsentPorts = absentPorts?.length ? absentPorts : undefined;
  const canonicalPortPolarityOverrides =
    Object.keys(mergedPolarityOverrides).length > 0 ? mergedPolarityOverrides : undefined;
  const canonicalBusInterface: BusInterface = { ...busInterface };
  if (canonicalUseOptionalPorts) {
    canonicalBusInterface.useOptionalPorts = canonicalUseOptionalPorts;
  } else {
    delete canonicalBusInterface.useOptionalPorts;
  }
  if (canonicalPortWidthOverrides) {
    canonicalBusInterface.portWidthOverrides = canonicalPortWidthOverrides;
  } else {
    delete canonicalBusInterface.portWidthOverrides;
  }
  if (canonicalPortNameOverrides) {
    canonicalBusInterface.portNameOverrides = canonicalPortNameOverrides;
  } else {
    delete canonicalBusInterface.portNameOverrides;
  }
  if (canonicalAbsentPorts) {
    canonicalBusInterface.absentPorts = canonicalAbsentPorts;
  } else {
    delete canonicalBusInterface.absentPorts;
  }
  if (canonicalPortPolarityOverrides) {
    canonicalBusInterface.portPolarityOverrides = canonicalPortPolarityOverrides;
  } else {
    delete canonicalBusInterface.portPolarityOverrides;
  }

  const mutations: BusInterfacePortMutation[] = [];
  appendMutation(
    mutations,
    busIndex,
    'useOptionalPorts',
    busInterface.useOptionalPorts,
    canonicalBusInterface.useOptionalPorts
  );
  appendMutation(
    mutations,
    busIndex,
    'portWidthOverrides',
    busInterface.portWidthOverrides,
    canonicalBusInterface.portWidthOverrides
  );
  appendMutation(
    mutations,
    busIndex,
    'portNameOverrides',
    busInterface.portNameOverrides,
    canonicalBusInterface.portNameOverrides
  );
  appendMutation(
    mutations,
    busIndex,
    'absentPorts',
    busInterface.absentPorts,
    canonicalBusInterface.absentPorts
  );
  appendMutation(
    mutations,
    busIndex,
    'portPolarityOverrides',
    busInterface.portPolarityOverrides,
    canonicalBusInterface.portPolarityOverrides
  );

  return { busInterface: canonicalBusInterface, mutations };
}

export function resolveEffectivePortPolarity(
  port: NormalizedBusPort,
  busInterface: BusInterface
): PortPolarity | undefined {
  if (!port.polarity) {
    return undefined;
  }
  const override = lookupOverride(busInterface.portPolarityOverrides, port.name);
  return isPortPolarity(override) ? override : port.polarity.default;
}

export function resolveInterfaceRole(port: NormalizedBusPort, busInterface: BusInterface): string {
  const polarity = resolveEffectivePortPolarity(port, busInterface);
  return polarity && port.polarity ? port.polarity.roles[polarity] : port.name;
}

export function resolvePhysicalSuffix(port: NormalizedBusPort, busInterface: BusInterface): string {
  const override = lookupOverride(busInterface.portNameOverrides, port.name);
  return typeof override === 'string'
    ? override
    : resolveDefaultPhysicalSuffix(port, resolveEffectivePortPolarity(port, busInterface));
}
