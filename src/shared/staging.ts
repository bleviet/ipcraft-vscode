/**
 * Staging types and pure presentation helpers shared by the extension host and the webviews.
 */

/** What to do with one modified file when the user confirms staging. */
export type StagingAction = 'overwrite' | 'keep' | 'auto-merge' | 'sync-interface';

/** Entity/module interface differences, on-disk vs generated (port/generic names). */
export interface InterfaceDrift {
  added: string[];
  removed: string[];
  changed: string[];
}

export const STAGING_ACTIONS: readonly StagingAction[] = [
  'auto-merge',
  'sync-interface',
  'overwrite',
  'keep',
];

export const STAGING_ACTION_LABELS: Record<StagingAction, string> = {
  'auto-merge': 'Auto-merge',
  'sync-interface': 'Sync interface',
  overwrite: 'Overwrite',
  keep: 'Keep',
};

/** Tooltip per action, shared by both staging UIs. */
export const STAGING_ACTION_DESCRIPTIONS: Record<StagingAction, string> = {
  'auto-merge':
    'Merge the regenerated file into your edited copy, keeping both your edits and the generator changes',
  'sync-interface':
    'Replace only the entity/module port and generic declarations; leave the architecture body unchanged',
  overwrite: 'Replace the file with the regenerated version, discarding your edits',
  keep: 'Leave the file on disk unchanged; the regenerated version is not written',
};

export const SYNC_INTERFACE_HINT = 'Entity updated; connect new ports in the architecture';

/** Orders a file's offered actions as shown in both staging UIs. */
export function orderStagingActions(actions: readonly StagingAction[]): StagingAction[] {
  return STAGING_ACTIONS.filter((a) => actions.includes(a));
}

/** Badge text ("+N/-M/~K") and tooltip (names per group) for an interface drift. */
export function describeInterfaceDrift(drift: InterfaceDrift): { summary: string; title: string } {
  const groups: [string, string[]][] = [
    ['Added', drift.added],
    ['Removed', drift.removed],
    ['Changed', drift.changed],
  ];
  return {
    summary: `+${drift.added.length}/-${drift.removed.length}/~${drift.changed.length}`,
    title: groups
      .filter(([, names]) => names.length > 0)
      .map(([label, names]) => `${label}: ${names.join(', ')}`)
      .join('\n'),
  };
}

/** Validates a webview-supplied action map: only known action strings are kept. */
export function parseStagingActions(raw: unknown): Record<string, StagingAction> {
  const result: Record<string, StagingAction> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [relativePath, action] of Object.entries(raw)) {
      if (STAGING_ACTIONS.includes(action as StagingAction)) {
        result[relativePath] = action as StagingAction;
      }
    }
  }
  return result;
}

/**
 * Banner shown when every modified file is set to Keep (so Apply would change nothing but
 * new files). `actionOf` returns a file's chosen action, or undefined for a file handled
 * elsewhere (e.g. opened in the merge editor), which never counts as kept.
 */
export function allKeptBanner<T extends { status: string; protected: boolean }>(
  files: readonly T[],
  actionOf: (file: T) => StagingAction | undefined
): string | undefined {
  const modified = files.filter((f) => f.status === 'modified');
  const hasNew = files.some((f) => f.status === 'new');
  if (hasNew || modified.length === 0 || !modified.every((f) => actionOf(f) === 'keep')) {
    return undefined;
  }
  const lockedNote = modified.some((f) => f.protected)
    ? ' (locked managed: false files default to Keep)'
    : '';
  return `${modified.length} modified file(s) are set to Keep${lockedNote} — choose Auto-merge, Sync interface or Overwrite on a file to include it in Apply.`;
}
