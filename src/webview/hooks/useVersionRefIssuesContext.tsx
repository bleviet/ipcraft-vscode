import React, { createContext, useContext } from 'react';
import type { NormalizedMemoryMap } from '../../domain/internal.types';
import type { VersionRefIssue } from '../../shared/versioning/validateVersionRefs';
import {
  useVersionRefIssues,
  type IndexedVersionRefIssues,
  type RegisterVersionIssues,
} from './useVersionRefIssues';
import { useVersionContext } from './useVersionContext';

const NO_ISSUES: IndexedVersionRefIssues = { root: [], registers: new Map() };
const NO_REGISTER_ISSUES: RegisterVersionIssues = { register: [], fields: new Map() };

const VersionRefIssuesContext = createContext<IndexedVersionRefIssues>(NO_ISSUES);

/**
 * Makes the `$version` diagnostics of `memoryMap` available to the editors below it. Must sit
 * inside `VersionContextProvider`.
 */
export function VersionRefIssuesProvider({
  memoryMap,
  children,
}: {
  memoryMap: NormalizedMemoryMap | null;
  children: React.ReactNode;
}) {
  const issues = useVersionRefIssues(memoryMap, useVersionContext());
  return (
    <VersionRefIssuesContext.Provider value={issues}>{children}</VersionRefIssuesContext.Provider>
  );
}

/**
 * The diagnostics of one register, matched by object identity with the normalized register in the
 * provider's map. Empty outside a provider or for an object that is not in the map.
 */
export function useRegisterVersionIssues(
  register: object | null | undefined
): RegisterVersionIssues {
  const { registers } = useContext(VersionRefIssuesContext);
  return (register ? registers.get(register) : undefined) ?? NO_REGISTER_ISSUES;
}

/** The diagnostics on the memory map itself (e.g. a missing version register). */
export function useMapVersionIssues(): VersionRefIssue[] {
  return useContext(VersionRefIssuesContext).root;
}
