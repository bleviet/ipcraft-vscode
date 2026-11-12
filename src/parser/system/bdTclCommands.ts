/**
 * Handlers for the block design commands the static reader understands
 * (`create_bd_*`, `set_property`, `connect_bd_*`, `assign_bd_address`). Each
 * handler turns one parsed command into graph mutations through the builder.
 */

import type { PinDirection, PinRef, SignalType } from '../../domain/systemGraph';
import {
  joinPath,
  lastComponent,
  parentPath,
  type ParameterTarget,
  type PinSpec,
  type SystemGraphBuilder,
} from './bdTclGraphBuilder';
import {
  bracketWords,
  dictEntries,
  isBracketed,
  parseOptions,
  type ParsedOptions,
  type Word,
} from './bdTclWords';

/** What a command handler needs from the interpreter. */
export interface CommandEnv {
  builder: SystemGraphBuilder;
  /** Current BD instance (a level path). */
  current: string;
  line: number;
  /** Variables of the running frame, for `$var` substitution inside list words. */
  vars: ReadonlyMap<string, string>;
  /** Set while a `create_hier_cell_*` proc runs: where the hierarchy was instantiated. */
  hierSite?: { callLine: number; procLine: number };
  /** Evaluates a word (variables, bracketed sub-commands) to its string value. */
  argValue: (word: Word) => string;
}

const CELL_FLAGS = new Set(['-type', '-vlnv', '-reference', '-dict']);
const PIN_FLAGS = new Set(['-dir', '-type', '-from', '-to', '-mode', '-vlnv', '-freq_hz']);
const NET_FLAGS = new Set(['-net', '-intf_net', '-boundary_type']);
const ADDR_FLAGS = new Set(['-offset', '-range', '-target_address_space', '-dict']);
export const SIGNAL_TYPES: readonly string[] = ['clk', 'rst', 'intr', 'data', 'ce', 'undef'];
const UNRESOLVABLE_FLAGS = ['-filter', '-of_objects', '-hier'];

function flagValue(env: CommandEnv, opts: ParsedOptions, name: string): string | undefined {
  const word = opts.flags.get(name);
  return word ? env.argValue(word) : undefined;
}

export function createCell(env: CommandEnv, words: readonly Word[]): string | undefined {
  const opts = parseOptions(words.slice(1), CELL_FLAGS);
  const nameWord = opts.positional.at(-1);
  if (!nameWord) {
    return undefined;
  }
  const vlnv = flagValue(env, opts, '-vlnv');
  const moduleRef = flagValue(env, opts, '-reference');
  const type = flagValue(env, opts, '-type') ?? (vlnv ? 'ip' : undefined);
  if (type !== 'ip' && type !== 'hier' && type !== 'module') {
    env.builder.report('warning', `Unknown cell type: ${type ?? 'none'}`, env.line);
    return undefined;
  }
  const site = type === 'hier' ? env.hierSite : undefined;
  return env.builder.addInstance({
    parent: env.current,
    name: env.argValue(nameWord),
    kind: type,
    ...(type === 'ip' && vlnv !== undefined && { vlnv }),
    ...(type === 'module' && moduleRef !== undefined && { moduleRef }),
    line: site?.callLine ?? env.line,
    ...(site && { procLine: site.procLine }),
  });
}

export const INTERFACE_MODES: Record<string, PinDirection> = {
  Master: 'master',
  Slave: 'slave',
  MirroredMaster: 'slave',
  MirroredSlave: 'master',
};
export const SCALAR_DIRECTIONS: Record<string, PinDirection> = { I: 'in', O: 'out', IO: 'inout' };

/**
 * `create_bd_(intf_)port` (root boundary) and `create_bd_(intf_)pin` (current
 * level boundary). Returns the created pin's path. The `-freq_hz` flag, which
 * Vivado writes in exported scripts, is stored as `CONFIG.FREQ_HZ`; a later
 * `set_property` on the pin overrides it.
 */
export function createBoundaryPin(
  env: CommandEnv,
  words: readonly Word[],
  kind: { isInterface: boolean; isPort: boolean }
): string | undefined {
  const opts = parseOptions(words.slice(1), PIN_FLAGS);
  const nameWord = opts.positional.at(-1);
  if (!nameWord) {
    return undefined;
  }
  const spec: PinSpec = {
    name: env.argValue(nameWord),
    isInterface: kind.isInterface,
    direction: 'unknown',
    directionSource: 'declared',
    line: env.line,
  };
  if (kind.isInterface) {
    spec.direction = INTERFACE_MODES[flagValue(env, opts, '-mode') ?? ''] ?? 'unknown';
    spec.vlnv = flagValue(env, opts, '-vlnv');
  } else {
    spec.direction = SCALAR_DIRECTIONS[flagValue(env, opts, '-dir') ?? ''] ?? 'unknown';
    const type = flagValue(env, opts, '-type');
    if (type && SIGNAL_TYPES.includes(type)) {
      spec.signalType = type as SignalType;
    }
    const from = Number(flagValue(env, opts, '-from'));
    const to = Number(flagValue(env, opts, '-to'));
    if (opts.flags.has('-from') && opts.flags.has('-to') && !isNaN(from) && !isNaN(to)) {
      spec.width = { from, to };
    }
  }
  if (spec.direction === 'unknown') {
    spec.directionSource = 'unknown';
  }
  const frequency = flagValue(env, opts, '-freq_hz');
  if (frequency !== undefined) {
    spec.parameters = { 'CONFIG.FREQ_HZ': frequency };
  }
  return env.builder.addBoundaryPin(kind.isPort ? '/' : env.current, spec);
}

