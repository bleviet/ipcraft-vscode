import { lookupBusDef, type BusPortDef } from '../data/busDefinitions';
import { BUS_VLNV } from '../../../shared/busVlnv';

export interface ProtocolMatch {
  busType: string;
  label: string;
  /** 0..1 — fraction of required signals matched */
  score: number;
  inferredMode: 'slave' | 'master';
  detectedPrefix: string;
  matchedPortNames: string[];
}

interface ProtocolSpec {
  busType: string;
  label: string;
  minRequired: number;
  /** Port name suffixes (lowercase) that are exclusive to this protocol */
  exclusiveSignals?: string[];
}

const PROTOCOL_SPECS: readonly ProtocolSpec[] = [
  // AXI4-Full must come before AXI4-Lite because its exclusiveSignals filter
  // prevents Lite ports from being misclassified as Full.
  {
    busType: BUS_VLNV.AXI4_FULL,
    label: 'AXI4-Full',
    minRequired: 8,
    exclusiveSignals: ['awlen', 'awburst', 'wlast', 'rlast'],
  },
  {
    busType: BUS_VLNV.AXI4_LITE,
    label: 'AXI4-Lite',
    minRequired: 4,
  },
  {
    busType: BUS_VLNV.AXI_STREAM,
    label: 'AXI-Stream',
    minRequired: 2,
  },
  {
    busType: BUS_VLNV.AVALON_MM,
    label: 'Avalon-MM',
    minRequired: 3,
  },
  {
    busType: BUS_VLNV.AVALON_ST,
    label: 'Avalon-ST',
    minRequired: 2,
  },
];

/**
 * Score a set of port names against all known protocols.
 * Returns matches sorted by score descending, filtered to score >= 0.5.
 *
 * Direction information is not available at this stage (we only have names),
 * so mode is inferred by counting direction votes from the BusPortDef list.
 * Full directional enforcement is done in inferPortAssignments().
 */
