/**
 * Convention-agnostic detection of "array of interfaces".
 *
 * Multiple bus interfaces of the same type/mode/signal-set that differ only by a numeric
 * instance index (sink_0_if / sink_1_if, whose ports are asi_valid_0_i / asi_valid_1_i, ...)
 * are collapsed into a single interface carrying an `array` block plus a `physicalNamePattern`
 * with `{signal}` / `{index}` placeholders.
 *
 * The index may appear anywhere in the physical name (prefix, middle, suffix) and may be glued
 * to surrounding text (m_axis_ch0_*). Detection is purely structural — it finds the single token
 * that varies numerically across siblings — so no naming convention (direction tags, etc.) is
 * hardcoded. A collapse is only emitted when the synthesized pattern reproduces every original
 * port name and interface name exactly (the lossless guard); otherwise the inputs are kept as-is.
 */

import { resolveSignalToken, substitutePattern } from './physicalName';

export interface CollapsibleInterface {
  name: string;
  type: string;
  mode: string;
  /** logical signal name -> actual physical port name as it appears in the HDL */
  signalNames: Record<string, string>;
}

export type CollapsePlan =
  | { kind: 'single'; index: number }
  | {
      kind: 'array';
      /** input indices that were merged, lowest first */
      indices: number[];
      namingPattern: string;
      physicalNamePattern: string;
      indexStart: number;
      count: number;
    };

const INDEX_PLACEHOLDER = '{index}';
const SIGNAL_PLACEHOLDER = '{signal}';

/**
 * Plan how to collapse a list of single-instance interfaces into arrays. Returns one entry per
 * resulting interface, in input order; an array plan is placed at the position of its first member.
 */
export function planArrayCollapse(interfaces: CollapsibleInterface[]): CollapsePlan[] {
  const groups = groupBySignature(interfaces);
  const consumed = new Set<number>();
  const arrayByFirstIndex = new Map<number, CollapsePlan>();

  for (const memberIndices of groups.values()) {
    if (memberIndices.length < 2) {
      continue;
    }
    const plan = tryCollapseGroup(interfaces, memberIndices);
    if (plan) {
      for (const i of memberIndices) {
        consumed.add(i);
      }
      arrayByFirstIndex.set(plan.indices[0], plan);
    }
  }

  const result: CollapsePlan[] = [];
  for (let i = 0; i < interfaces.length; i += 1) {
    const arrayPlan = arrayByFirstIndex.get(i);
    if (arrayPlan) {
      result.push(arrayPlan);
    } else if (!consumed.has(i)) {
      result.push({ kind: 'single', index: i });
    }
  }
  return result;
}

/**
 * Importer convenience: given parallel YAML entries and their collapsible views, return the final
 * busInterfaces list with index-varying siblings merged into single `array` entries. The lossy
 * `physicalPrefix` / `portNameOverrides` of a merged group are dropped in favour of the synthesized
 * `physicalNamePattern`; the merged entry's `name` becomes the array base name.
 */
export function applyArrayCollapse<T extends object>(
  built: Array<{ entry: T; collapsible: CollapsibleInterface }>
): Array<Record<string, unknown>> {
  const plans = planArrayCollapse(built.map((b) => b.collapsible));
  return plans.map((plan): Record<string, unknown> => {
    if (plan.kind === 'single') {
      return built[plan.index].entry as Record<string, unknown>;
    }
    const {
      physicalPrefix: _p,
      portNameOverrides: _o,
      ...rest
    } = built[plan.indices[0]].entry as Record<string, unknown>;
    return {
      ...rest,
      name: arrayBaseName(plan.namingPattern),
      physicalNamePattern: plan.physicalNamePattern,
      array: {
        count: plan.count,
        indexStart: plan.indexStart,
        namingPattern: plan.namingPattern,
      },
    };
  });
}

/** Derive a logical interface name from a naming pattern by removing the `{index}` placeholder. */
export function arrayBaseName(namingPattern: string): string {
  const base = namingPattern
    .split(INDEX_PLACEHOLDER)
    .join('')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '');
  return base || 'bus';
}

function signature(iface: CollapsibleInterface): string {
  const signals = Object.keys(iface.signalNames)
    .map((s) => s.toLowerCase())
    .sort()
    .join(',');
  return `${iface.type}|${iface.mode}|${signals}`;
}

function groupBySignature(interfaces: CollapsibleInterface[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  interfaces.forEach((iface, i) => {
    const key = signature(iface);
    const existing = groups.get(key);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(key, [i]);
    }
  });
  return groups;
}

