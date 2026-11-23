import { useMemo } from 'react';
import type { NormalizedMemoryMap } from '../../domain/internal.types';
import { normalizeMemoryMap } from '../../domain/parse';
import {
  validateVersionRefs,
  type VersionRefIssue,
} from '../../shared/versioning/validateVersionRefs';
import type { VersionContext } from '../../shared/versioning/versionContext';

/** The `$version` diagnostics that belong to one register: its own and those of its fields. */
export interface RegisterVersionIssues {
  register: VersionRefIssue[];
  /** Keyed by the field's index in the register. */
  fields: Map<number, VersionRefIssue[]>;
}

export interface IndexedVersionRefIssues {
  /** Issues on the memory map itself (path `[]`, e.g. a missing version register). */
  root: VersionRefIssue[];
  /** Keyed by the identity of the normalized register object in the map. */
  registers: Map<object, RegisterVersionIssues>;
}

/** Normalizes raw history snapshot blocks with the same normalizer the editor parses documents with. */
const parseSnapshot = (blocks: unknown[]) =>
  normalizeMemoryMap({ addressBlocks: blocks }).addressBlocks;

/**
 * Diagnostics for every `$version` reference in `map`. The scheme-dependent rules run only when
 * the owning core's scheme is resolved.
 */
export function computeVersionRefIssues(
  map: NormalizedMemoryMap,
  context: VersionContext
): VersionRefIssue[] {
  const scheme = context.status === 'resolved' ? (context.versionScheme ?? null) : null;
  return validateVersionRefs(
    map.addressBlocks,
    scheme,
    map.versionHistory ? { value: map.versionHistory, parseSnapshot } : undefined
  );
}

/**
 * Attaches each issue to the register object its path names (or to the root for path `[]`). A path
 * ending in `fields/<n>` belongs to field `n` of the register before it.
 */
export function indexVersionRefIssues(
  map: NormalizedMemoryMap,
  issues: readonly VersionRefIssue[]
): IndexedVersionRefIssues {
  const root: VersionRefIssue[] = [];
  const registers = new Map<object, RegisterVersionIssues>();

  for (const issue of issues) {
    if (issue.path.length === 0) {
      root.push(issue);
      continue;
    }
    const last = issue.path[issue.path.length - 1];
    const fieldIndex =
      issue.path[issue.path.length - 2] === 'fields' && typeof last === 'number' ? last : null;
    const ownerPath = fieldIndex === null ? issue.path : issue.path.slice(0, -2);

    let node: unknown = map;
    for (const segment of ownerPath) {
      node = (node as Record<string | number, unknown> | undefined)?.[segment];
    }
    if (typeof node !== 'object' || node === null) {
      continue;
    }

    const entry: RegisterVersionIssues = registers.get(node) ?? { register: [], fields: new Map() };
    registers.set(node, entry);
    if (fieldIndex !== null) {
      entry.fields.set(fieldIndex, [...(entry.fields.get(fieldIndex) ?? []), issue]);
    } else {
      entry.register.push(issue);
    }
  }
  return { root, registers };
}

/** The `$version` diagnostics of a memory map under the given version context. */
export function useVersionRefIssues(
  map: NormalizedMemoryMap | null,
  context: VersionContext
): IndexedVersionRefIssues {
  return useMemo(
    () =>
      map
        ? indexVersionRefIssues(map, computeVersionRefIssues(map, context))
        : { root: [], registers: new Map() },
    [map, context]
  );
}
