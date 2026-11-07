/** Outline kind filters: which rows of the design outline a kind keeps. Pure. */

import type { SystemGraph } from '../../domain/systemGraph';

export type OutlineKind = 'all' | 'subsystems' | 'ip' | 'ports';

export const OUTLINE_KINDS: { kind: OutlineKind; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'subsystems', label: 'Subsystems' },
  { kind: 'ip', label: 'IP / RTL' },
  { kind: 'ports', label: 'Ports' },
];

export interface OutlineVisibility {
  /** Instance paths whose rows show; null: every instance. */
  instances: ReadonlySet<string> | null;
  /** The external ports show. */
  ports: boolean;
}

/**
 * Rows `kind` keeps: Subsystems are the hierarchy instances, IP / RTL the other
 * instances, Ports the external ports. Every match keeps the hierarchy rows
 * above it for context; other rows hide.
 */
export function outlineVisibility(graph: SystemGraph, kind: OutlineKind): OutlineVisibility {
  if (kind === 'all') {
    return { instances: null, ports: true };
  }
  if (kind === 'ports') {
    return { instances: new Set(), ports: true };
  }
  const instances = new Set<string>();
  for (const instance of Object.values(graph.instances)) {
    if ((instance.kind === 'hier') === (kind === 'subsystems')) {
      for (
        let path: string | undefined = instance.path;
        path !== undefined && path !== '/' && !instances.has(path);
        path = graph.instances[path]?.parent
      ) {
        instances.add(path);
      }
    }
  }
  return { instances, ports: false };
}
