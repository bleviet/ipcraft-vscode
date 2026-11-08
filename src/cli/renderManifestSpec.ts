/**
 * The `ipcraft render --manifest` file: parsing, and turning each image entry
 * into the argv of the equivalent `ipcraft render` call, so a manifest is
 * validated by the same rules and messages as the flags (see renderArgv.ts).
 * Pure.
 */

import * as path from 'path';
import * as yaml from 'yaml';
import { isIpCoreFile, renderOutputFormat } from './renderArgv';

type Entry = Record<string, unknown>;

export interface RenderManifest {
  defaults: Entry;
  images: Entry[];
}

const STRING_KEYS = ['source', 'out', 'level', 'theme', 'background'] as const;
const INTEGER_KEYS = ['hops', 'scale', 'quality'] as const;
const LIST_KEYS = ['expand', 'select', 'highlight'] as const;
const BOOLEAN_KEYS = ['clocks', 'grid', 'legend'] as const;
const KEYS: ReadonlySet<string> = new Set([
  ...STRING_KEYS,
  ...INTEGER_KEYS,
  ...LIST_KEYS,
  ...BOOLEAN_KEYS,
  'workspace',
]);
/** Options `ipcraft render` rejects for an `.ip.yml`. */
const SYSTEM_ONLY: ReadonlySet<string> = new Set([
  'level',
  'expand',
  'select',
  'hops',
  'highlight',
  'clocks',
  'legend',
  'workspace',
]);

const isMapping = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkKeys(entry: Entry, where: string): string | undefined {
  const unknown = Object.keys(entry).find((key) => !KEYS.has(key));
  return unknown === undefined
    ? undefined
    : `${where}unknown key '${unknown}'. Expected one of: ${[...KEYS].join(', ')}`;
}

/** Parses manifest text; the message names what is wrong with the file as a whole. */
export function parseManifest(text: string): RenderManifest | { error: string } {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (err) {
    return { error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isMapping(parsed)) {
    return { error: 'The manifest must be a mapping with an images list' };
  }
  const extra = Object.keys(parsed).find((key) => key !== 'defaults' && key !== 'images');
  if (extra !== undefined) {
    return { error: `Unknown manifest key '${extra}': expected 'defaults' and 'images'` };
  }
  const defaults = parsed.defaults ?? {};
  if (!isMapping(defaults)) {
    return { error: "'defaults' must be a mapping" };
  }
  const keyError = checkKeys(defaults, 'defaults: ');
  if (keyError) {
    return { error: keyError };
  }
  if ('source' in defaults || 'out' in defaults) {
    return { error: "defaults: 'out' and 'source' must be set on each image" };
  }
  if (!Array.isArray(parsed.images)) {
    return { error: "'images' must be a list of entries" };
  }
  if (parsed.images.length === 0) {
    return { error: 'no images to render' };
  }
  return { defaults, images: parsed.images as Entry[] };
}

/** The first output path that two entries share, or undefined. */
export function duplicateOutput(
  images: readonly unknown[],
  manifestDir: string
): string | undefined {
  const seen = new Set<string>();
  for (const image of images) {
    const out = isMapping(image) ? image.out : undefined;
    if (typeof out === 'string' && out !== '') {
      const resolved = path.resolve(manifestDir, out);
      if (seen.has(resolved)) {
        return resolved;
      }
      seen.add(resolved);
    }
  }
  return undefined;
}

/** The `--flag value` arguments for one key's value, or a message when the value has the wrong type. */
function optionArgs(key: string, value: unknown): string[] | string {
  const wrong = (expected: string) => `Invalid '${key}': expected ${expected}`;
  if ((STRING_KEYS as readonly string[]).includes(key)) {
    return typeof value === 'string' && value !== '' ? [`--${key}`, value] : wrong('a string');
  }
  if ((INTEGER_KEYS as readonly string[]).includes(key)) {
    return typeof value === 'number' || typeof value === 'string'
      ? [`--${key}`, String(value)]
      : wrong('an integer');
  }
  if ((LIST_KEYS as readonly string[]).includes(key)) {
    const names = Array.isArray(value) ? value : [value];
    return names.every((name) => typeof name === 'string' && name !== '')
      ? names.length === 0
        ? []
        : [`--${key}`, names.join(',')]
      : wrong('a name or a list of names');
  }
  if (typeof value !== 'boolean') {
    return wrong('true or false');
  }
  if (key === 'clocks') {
    return value ? ['--clocks'] : [];
  }
  return value ? [] : [`--no-${key}`];
}

/**
 * The `ipcraft render` argv for `entry` over `defaults`, paths resolved against `manifestDir`.
 * A default the entry cannot use (`scale` for an SVG, `legend` for an `.ip.yml`, ...) is skipped;
 * a key the entry itself sets is always passed on, to be checked like the flag.
 */
export function entryArgv(
  entry: unknown,
  defaults: Entry,
  manifestDir: string
): string[] | { error: string } {
  if (!isMapping(entry)) {
    return { error: 'expected a mapping' };
  }
  const keyError = checkKeys(entry, '');
  if (keyError) {
    return { error: keyError };
  }
  const { source, out } = { ...defaults, ...entry };
  if (typeof source !== 'string' || source === '') {
    return { error: "missing 'source'" };
  }
  if (typeof out !== 'string' || out === '') {
    return { error: "missing 'out'" };
  }
  const outPath = path.resolve(manifestDir, out);
  const format = renderOutputFormat(outPath);
  const isIp = isIpCoreFile(source);
  const merged: Entry = { ...defaults, ...entry };
  const usable = (key: string): boolean => {
    if (key in entry) {
      return true;
    }
    if (isIp && SYSTEM_ONLY.has(key)) {
      return false;
    }
    switch (key) {
      case 'scale':
        return format === 'png' || format === 'jpg';
      case 'quality':
        return format === 'jpg';
      case 'hops':
        return Array.isArray(merged.select) ? merged.select.length > 0 : Boolean(merged.select);
      case 'background':
        return !(format === 'jpg' && merged.background === 'transparent');
      default:
        return true;
    }
  };
  const argv = [path.resolve(manifestDir, source), '--out', outPath];
  for (const key of Object.keys(merged)) {
    if (key === 'source' || key === 'out' || !usable(key)) {
      continue;
    }
    const value = merged[key];
    if (key === 'workspace') {
      if (value === null || value === false) {
        argv.push('--no-workspace');
      } else if (typeof value === 'string' && value !== '') {
        argv.push('--workspace', path.resolve(manifestDir, value));
      } else {
        return { error: "Invalid 'workspace': expected a folder, or false for none" };
      }
      continue;
    }
    const args = optionArgs(key, value);
    if (typeof args === 'string') {
      return { error: args };
    }
    argv.push(...args);
  }
  return argv;
}
