/**
 * Pure diagnostics for `$version` references in a memory map: whether each reference fits the
 * owning core's version scheme and its target, whether the map has one version register, and
 * whether that register changed since a recorded version.
 */
import type {
  NormalizedAddressBlock,
  NormalizedField,
  NormalizedRegister,
} from '../../domain/internal.types';
import { versionRegisterChanges, type VersionRegisterChange } from './versionHistory';
import type { VersionHistory } from './versionHistoryTypes';
import {
  schemeComponents,
  versionRefCrc,
  versionRefWidth,
  type VersionRef,
  type VersionScheme,
} from './versionScheme';

export interface VersionRefIssue {
  severity: 'error' | 'warning';
  /**
   * Stable identifier of the rule that produced the issue (`versionRef.scheme`,
   * `versionRef.component`, `versionRef.width`, `versionRef.registerFields`, `versionRef.array`,
   * `versionRef.multiple`, `versionRef.access`, `versionRef.history.<kind>:<version>`,
   * `versionRef.invalidVersion`). Together with `path` it identifies the issue, so a rule's
   * issues on different registers, and different rules on one path, never collapse.
   */
  code: string;
  /** Path into the normalized memory map, e.g. ['addressBlocks', 0, 'registers', 2, 'fields', 1]. */
  path: Array<string | number>;
  message: string;
}

/** The recorded history to compare against; `parseSnapshot` is injected like in `versionHistory.ts`. */
export interface VersionRefHistory {
  value: VersionHistory;
  parseSnapshot: (blocks: unknown[]) => NormalizedAddressBlock[];
}

type IssuePath = Array<string | number>;

interface VersionRegisterSite {
  block: NormalizedAddressBlock;
  register: NormalizedRegister;
  path: IssuePath;
}

const isArrayRegister = (register: NormalizedRegister): boolean =>
  register.__kind === 'array' || register.count !== undefined;

/**
 * True when the register, one of its fields, or any register nested in it (register arrays, at
 * any depth) holds a `$version` reference. The single "does this use `$version`" predicate.
 */
export const registerHasVersionRef = (register: NormalizedRegister): boolean =>
  Boolean(register.versionRef) ||
  register.fields.some((field) => Boolean(field.versionRef)) ||
  (register.registers ?? []).some(registerHasVersionRef);

/** True when any register of any address block of `blocks` holds a `$version` reference. */
export const blocksHaveVersionRef = (blocks: readonly NormalizedAddressBlock[]): boolean =>
  blocks.some((block) => block.registers.some(registerHasVersionRef));

const keyOf = (site: VersionRegisterSite): string => `${site.block.name}.${site.register.name}`;

function validRefs(scheme: VersionScheme): string {
  return [
    '$version',
    ...schemeComponents(scheme).map((name) => `$version.${name}`),
    '$version.crc8',
    '$version.crc16',
  ].join(', ');
}

/** Scheme rules for one reference: E1, E2 and the width part of E3. `size` is the target's bits. */
function checkRefAgainstScheme(
  scheme: VersionScheme,
  ref: VersionRef,
  target: { kind: 'field' | 'register'; size: number },
  path: IssuePath
): VersionRefIssue[] {
  if (scheme === 'free' && !versionRefCrc(ref)) {
    return [
      {
        severity: 'error',
        code: 'versionRef.scheme',
        path,
        message:
          'Version references need a numeric version scheme (set vlnv.versionScheme in the owning .ip.yml); only $version.crc8 and $version.crc16 work with a free version',
      },
    ];
  }
  const width = versionRefWidth(scheme, ref);
  if (width === null) {
    return [
      {
        severity: 'error',
        code: 'versionRef.component',
        path,
        message: `${ref} is not available in version scheme ${scheme}; valid references: ${validRefs(scheme)}`,
      },
    ];
  }
  const fits = target.kind === 'field' ? target.size === width : target.size >= width;
  return fits
    ? []
    : [
        {
          severity: 'error',
          code: 'versionRef.width',
          path,
          message: `${ref} needs ${width} bits, ${target.kind} is ${target.size}`,
        },
      ];
}

function checkField(
  scheme: VersionScheme | null,
  field: NormalizedField,
  path: IssuePath
): VersionRefIssue[] {
  if (!field.versionRef) {
    return [];
  }
  const issues =
    scheme === null
      ? []
      : checkRefAgainstScheme(scheme, field.versionRef, { kind: 'field', size: field.width }, path);
  if (field.access !== undefined && field.access !== 'read-only') {
    issues.push({
      severity: 'warning',
      code: 'versionRef.access',
      path,
      message: 'Access is ignored: $version fields are generated as read-only constants',
    });
  }
  return issues;
}

