/**
 * Grafts the graph of a Platform Designer subsystem file into its parent graph
 * as a hierarchy level, mirroring the levels a Vivado block design produces.
 * Pure: returns a new graph and never mutates its inputs.
 */

import type {
  AddressSegment,
  CapabilityState,
  SystemDiagnostic,
  SystemGraph,
  SystemInstance,
  SystemLevel,
  SystemNet,
  SystemSourceRef,
} from '../../../domain/systemGraph';

const ROOT = '/';
const STRENGTH: Record<CapabilityState, number> = { unavailable: 0, partial: 1, complete: 2 };

/** The graph is JSON-serializable by contract. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const weaker = (a: CapabilityState, b: CapabilityState): CapabilityState =>
  STRENGTH[a] <= STRENGTH[b] ? a : b;

export function graftSubsystem(
  parent: SystemGraph,
  instancePath: string,
  child: SystemGraph,
  source: SystemSourceRef
): SystemGraph {
  const instance = parent.instances[instancePath];
  // Child path `/x` -> `${instancePath}/x`; the child root becomes the instance.
  const prefixed = (path: string) => (path === ROOT ? instancePath : `${instancePath}${path}`);

  const exported = child.levels[ROOT].boundaryPins.map((pin) => clone(pin));
  const exportedNames = new Set(exported.map((pin) => pin.name));
  const missing = instance.pins.filter((pin) => !exportedNames.has(pin.name));
  const pins = [...exported, ...missing.map((pin) => clone(pin))];

  const diagnostics: SystemDiagnostic[] = [...parent.diagnostics];
  if (missing.length > 0) {
    diagnostics.push({
      severity: 'warning',
      message: `${instance.name} connects to ${missing
        .map((pin) => pin.name)
        .join(', ')}, which ${source.fileName} does not export.`,
      lines: [instance.line],
      ...(instance.parent !== ROOT && { level: instance.parent }),
    });
  }
  for (const diagnostic of child.diagnostics) {
    diagnostics.push({ ...diagnostic, level: prefixed(diagnostic.level ?? ROOT) });
  }

  const instances: Record<string, SystemInstance> = {
    ...parent.instances,
    [instancePath]: { ...instance, kind: 'hier', pins: clone(pins) },
  };
  for (const [path, childInstance] of Object.entries(child.instances)) {
    instances[prefixed(path)] = {
      ...clone(childInstance),
      path: prefixed(path),
      parent: prefixed(childInstance.parent),
    };
  }

  const levels: Record<string, SystemLevel> = {
    ...parent.levels,
    [instancePath]: {
      path: instancePath,
      name: instance.name,
      boundaryPins: clone(pins),
      instances: child.levels[ROOT].instances.map(prefixed),
      source,
    },
  };
  for (const [path, level] of Object.entries(child.levels)) {
    if (path !== ROOT) {
      levels[prefixed(path)] = {
        ...clone(level),
        path: prefixed(path),
        instances: level.instances.map(prefixed),
        source: level.source ?? source,
      };
    }
  }

  const nets: SystemNet[] = child.nets.map((net) => ({
    ...clone(net),
    id: `${prefixed(net.level)}::${net.name}`,
    level: prefixed(net.level),
    endpoints: net.endpoints.map((ref) => ({
      ...ref,
      instance: ref.instance === null ? null : prefixed(ref.instance),
    })),
  }));

  const segments: AddressSegment[] = child.addressSegments.map((segment) => ({
    ...segment,
    addressSpace: `${instance.name}/${segment.addressSpace}`,
    segment: `${instance.name}/${segment.segment}`,
    masterInstance: prefixed(segment.masterInstance),
    slaveInstance: prefixed(segment.slaveInstance),
  }));

  const capabilities = { ...parent.capabilities };
  for (const key of Object.keys(capabilities) as (keyof SystemGraph['capabilities'])[]) {
    capabilities[key] = weaker(capabilities[key], child.capabilities[key]);
  }

  return {
    ...parent,
    levels,
    instances,
    nets: [...parent.nets, ...nets],
    addressSegments: [...parent.addressSegments, ...segments],
    capabilities,
    diagnostics,
  };
}
