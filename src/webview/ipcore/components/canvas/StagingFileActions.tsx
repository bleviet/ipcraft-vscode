import React from 'react';
import {
  STAGING_ACTION_DESCRIPTIONS,
  STAGING_ACTION_LABELS,
  SYNC_INTERFACE_HINT,
  describeInterfaceDrift,
  orderStagingActions,
  type InterfaceDrift,
  type StagingAction,
} from '../../../../shared/staging';

/** Persistent "Hand-edited" and "Interface out of date" badges of a staged file. */
export const StagingFileBadges: React.FC<{
  handEdited?: boolean;
  interfaceDrift?: InterfaceDrift;
}> = ({ handEdited, interfaceDrift }) => {
  const drift = interfaceDrift ? describeInterfaceDrift(interfaceDrift) : undefined;
  return (
    <>
      {handEdited && (
        <span
          className="staging-badge-hand-edited"
          title="This file differs from what IPCraft last generated"
        >
          Hand-edited
        </span>
      )}
      {drift && (
        <span className="staging-badge-drift" title={drift.title}>
          Interface out of date: {drift.summary}
        </span>
      )}
    </>
  );
};

/**
 * Segmented per-file action choice of a modified file (Auto-merge, Sync
 * interface, Overwrite, Keep) plus the sync-interface hint. The chosen action
 * stays visible when the row is not hovered; the full choice appears on hover
 * like the other row actions.
 */
export const StagingFileActions: React.FC<{
  actions: StagingAction[];
  chosen: StagingAction;
  onSelect: (action: StagingAction) => void;
}> = ({ actions, chosen, onSelect }) => (
  <>
    <span className="staging-action-chosen">{STAGING_ACTION_LABELS[chosen]}</span>
    <span className="staging-btn-action staging-action-group" role="group" aria-label="Action">
      {orderStagingActions(actions).map((action) => (
        <button
          key={action}
          type="button"
          className={`staging-action-choice${action === chosen ? ' staging-action-choice--active' : ''}`}
          title={STAGING_ACTION_DESCRIPTIONS[action]}
          aria-pressed={action === chosen}
          onClick={() => onSelect(action)}
        >
          {STAGING_ACTION_LABELS[action]}
        </button>
      ))}
    </span>
    {chosen === 'sync-interface' && (
      <span className="staging-sync-hint">{SYNC_INTERFACE_HINT}</span>
    )}
  </>
);
