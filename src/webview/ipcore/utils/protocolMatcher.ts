import { lookupBusDef, type BusPortDef } from '../data/busDefinitions';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { planArrayCollapse, type CollapsibleInterface } from '../../../shared/arrayCollapse';
import { substitutePattern } from '../../../shared/physicalName';

export interface ProtocolMatch {
  busType: string;
  label: string;
  /** 0..1 — fraction of required signals matched (best instance) */
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

type PortLike = { name: string; direction: 'in' | 'out' | 'inout' };

/** Split a port name into lowercase `_`-delimited tokens (empty tokens dropped). */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split('_')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** A logical signal paired with its single-token physical spelling. */
interface SignalToken {
  def: BusPortDef;
  token: string;
}

/**
 * One detected instance of a protocol: the literal "skeleton" (a port's tokens
 * with its signal token removed) shared by every signal that belongs to it, plus
 * the physical port mapped to each logical signal.
 *
 * Ports that share a skeleton are the same interface instance; differing numeric
 * skeletons (`asi_0_i` vs `asi_1_i`) mark array members.
 */
interface DetectedInstance {
  skeleton: string;
  signalToPort: Record<string, PortLike>;
}

/** Find, for a port, the single signal token it contains; ties break toward the
 *  longer (more specific) signal name. Returns null when no signal token matches. */
function matchPortToSignal(
  tokens: string[],
  signals: SignalToken[]
): { signal: SignalToken; pos: number } | null {
  let best: { signal: SignalToken; pos: number } | null = null;
  for (let pos = 0; pos < tokens.length; pos += 1) {
    const tok = tokens[pos];
    const signal = signals.find((s) => s.token === tok);
    if (!signal) {
      continue;
    }
    if (!best || signal.token.length > best.signal.token.length) {
      best = { signal, pos };
    }
  }
  return best;
}

/** Build detected instances by tokenizing every port and grouping on skeleton. */
function buildInstances(ports: PortLike[], signalDefs: BusPortDef[]): DetectedInstance[] {
  const signals: SignalToken[] = signalDefs.map((def) => ({ def, token: def.name.toLowerCase() }));
  const bySkeleton = new Map<string, DetectedInstance>();

  for (const port of ports) {
    const tokens = tokenize(port.name);
    const match = matchPortToSignal(tokens, signals);
    if (!match) {
      continue;
    }
    const skeleton = tokens.filter((_, i) => i !== match.pos).join('_');
    let inst = bySkeleton.get(skeleton);
    if (!inst) {
      inst = { skeleton, signalToPort: {} };
      bySkeleton.set(skeleton, inst);
    }
    // First port wins per signal; a later port for the same signal in the same
    // instance is almost always a duplicate and is ignored.
    if (!inst.signalToPort[match.signal.def.name]) {
      inst.signalToPort[match.signal.def.name] = port;
    }
  }

  return [...bySkeleton.values()];
}

/**
 * Reduce a skeleton to its "core" by stripping trailing non-numeric decoration tokens. The
 * numeric index token (if any) is preserved, so `asi_0_i` and `asi_0_o` both reduce to `asi_0` —
 * they are the same interface instance whose signals carry different direction tags. When there
 * is no numeric token the skeleton is returned unchanged (single-instance, no index to key on).
 */
function coreSkeleton(skeleton: string): string {
  const tokens = skeleton.split('_');
  let last = tokens.length;
  while (last > 0 && tokens[last - 1] !== '' && !/^\d+$/.test(tokens[last - 1])) {
    last -= 1;
  }
  if (last === tokens.length) {
    return skeleton;
  }
  // Only strip when a numeric token remains (otherwise we'd merge unrelated single instances).
  const hasNumeric = tokens.slice(0, last).some((t) => /^\d+$/.test(t));
  return hasNumeric ? tokens.slice(0, last).join('_') : skeleton;
}

/**
 * Merge detected instances that share a core skeleton (differ only by trailing decoration like a
 * direction tag), unioning their per-signal port maps so the collapse sees one instance per index.
 */
function mergeByCoreSkeleton(instances: DetectedInstance[]): DetectedInstance[] {
  const byCore = new Map<string, DetectedInstance>();
  for (const inst of instances) {
    const core = coreSkeleton(inst.skeleton);
    const existing = byCore.get(core);
    if (!existing) {
      byCore.set(core, { ...inst, skeleton: core });
    } else {
      for (const [name, port] of Object.entries(inst.signalToPort)) {
        if (!existing.signalToPort[name]) {
          existing.signalToPort[name] = port;
        }
      }
    }
  }
  return [...byCore.values()];
}

/** Vote master/slave from the directions of the matched ports and their signals. */
function inferMode(matched: Array<{ port: PortLike; def: BusPortDef }>): 'slave' | 'master' {
  let masterVotes = 0;
  let slaveVotes = 0;
  for (const { port, def } of matched) {
    const defDir = def.direction;
    if (!defDir || port.direction === 'inout') {
      continue;
    }
    if (port.direction === defDir) {
      masterVotes += 1;
    } else {
      slaveVotes += 1;
    }
  }
  return slaveVotes >= masterVotes ? 'slave' : 'master';
}

/**
 * Score a set of port names against all known protocols.
 *
 * Matching is token-based: a port covers a logical signal when the signal name is
 * one of the port's `_`-delimited tokens, so decorated / indexed names
 * (`asi_valid_0_i`) are recognized regardless of where the index sits or what
 * direction tag trails the signal. Returns matches sorted by score descending,
 * filtered to score >= 0.5.
 */
export function matchPorts(ports: PortLike[]): ProtocolMatch[] {
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

    const instances = buildInstances(ports, signalDefs);
    if (instances.length === 0) {
      continue;
    }

    for (const inst of instances) {
      const matchedNames = Object.values(inst.signalToPort).map((p) => p.name);
      const requiredMatched = signalDefs.filter(
        (d) => d.presence === 'required' && inst.signalToPort[d.name]
      ).length;

      // Apply exclusiveSignals guard to prevent less-specific protocols from
      // matching on a more-specific one's port set.
      if (spec.exclusiveSignals) {
        const hasExclusive = spec.exclusiveSignals.some((s) =>
          Object.values(inst.signalToPort).some((p) => tokenize(p.name).includes(s))
        );
        if (!hasExclusive) {
          continue;
        }
      }

      if (requiredMatched < spec.minRequired) {
        continue;
      }

      // Reject if too many same-skeleton ports are unexplained. A port belongs to this
      // instance when its tokens minus its signal token equal the instance skeleton.
      const signalsForMatch = signalDefs.map((d) => ({ def: d, token: d.name.toLowerCase() }));
      const sameSkeletonCount = ports.filter((p) => {
        const toks = tokenize(p.name);
        const m = matchPortToSignal(toks, signalsForMatch);
        const rest = m ? toks.filter((_, i) => i !== m.pos).join('_') : toks.join('_');
        return rest === inst.skeleton;
      }).length;
      const unrecognizedCount = sameSkeletonCount - matchedNames.length;
      if (inst.skeleton && unrecognizedCount >= matchedNames.length) {
        continue;
      }

      const score = requiredMatched / totalRequired;
      const defByName = new Map(signalDefs.map((d) => [d.name, d] as const));
      const matchedPairs = Object.entries(inst.signalToPort)
        .map(([name, port]) => ({ port, def: defByName.get(name)! }))
        .filter((p) => p.def);
      results.push({
        busType: spec.busType,
        label: spec.label,
        score,
        inferredMode: inferMode(matchedPairs),
        detectedPrefix: inferPrefixFromInstance(inst),
        matchedPortNames: matchedNames,
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
 * Legacy `physicalPrefix` for an instance when its ports reduce to a uniform
 * `prefix{signal}` template (the common AXI case). Returns '' when the names carry
 * decoration after the signal or do not template uniformly — pattern-based callers
 * then use `physicalNamePattern` instead.
 */
function inferPrefixFromInstance(inst: DetectedInstance): string {
  const pattern = inferSinglePattern(inst);
  if (pattern?.endsWith('{signal}')) {
    return pattern.slice(0, -'{signal}'.length);
  }
  return '';
}

export interface SignalAssignment {
  logicalName: string;
  /** null means "unassigned" */
  assignedPort: PortLike | null;
  presence: 'required' | 'optional';
  /** Expected direction for the chosen mode */
  expectedDir: 'in' | 'out' | undefined;
  /**
   * True when the assigned port's suffix after stripping the prefix
   * does not match logical_name.toLowerCase() — requires a portNameOverride.
   */
  hasSuffixMismatch: boolean;
}

/** Returns the expected direction of a logical signal for a given mode. */
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

/**
 * Build the per-signal assignment table for one instance under a chosen mode.
 * Optional signals are included so the user can opt into them. Direction-filtered:
 * a port whose direction contradicts the signal's expected direction is left
 * unassigned.
 */
function buildAssignments(
  inst: DetectedInstance,
  busType: string,
  mode: 'slave' | 'master'
): SignalAssignment[] {
  const portDefs = lookupBusDef(busType);
  if (!portDefs) {
    return [];
  }
  const signalDefs = portDefs.filter((d) => !d.role);
  return signalDefs.map((def): SignalAssignment => {
    const expDir = expectedDirection(def, mode);
    const port = inst.signalToPort[def.name] ?? null;
    const dirOk = !port || !expDir || port.direction === 'inout' || port.direction === expDir;
    return {
      logicalName: def.name,
      assignedPort: dirOk ? port : null,
      presence: def.presence,
      expectedDir: expDir,
      hasSuffixMismatch: false,
    };
  });
}

/**
 * Infer a uniform `physicalNamePattern` (`{signal}` placeholder) for a single
 * instance: every signal's port must reduce to the same token template, and the
 * template must reproduce each original port name exactly when `{signal}` is
 * substituted back. Returns null when the signals do not share one template
 * (caller then falls back to legacy prefix + overrides).
 */
function inferSinglePattern(inst: DetectedInstance): string | null {
  let pattern: string | null = null;
  for (const [logical, port] of Object.entries(inst.signalToPort)) {
    const sigToken = logical.toLowerCase();
    const tokens = tokenize(port.name);
    const pos = tokens.indexOf(sigToken);
    if (pos === -1) {
      return null;
    }
    const templated = tokens.slice();
    templated[pos] = '{signal}';
    const candidate = templated.join('_');
    if (pattern === null) {
      pattern = candidate;
    } else if (pattern !== candidate) {
      return null;
    }
    if (substitutePattern(candidate, sigToken) !== port.name.toLowerCase()) {
      return null;
    }
  }
  return pattern;
}

export type GroupingPlan =
  | {
      kind: 'single';
      mode: 'slave' | 'master';
      /** legacy prefix when the pattern is a plain `prefix{signal}`; else undefined */
      physicalPrefix?: string;
      /** set when the matched names carry decoration beyond a plain prefix */
      physicalNamePattern?: string;
      /** per-signal `*` substitution, set when the pattern carries `*` */
      wildcardMatches?: Record<string, string>;
      /** read-only table: the auto-assigned signals for the representative instance */
      assignments: SignalAssignment[];
      matchedPortNames: string[];
    }
  | {
      kind: 'array';
      mode: 'slave' | 'master';
      physicalNamePattern: string;
      /** per-signal `*` substitution, set when the pattern carries `*` (mixed direction tags) */
      wildcardMatches?: Record<string, string>;
      array: { count: number; indexStart: number };
      assignments: SignalAssignment[];
      matchedPortNames: string[];
    };

/**
 * Decide how a port selection should be grouped under a bus type: a single
 * interface (legacy prefix or decorated pattern) or an array of interfaces
 * (one `physicalNamePattern` with `{index}` spanning the matched instances).
 *
 * Array detection reuses the shared lossless `planArrayCollapse`: only when the
 * synthesized pattern reproduces every original port name exactly are the
 * siblings merged. Otherwise the selection is treated as a single interface.
 */
export function inferGroupingPlan(ports: PortLike[], busType: string): GroupingPlan | null {
  const portDefs = lookupBusDef(busType);
  if (!portDefs) {
    return null;
  }
  const signalDefs = portDefs.filter((d) => !d.role);
  if (signalDefs.length === 0) {
    return null;
  }

  const rawInstances = buildInstances(ports, signalDefs);
  if (rawInstances.length === 0) {
    return null;
  }
  // Merge instances whose skeletons differ only by a trailing decoration token (e.g. the
  // `_i`/`_o` direction tag on Avalon-ST sinks: `asi_0_i` for valid/data and `asi_0_o` for
  // ready belong to the same instance). The shared wildcard collapse then emits one array
  // interface with a `*` pattern instead of splitting the interface by direction tag.
  const instances = mergeByCoreSkeleton(rawInstances);

  const defByName = new Map(signalDefs.map((d) => [d.name, d] as const));
  const matchedPairs = instances.flatMap((inst) =>
    Object.entries(inst.signalToPort)
      .map(([name, port]) => ({ port, def: defByName.get(name)! }))
      .filter((p) => p.def)
  );
  const mode = inferMode(matchedPairs);
  const matchedPortNames = matchedPairs.map((p) => p.port.name);

  // Array path: feed the instances (skeleton as the per-instance name) to the shared
  // lossless collapse. The skeleton's numeric token becomes {index}; the resulting
  // physicalNamePattern carries both {signal} and {index}.
  if (instances.length >= 2) {
    const collapsibles: CollapsibleInterface[] = instances.map((inst) => ({
      name: inst.skeleton,
      type: busType,
      mode,
      signalNames: Object.fromEntries(
        Object.entries(inst.signalToPort).map(([logical, port]) => [logical, port.name])
      ),
    }));
    const plans = planArrayCollapse(collapsibles);
    const arrayPlan = plans.find((p) => p.kind === 'array');
    if (arrayPlan?.kind === 'array') {
      // Representative instance = lowest index member (first after sort).
      const repInst =
        instances.find((inst) => inst.skeleton === collapsibles[arrayPlan.indices[0]].name) ??
        instances[0];
      return {
        kind: 'array',
        mode,
        physicalNamePattern: arrayPlan.physicalNamePattern,
        wildcardMatches: arrayPlan.wildcardMatches,
        array: { count: arrayPlan.count, indexStart: arrayPlan.indexStart },
        assignments: buildAssignments(repInst, busType, mode),
        matchedPortNames,
      };
    }
  }

  // Single path: prefer one uniform pattern; fall back to a legacy prefix when the
  // pattern is a plain prefix (ends in {signal}) or the signals do not template.
  const inst = instances[0];
  const pattern = inferSinglePattern(inst);
  const assignments = buildAssignments(inst, busType, mode);

  if (pattern?.endsWith('{signal}')) {
    const prefix = pattern.slice(0, -'{signal}'.length);
    return {
      kind: 'single',
      mode,
      physicalPrefix: prefix,
      assignments,
      matchedPortNames,
    };
  }

  if (pattern) {
    return {
      kind: 'single',
      mode,
      physicalNamePattern: pattern,
      assignments,
      matchedPortNames,
    };
  }

  // No uniform template: degrade to a best-effort prefix so the legacy prefix
  // table flow stays usable (overrides cover the irregular signals).
  return {
    kind: 'single',
    mode,
    physicalPrefix: inferPrefixFromInstance(inst),
    assignments,
    matchedPortNames,
  };
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

// Kept for backward-compatibility with any external callers; the grouping dialog
// now uses inferGroupingPlan directly.
export function inferPrefixAndMode(
  ports: PortLike[],
  busType: string
): { prefix: string; mode: 'slave' | 'master' } | null {
  const matches = matchPorts(ports);
  const match = matches.find((m) => m.busType === busType);
  if (!match) {
    return null;
  }
  return { prefix: match.detectedPrefix, mode: match.inferredMode };
}

export function inferPortAssignments(
  ports: PortLike[],
  busType: string,
  mode: 'slave' | 'master',
  prefix: string
): SignalAssignment[] {
  const portDefs = lookupBusDef(busType);
  if (!portDefs) {
    return [];
  }
  const signalDefs = portDefs.filter((d) => !d.role);
  const instances = buildInstances(ports, signalDefs);
  // Best instance by required-signal coverage under the given prefix.
  const inst =
    instances
      .filter((i) => inferPrefixFromInstance(i) === prefix || !prefix)
      .sort((a, b) => countRequired(b, signalDefs) - countRequired(a, signalDefs))[0] ??
    instances[0];
  if (!inst) {
    return signalDefs.map((def) => ({
      logicalName: def.name,
      assignedPort: null,
      presence: def.presence,
      expectedDir: expectedDirection(def, mode),
      hasSuffixMismatch: false,
    }));
  }
  return buildAssignments(inst, busType, mode);
}

function countRequired(inst: DetectedInstance, signalDefs: BusPortDef[]): number {
  return signalDefs.filter((d) => d.presence === 'required' && inst.signalToPort[d.name]).length;
}