function tryCollapseGroup(
  interfaces: CollapsibleInterface[],
  memberIndices: number[]
): Extract<CollapsePlan, { kind: 'array' }> | null {
  const members = memberIndices.map((i) => interfaces[i]);

  // 1. Interface names must differ by a single numeric token.
  const nameDiff = diffVariants(members.map((m) => m.name));
  const nameIndices = numericMiddles(nameDiff);
  if (!nameIndices) {
    return null;
  }

  // 2. Indices must be a contiguous run; reorder members so index ascends.
  const order = nameIndices.map((idx, pos) => ({ idx, pos })).sort((a, b) => a.idx - b.idx);
  const sortedIndices = order.map((o) => o.idx);
  const indexStart = sortedIndices[0];
  if (!isContiguous(sortedIndices)) {
    return null;
  }
  const orderedMembers = order.map((o) => members[o.pos]);
  const orderedInputIdx = order.map((o) => memberIndices[o.pos]);
  const namingPattern = nameDiff!.prefix + INDEX_PLACEHOLDER + nameDiff!.suffix;

  // 3. Build one physicalNamePattern from each signal and require they all agree.
  const logicals = Object.keys(orderedMembers[0].signalNames);
  let physicalNamePattern: string | null = null;
  for (const logical of logicals) {
    const variants = orderedMembers.map((m) => m.signalNames[logical]);
    const sigDiff = diffVariants(variants);
    const sigIndices = numericMiddles(sigDiff);
    if (!sigIndices || !arraysEqual(sigIndices, sortedIndices)) {
      return null; // this signal does not vary by the same index -> not a clean array
    }
    const indexTemplated = sigDiff!.prefix + INDEX_PLACEHOLDER + sigDiff!.suffix;
    const token = resolveSignalToken(logical);
    const templated = replaceOnce(indexTemplated, token, SIGNAL_PLACEHOLDER);
    if (templated === null) {
      return null; // signal token not found exactly once -> cannot template
    }
    if (physicalNamePattern === null) {
      physicalNamePattern = templated;
    } else if (physicalNamePattern !== templated) {
      return null; // signals disagree on the template
    }
  }
  if (physicalNamePattern === null) {
    return null;
  }

  // 4. Lossless guard: the synthesized patterns must reproduce every original name exactly.
  for (let pos = 0; pos < orderedMembers.length; pos += 1) {
    const member = orderedMembers[pos];
    const idx = sortedIndices[pos];
    if (namingPattern.split(INDEX_PLACEHOLDER).join(String(idx)) !== member.name) {
      return null;
    }
    for (const logical of logicals) {
      const expected = substitutePattern(physicalNamePattern, resolveSignalToken(logical), idx);
      if (expected !== member.signalNames[logical]) {
        return null;
      }
    }
  }

  return {
    kind: 'array',
    indices: orderedInputIdx,
    namingPattern,
    physicalNamePattern,
    indexStart,
    count: orderedMembers.length,
  };
}

interface VariantDiff {
  prefix: string;
  suffix: string;
  middles: string[];
}

/** Longest common prefix and (non-overlapping) suffix across all variants. */
function diffVariants(variants: string[]): VariantDiff | null {
  if (variants.length < 2) {
    return null;
  }
  let prefix = variants[0];
  for (const v of variants) {
    while (prefix.length > 0 && !v.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  const rests = variants.map((v) => v.slice(prefix.length));
  let suffix = rests[0];
  for (const r of rests) {
    while (suffix.length > 0 && !r.endsWith(suffix)) {
      suffix = suffix.slice(1);
    }
  }
  const middles = rests.map((r) => r.slice(0, r.length - suffix.length));
  return { prefix, suffix, middles };
}

/** Return the parsed numeric middles when every middle is a distinct non-negative integer. */
function numericMiddles(diff: VariantDiff | null): number[] | null {
  if (!diff) {
    return null;
  }
  const nums: number[] = [];
  for (const m of diff.middles) {
    if (!/^\d+$/.test(m)) {
      return null;
    }
    nums.push(Number(m));
  }
  if (new Set(nums).size !== nums.length) {
    return null;
  }
  return nums;
}

function isContiguous(sortedAscending: number[]): boolean {
  for (let i = 1; i < sortedAscending.length; i += 1) {
    if (sortedAscending[i] !== sortedAscending[i - 1] + 1) {
      return false;
    }
  }
  return true;
}

/** Replace exactly one occurrence of `needle`; return null if it occurs zero or many times. */
function replaceOnce(haystack: string, needle: string, replacement: string): string | null {
  const first = haystack.indexOf(needle);
  if (first === -1) {
    return null;
  }
  if (haystack.indexOf(needle, first + needle.length) !== -1) {
    return null;
  }
  return haystack.slice(0, first) + replacement + haystack.slice(first + needle.length);
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
