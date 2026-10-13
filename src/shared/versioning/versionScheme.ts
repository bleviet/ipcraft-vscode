/**
 * Version schemes for `vlnv.version` and the `$version` register reference tokens.
 *
 * Pure and dependency free: shared by the extension host, the generator and the webview.
 */

export const VERSION_SCHEMES = [
  'free',
  'major.minor',
  'major.minor.patch',
  'major.feature.minor.patch',
] as const;

export type VersionScheme = (typeof VERSION_SCHEMES)[number];
export type VersionComponent = 'major' | 'feature' | 'minor' | 'patch';
export type VersionRef = '$version' | `$version.${VersionComponent}`;

const COMPONENT_BITS = 8;
const COMPONENT_MAX = 255;
const COMPONENT_PATTERN = /^(0|[1-9][0-9]*)$/;
const VERSION_REF_PATTERN = /^\$version(?:\.(major|feature|minor|patch))?$/;

const SCHEME_COMPONENTS: Record<VersionScheme, VersionComponent[]> = {
  free: [],
  'major.minor': ['major', 'minor'],
  'major.minor.patch': ['major', 'minor', 'patch'],
  'major.feature.minor.patch': ['major', 'feature', 'minor', 'patch'],
};

/** An absent or unknown scheme is `free`. */
export function parseVersionScheme(raw: unknown): VersionScheme {
  return VERSION_SCHEMES.find((scheme) => scheme === raw) ?? 'free';
}

/** The component names of a scheme, most significant first (`free` has none). */
export function schemeComponents(scheme: VersionScheme): VersionComponent[] {
  return [...SCHEME_COMPONENTS[scheme]];
}

function formatHint(scheme: VersionScheme): string {
  const names = SCHEME_COMPONENTS[scheme];
  const format = names.map((name) => name.toUpperCase()).join('.');
  const example = names.map((_, index) => (index === 0 ? '1' : '0')).join('.');
  return `Format: ${format}, each 0-${COMPONENT_MAX} (e.g. "${example}")`;
}

/** Returns an error message, or null when `text` is valid under `scheme`. */
export function validateVersion(scheme: VersionScheme, text: string): string | null {
  if (scheme === 'free') {
    return text.trim() === '' ? 'Required' : null;
  }
  const names = SCHEME_COMPONENTS[scheme];
  const parts = text.split('.');
  if (parts.length !== names.length) {
    return formatHint(scheme);
  }
  for (let index = 0; index < parts.length; index++) {
    if (!COMPONENT_PATTERN.test(parts[index])) {
      return formatHint(scheme);
    }
    if (Number(parts[index]) > COMPONENT_MAX) {
      return `Component '${names[index]}' must be 0-${COMPONENT_MAX}`;
    }
  }
  return null;
}

/** The numeric components of `text` under `scheme`, or null when invalid (always null for `free`). */
export function parseVersion(scheme: VersionScheme, text: string): number[] | null {
  if (scheme === 'free' || validateVersion(scheme, text) !== null) {
    return null;
  }
  return text.split('.').map(Number);
}

/** Packs components most significant first, 8 bit each. Arithmetic keeps 4 components unsigned. */
export function packVersion(components: number[]): number {
  return components.reduce((packed, component) => packed * 2 ** COMPONENT_BITS + component, 0);
}

/** The `$version` token a `resetValue` holds, or null for anything else. */
export function parseVersionRef(value: unknown): VersionRef | null {
  return typeof value === 'string' && VERSION_REF_PATTERN.test(value)
    ? (value as VersionRef)
    : null;
}

/** Bit width a ref needs under `scheme`, or null when the scheme has no such component. */
export function versionRefWidth(scheme: VersionScheme, ref: VersionRef): number | null {
  const names = SCHEME_COMPONENTS[scheme];
  if (names.length === 0) {
    return null;
  }
  if (ref === '$version') {
    return names.length * COMPONENT_BITS;
  }
  const component = ref.slice('$version.'.length) as VersionComponent;
  return names.includes(component) ? COMPONENT_BITS : null;
}

/** The number a ref stands for given the core version text, or null when it cannot be resolved. */
export function resolveVersionRef(
  scheme: VersionScheme,
  version: string,
  ref: VersionRef
): number | null {
  if (versionRefWidth(scheme, ref) === null) {
    return null;
  }
  const components = parseVersion(scheme, version);
  if (!components) {
    return null;
  }
  if (ref === '$version') {
    return packVersion(components);
  }
  const component = ref.slice('$version.'.length) as VersionComponent;
  return components[SCHEME_COMPONENTS[scheme].indexOf(component)];
}