function checkRegister(
  scheme: VersionScheme | null,
  register: NormalizedRegister,
  path: IssuePath
): VersionRefIssue[] {
  const issues: VersionRefIssue[] = [];
  if (register.versionRef) {
    if (register.fields.length > 0) {
      issues.push({
        severity: 'error',
        code: 'versionRef.registerFields',
        path,
        message: 'Use $version.* on the fields instead of a register-level $version reference',
      });
    } else if (scheme !== null) {
      issues.push(
        ...checkRefAgainstScheme(
          scheme,
          register.versionRef,
          { kind: 'register', size: register.size },
          path
        )
      );
    }
  }
  register.fields.forEach((field, index) => {
    issues.push(...checkField(scheme, field, [...path, 'fields', index]));
  });
  return issues;
}

/** E5: every reference anywhere inside a register array (the array's own and its nested ones). */
function checkArray(register: NormalizedRegister, path: IssuePath): VersionRefIssue[] {
  const issues: VersionRefIssue[] = [];
  const message = 'Version references are not supported in register arrays';
  const issue = { severity: 'error', code: 'versionRef.array', message } as const;
  if (register.versionRef) {
    issues.push({ ...issue, path });
  }
  register.fields.forEach((field, index) => {
    if (field.versionRef) {
      issues.push({ ...issue, path: [...path, 'fields', index] });
    }
  });
  (register.registers ?? []).forEach((nested, index) => {
    issues.push(...checkArray(nested, [...path, 'registers', index]));
  });
  return issues;
}

function checkSingleVersionRegister(sites: VersionRegisterSite[]): VersionRefIssue[] {
  if (sites.length < 2) {
    return [];
  }
  return sites.map((site) => ({
    severity: 'error',
    code: 'versionRef.multiple',
    path: site.path,
    message: `Only one version register per memory map (also: ${sites
      .filter((other) => other !== site)
      .map(keyOf)
      .join(', ')})`,
  }));
}

function describeChange(change: VersionRegisterChange, hasCurrent: boolean): string {
  switch (change.kind) {
    case 'address':
      return `${change.detail} since version ${change.version}: drivers built for that version cannot read the version`;
    case 'layout':
      return `Version field layout changed since version ${change.version}. ${change.detail}`;
    case 'missing':
      return hasCurrent
        ? `${change.detail} (it was in version ${change.version}): drivers built for that version cannot read the version`
        : `No version register, but version ${change.version} had one`;
    case 'added':
      return `Version ${change.version} has no version register (and neither do versions sharing its register set); a driver cannot identify them`;
  }
}

/** W2. A change is reported on the current register it names, or on the map root if it is gone. */
function checkHistory(
  history: VersionRefHistory,
  blocks: NormalizedAddressBlock[],
  sites: VersionRegisterSite[]
): VersionRefIssue[] {
  return versionRegisterChanges(history.value, blocks, history.parseSnapshot).map((change) => {
    const site =
      change.kind === 'missing'
        ? undefined
        : sites.find((candidate) =>
            change.detail.startsWith(`Version register ${keyOf(candidate)} `)
          );
    return {
      severity: 'warning',
      code: `versionRef.history.${change.kind}:${change.version}`,
      path: site?.path ?? [],
      message: describeChange(change, sites.length > 0),
    };
  });
}

/**
 * Checks every `$version` reference in `blocks`. `scheme` is the owning core's scheme, or null when
 * no core is known (the scheme-dependent rules are then skipped). `history` adds the
 * stability warnings against recorded versions.
 */
export function validateVersionRefs(
  blocks: NormalizedAddressBlock[],
  scheme: VersionScheme | null,
  history?: VersionRefHistory
): VersionRefIssue[] {
  const issues: VersionRefIssue[] = [];
  const sites: VersionRegisterSite[] = [];

  blocks.forEach((block, blockIndex) => {
    block.registers.forEach((register, registerIndex) => {
      const path: IssuePath = ['addressBlocks', blockIndex, 'registers', registerIndex];
      if (isArrayRegister(register)) {
        issues.push(...checkArray(register, path));
        return;
      }
      if (registerHasVersionRef(register)) {
        sites.push({ block, register, path });
      }
      issues.push(...checkRegister(scheme, register, path));
    });
  });

  issues.push(...checkSingleVersionRegister(sites));
  if (history) {
    issues.push(...checkHistory(history, blocks, sites));
  }
  return issues;
}