export function matchPorts(
  ports: Array<{ name: string; direction: 'in' | 'out' | 'inout' }>
): ProtocolMatch[] {
  const portMap = new Map<string, { name: string; direction: 'in' | 'out' | 'inout' }>();
  for (const p of ports) {
    portMap.set(p.name.toLowerCase(), p);
  }

  const results: ProtocolMatch[] = [];

  for (const spec of PROTOCOL_SPECS) {
    const portDefs = lookupBusDef(spec.busType);
    if (!portDefs) {
      continue;
    }

    const signalDefs = portDefs.filter((d) => !d.role);
    const totalRequired = signalDefs.filter((d) => d.presence === 'required').length;
    if (totalRequired === 0) {
      continue;
    }

    // Collect candidate prefixes from port names by stripping known signal suffixes.
    const candidatePrefixes = new Set<string>(['']);
    for (const def of signalDefs) {
      const suffix = def.name.toLowerCase();
      for (const [lower] of portMap) {
        if (lower.endsWith(suffix) && lower.length > suffix.length) {
          const prefix = lower.slice(0, lower.length - suffix.length);
          if (prefix.endsWith('_')) {
            candidatePrefixes.add(prefix);
          }
        }
      }
    }

    for (const prefix of candidatePrefixes) {
      // Apply exclusiveSignals guard to prevent less-specific protocols from
      // matching on a more-specific one's port set.
      if (spec.exclusiveSignals) {
        const hasExclusive = spec.exclusiveSignals.some((s) => portMap.has(prefix + s));
        if (!hasExclusive) {
          continue;
        }
      }

      let requiredMatched = 0;
      let masterVotes = 0;
      let slaveVotes = 0;
      const matchedPortNames: string[] = [];

      for (const def of signalDefs) {
        const port = portMap.get(prefix + def.name.toLowerCase());
        if (!port) {
          continue;
        }
        matchedPortNames.push(port.name);
        if (def.presence === 'required') {
          requiredMatched++;
        }
        // Direction voting: def.direction is from master perspective.
        // If port direction matches master direction → master vote; else → slave vote.
        if (def.direction && port.direction !== 'inout') {
          if (port.direction === def.direction) {
            masterVotes++;
          } else {
            slaveVotes++;
          }
        }
      }

      if (requiredMatched < spec.minRequired) {
        continue;
      }

      // Reject if too many same-prefix ports are unexplained (avoids false positives
      // on register-bank interfaces that happen to share generic signal names).
      if (prefix) {
        const samePrefixCount = [...portMap.keys()].filter((k) => k.startsWith(prefix)).length;
        const unrecognizedCount = samePrefixCount - matchedPortNames.length;
        if (unrecognizedCount >= matchedPortNames.length) {
          continue;
        }
      }

      const score = requiredMatched / totalRequired;
      results.push({
        busType: spec.busType,
        label: spec.label,
        score,
        inferredMode: slaveVotes >= masterVotes ? 'slave' : 'master',
        detectedPrefix: prefix,
        matchedPortNames,
      });
    }
  }

  // Deduplicate: keep best-scoring result per busType
  const best = new Map<string, ProtocolMatch>();
  for (const r of results) {
    const existing = best.get(r.busType);
    if (!existing || r.score > existing.score) {
      best.set(r.busType, r);
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * For a given set of port names and a target busType, find the best-fit prefix
 * and infer mode. Returns null if no plausible match is found.
 */
export function inferPrefixAndMode(
  ports: Array<{ name: string; direction: 'in' | 'out' | 'inout' }>,
  busType: string
): { prefix: string; mode: 'slave' | 'master' } | null {
  const matches = matchPorts(ports);
  const match = matches.find((m) => m.busType === busType);
  if (!match) {
    return null;
  }
  return { prefix: match.detectedPrefix, mode: match.inferredMode };
}

/**
 * Returns the expected direction of a logical signal for a given mode.
 * BusPortDef directions are defined from the master perspective.
 * For slave mode, in/out are swapped.
 */
export function expectedDirection(
  def: BusPortDef,
  mode: 'slave' | 'master'
): 'in' | 'out' | undefined {
  if (!def.direction) {
    return undefined;
  }
  if (mode === 'master') {
    return def.direction;
  }
  return def.direction === 'in' ? 'out' : 'in';
}

export interface SignalAssignment {
  logicalName: string;
  /** null means "unassigned" */
  assignedPort: { name: string; direction: 'in' | 'out' | 'inout' } | null;
  presence: 'required' | 'optional';
  /** Expected direction for the chosen mode */
  expectedDir: 'in' | 'out' | undefined;
  /**
   * True when the assigned port's suffix after stripping the prefix
   * does not match logical_name.toLowerCase() — requires a portNameOverride.
   */
  hasSuffixMismatch: boolean;
}

/**
 * Auto-assign selected ports to logical signals of a protocol.
 *
 * - Direction mismatch is an absolute disqualifier: a port whose direction
 *   contradicts the signal's expected direction is never assigned.
 * - Clock/reset role signals are excluded from the assignment table.
 */
export function inferPortAssignments(
  ports: Array<{ name: string; direction: 'in' | 'out' | 'inout' }>,
  busType: string,
  mode: 'slave' | 'master',
  prefix: string
): SignalAssignment[] {
  const portDefs = lookupBusDef(busType);
  if (!portDefs) {
    return [];
  }

  const signalDefs = portDefs.filter((d) => !d.role);
  const portMap = new Map<string, { name: string; direction: 'in' | 'out' | 'inout' }>();
  for (const p of ports) {
    portMap.set(p.name.toLowerCase(), p);
  }

  return signalDefs.map((def): SignalAssignment => {
    const expDir = expectedDirection(def, mode);
    const canonicalKey = prefix + def.name.toLowerCase();
    const exactMatch = portMap.get(canonicalKey);

    // Exact name match — still verify direction
    if (exactMatch) {
      const dirOk = !expDir || exactMatch.direction === 'inout' || exactMatch.direction === expDir;
      return {
        logicalName: def.name,
        assignedPort: dirOk ? exactMatch : null,
        presence: def.presence,
        expectedDir: expDir,
        hasSuffixMismatch: false,
      };
    }

    // No exact match — leave unassigned
    return {
      logicalName: def.name,
      assignedPort: null,
      presence: def.presence,
      expectedDir: expDir,
      hasSuffixMismatch: false,
    };
  });
}

/** Returns all known standard protocol types, in display order. */
export function getAllProtocols(): ReadonlyArray<{ busType: string; label: string }> {
  return PROTOCOL_SPECS.map(({ busType, label }) => ({ busType, label }));
}

/**
 * Returns the suffix of a port name relative to a prefix, used to detect
 * whether a portNameOverride is needed.
 */
export function portSuffix(portName: string, prefix: string): string {
  const lower = portName.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower.startsWith(prefixLower)) {
    return lower.slice(prefixLower.length);
  }
  return lower;
}
