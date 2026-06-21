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

import { resolvePhysicalPortName, resolveSignalToken, substituteIndex } from './physicalName';

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
      /**
       * Per-signal `*`-wildcard substitutions, set only when the pattern carries `*` because
       * sibling signals disagree on a trailing decoration (e.g. `_i` vs `_o` direction tags).
       * Keys are logical signal names; values are the literal text `*` resolves to for each.
       */
      wildcardMatches?: Record<string, string>;
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
      ...(plan.wildcardMatches ? { wildcardMatches: plan.wildcardMatches } : {}),
      array: {
        count: plan.count,
        indexStart: plan.indexStart,
        namingPattern: plan.namingPattern,
      },
    };
  });
}

/** Derive a logical interface name from a naming pattern by removing the `{index}` (or `{index:N}`)
 *  placeholder. */
export function arrayBaseName(namingPattern: string): string {
  const base = namingPattern
    .replace(/\{index(?::\d+)?\}/g, '')
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

  // 1. Interface names must differ by a single numeric token. Detect a uniform string
  //    width so zero-padded indices (sink_00_if, sink_01_if, ... sink_10_if) collapse to
  //    `{index:2}` instead of being refused at the digit-width boundary.
  const nameDiff = diffVariants(members.map((m) => m.name));
  const nameParsed = numericMiddles(nameDiff);
  if (!nameParsed) {
    return null;
  }
  const { nums: nameIndices, width: nameWidth } = nameParsed;

  // 2. Indices must be a contiguous run; reorder members so index ascends.
  const order = nameIndices.map((idx, pos) => ({ idx, pos })).sort((a, b) => a.idx - b.idx);
  const sortedIndices = order.map((o) => o.idx);
  const indexStart = sortedIndices[0];
  if (!isContiguous(sortedIndices)) {
    return null;
  }
  const orderedMembers = order.map((o) => members[o.pos]);
  const orderedInputIdx = order.map((o) => memberIndices[o.pos]);
  const indexToken = nameWidth && nameWidth > 1 ? `{index:${nameWidth}}` : INDEX_PLACEHOLDER;
  const namingPattern = nameDiff!.prefix + indexToken + nameDiff!.suffix;

  // 3. Build one physicalNamePattern from each signal. When every signal shares the same template
  //    the pattern is uniform; when signals disagree only on a trailing decoration (e.g. Avalon-ST
  //    sinks where `valid`/`data` carry `_i` but `ready` carries `_o`) the common structural part
  //    is emitted with a trailing `*` wildcard and the per-signal decoration is captured in
  //    `wildcardMatches`. Disagreement anywhere other than the trailing suffix refuses the collapse.
  const logicals = Object.keys(orderedMembers[0].signalNames);
  const sigTemplates = new Map<string, string>();
  for (const logical of logicals) {
    const variants = orderedMembers.map((m) => m.signalNames[logical]);
    const sigDiff = diffVariants(variants);
    const sigParsed = numericMiddles(sigDiff);
    if (!sigParsed || !arraysEqual(sigParsed.nums, sortedIndices)) {
      return null; // this signal does not vary by the same index -> not a clean array
    }
    const sigIndexToken =
      sigParsed.width && sigParsed.width > 1 ? `{index:${sigParsed.width}}` : INDEX_PLACEHOLDER;
    const indexTemplated = sigDiff!.prefix + sigIndexToken + sigDiff!.suffix;
    const token = resolveSignalToken(logical);
    const templated = replaceOnce(indexTemplated, token, SIGNAL_PLACEHOLDER);
    if (templated === null) {
      return null; // signal token not found exactly once -> cannot template
    }
    sigTemplates.set(logical, templated);
  }

  const templates = [...sigTemplates.values()];
  const firstTemplate = templates[0];
  const allAgree = templates.every((t) => t === firstTemplate);
  let physicalNamePattern: string;
  let wildcardMatches: Record<string, string> | undefined;
  if (allAgree) {
    physicalNamePattern = firstTemplate;
  } else {
    // Try a trailing-`*` wildcard: the signals must agree up to a common prefix that already
    // contains both `{signal}` and `{index}` (the decoration trails the structural part), and
    // each signal's suffix after that prefix must be non-empty (a real decoration) or empty.
    const common = longestCommonPrefix(templates);
    if (!common.includes(SIGNAL_PLACEHOLDER) || !/\{index(?::\d+)?\}/.test(common)) {
      return null; // disagreement is not a trailing decoration -> cannot template uniformly
    }
    wildcardMatches = {};
    for (const [logical, templated] of sigTemplates) {
      wildcardMatches[logical] = templated.slice(common.length);
    }
    physicalNamePattern = `${common}*`;
  }

  // 4. Lossless guard: the synthesized pattern (with per-signal wildcards) must reproduce every
  //    original name exactly. Uses the shared width-aware, wildcard-aware resolver.
  for (let pos = 0; pos < orderedMembers.length; pos += 1) {
    const member = orderedMembers[pos];
    const idx = sortedIndices[pos];
    if (substituteIndex(namingPattern, idx) !== member.name) {
      return null;
    }
    for (const logical of logicals) {
      const expected = resolvePhysicalPortName(
        logical,
        { physicalNamePattern, wildcardMatches },
        idx
      );
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
    wildcardMatches,
    indexStart,
    count: orderedMembers.length,
  };
}

/** Longest common prefix across all strings in the list. */
function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) {
    return '';
  }
  let prefix = strings[0];
  for (const s of strings) {
    while (prefix.length > 0 && !s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

interface VariantDiff {
  prefix: string;
  suffix: string;
  middles: string[];
}

/** Longest common prefix and (non-overlapping) suffix across all variants.
 *  The varying middle is then extended to absorb adjacent common digit characters from the
 *  prefix/suffix, so a multi-digit or zero-padded index field (`00`, `01`, ... `10`) is captured
 *  whole instead of being split across the literal prefix (which would lose the padding). */
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
  let middles = rests.map((r) => r.slice(0, r.length - suffix.length));
  // Extend the middle leftward: absorb a common leading digit from the prefix into every middle
  // so a zero-padded / multi-digit index is templated as a whole (e.g. `asi_valid_00_i` /
  // `asi_valid_01_i` -> middle `00`/`01`, not `0`/`1` with a stray literal `0` in the prefix).
  while (
    prefix.length > 0 &&
    isDigit(prefix[prefix.length - 1]) &&
    middles.every((m) => /^\d*$/.test(m))
  ) {
    const ch = prefix[prefix.length - 1];
    prefix = prefix.slice(0, -1);
    middles = middles.map((m) => ch + m);
  }
  // Symmetric rightward extension (rare, but keeps a trailing digit out of the suffix).
  while (suffix.length > 0 && isDigit(suffix[0]) && middles.every((m) => /^\d*$/.test(m))) {
    const ch = suffix[0];
    suffix = suffix.slice(1);
    middles = middles.map((m) => m + ch);
  }
  return { prefix, suffix, middles };
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Return the parsed numeric middles when every middle is a distinct non-negative integer.
 * Also reports the common string width of the middles so callers can emit a zero-pad
 * width specifier (`{index:N}`) for padded indices (00, 01, ...). Returns `width: null`
 * when the middles have differing widths (e.g. 99, 100) — a bare `{index}` then round-trips
 * via each number's natural string form. Returns null entirely when the middles are not all
 * numeric or not distinct.
 */
function numericMiddles(diff: VariantDiff | null): { nums: number[]; width: number | null } | null {
  if (!diff) {
    return null;
  }
  const nums: number[] = [];
  const firstLen = diff.middles[0]?.length ?? 0;
  let uniform = true;
  for (const m of diff.middles) {
    if (!/^\d+$/.test(m)) {
      return null;
    }
    if (m.length !== firstLen) {
      uniform = false;
    }
    nums.push(Number(m));
  }
  if (new Set(nums).size !== nums.length) {
    return null;
  }
  return { nums, width: uniform ? firstLen : null };
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