/** `inst/pin` (or deeper / absolute) names an instance pin; a bare name is a boundary pin. */
function splitPinName(env: CommandEnv, name: string): PinRef {
  const slash = name.lastIndexOf('/');
  if (slash < 0) {
    return { instance: null, pin: name };
  }
  const dir = name.slice(0, slash);
  return { instance: dir === '' ? null : joinPath(env.current, dir), pin: name.slice(slash + 1) };
}

function getterTarget(env: CommandEnv, word: Word): ParameterTarget | undefined {
  const [cmd, ...args] = bracketWords(word);
  const name = args.length > 0 ? env.argValue(args[args.length - 1]) : '';
  switch (cmd?.text) {
    case 'get_bd_cells':
      return { owner: joinPath(env.current, name) };
    case 'get_bd_ports':
    case 'get_bd_intf_ports':
      return { owner: '/', pin: lastComponent(name) };
    case 'get_bd_pins':
    case 'get_bd_intf_pins': {
      const ref = splitPinName(env, name);
      return { owner: ref.instance ?? env.current, pin: ref.pin };
    }
    default:
      return undefined;
  }
}

/** `set_property -dict [list K V ...] TARGET` and `set_property K V TARGET`. */
export function setProperty(env: CommandEnv, words: readonly Word[]): void {
  const rest = words.slice(1).filter((w) => w.text !== '-quiet' && w.text !== '-verbose');
  const dictIdx = rest.findIndex((w) => w.text === '-dict');
  const target = rest.at(-1);
  if (!target) {
    return;
  }
  let entries: [string, string][];
  if (dictIdx >= 0 && rest[dictIdx + 1]) {
    entries = dictEntries(rest[dictIdx + 1], env.vars);
  } else if (rest.length >= 3) {
    entries = [[env.argValue(rest[0]), env.argValue(rest[1])]];
  } else {
    return;
  }
  let resolved: ParameterTarget | undefined;
  if (isBracketed(target)) {
    resolved = getterTarget(env, target);
  } else {
    const path = env.argValue(target);
    resolved = env.builder.hasInstance(path)
      ? { owner: path }
      : { owner: parentPath(path), pin: lastComponent(path) };
  }
  if (resolved) {
    env.builder.setParameters(resolved, entries);
  }
}

function warnUnresolvable(env: CommandEnv, cmd: string, reason: string): void {
  env.builder.report('warning', `Cannot be resolved offline: ${cmd} ${reason}`, env.line);
}

/** Resolves one `[get_bd_(intf_)(pins|ports) A B ...]` word to endpoints. */
function resolveGetter(env: CommandEnv, word: Word): PinRef[] {
  const [cmd, ...args] = bracketWords(word);
  const getter = cmd?.text ?? '';
  if (!/^get_bd_(?:intf_)?(?:pins|ports)$/.test(getter)) {
    return [];
  }
  const refs: PinRef[] = [];
  for (let i = 0; i < args.length; i++) {
    const text = args[i].text;
    if (UNRESOLVABLE_FLAGS.includes(text)) {
      warnUnresolvable(env, getter, text);
      i += text === '-hier' ? 0 : 1;
      continue;
    }
    if (text.startsWith('-')) {
      continue;
    }
    const name = env.argValue(args[i]);
    if (/[*?]/.test(name)) {
      warnUnresolvable(env, getter, 'with a wildcard');
      continue;
    }
    if (name !== '') {
      refs.push(splitPinName(env, name));
    }
  }
  return refs;
}

/** `connect_bd_intf_net` / `connect_bd_net`. */
export function connectNet(env: CommandEnv, words: readonly Word[], isInterface: boolean): void {
  const opts = parseOptions(words.slice(1), NET_FLAGS);
  const refs: PinRef[] = [];
  for (const w of opts.positional) {
    if (isBracketed(w)) {
      refs.push(...resolveGetter(env, w));
    }
  }
  const netWord = opts.flags.get(isInterface ? '-intf_net' : '-net');
  let name: string | undefined;
  if (netWord) {
    name = isBracketed(netWord) ? lastWord(env, netWord) : env.argValue(netWord);
  }
  env.builder.connect(env.current, name === '' ? undefined : name, isInterface, refs, env.line);
}

function lastWord(env: CommandEnv, bracket: Word): string {
  const inner = bracketWords(bracket);
  return inner.length > 1 ? env.argValue(inner[inner.length - 1]) : '';
}

function stripSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function owner(env: CommandEnv, path: string, dropLast: number): string {
  const parts = stripSlashes(path).split('/').filter(Boolean);
  return parts.length > dropLast
    ? joinPath(env.current, parts.slice(0, parts.length - dropLast).join('/'))
    : '';
}

/** `assign_bd_address` and the older `create_bd_addr_seg`. */
export function assignAddress(env: CommandEnv, words: readonly Word[]): void {
  const opts = parseOptions(words.slice(1), ADDR_FLAGS);
  const getters = new Map<string, string>();
  const candidates: (Word | null)[] = [...opts.positional, ...opts.flags.values()];
  for (const w of candidates) {
    if (w && isBracketed(w)) {
      const [cmd, ...args] = bracketWords(w);
      if (cmd && args.length > 0) {
        getters.set(cmd.text, env.argValue(args[args.length - 1]));
      }
    }
  }
  const segment = getters.get('get_bd_addr_segs');
  if (segment === undefined) {
    return;
  }
  const addressSpace = getters.get('get_bd_addr_spaces') ?? '';
  const offset = flagValue(env, opts, '-offset');
  const range = flagValue(env, opts, '-range');
  env.builder.addAddressSegment({
    addressSpace,
    segment,
    masterInstance: owner(env, addressSpace, 1),
    slaveInstance: owner(env, segment, 2),
    ...(offset !== undefined && { offset }),
    ...(range !== undefined && { range }),
    line: env.line,
  });
}
