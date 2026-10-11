import {
  STAGING_ACTION_DESCRIPTIONS,
  STAGING_ACTION_LABELS,
  SYNC_INTERFACE_HINT,
  describeInterfaceDrift,
  orderStagingActions,
  type InterfaceDrift,
  type StagingAction,
} from '../../shared/staging';
import { escHtml } from './FileTreeRenderer';

interface ActionFile {
  relativePath: string;
  handEdited?: boolean;
  interfaceDrift?: InterfaceDrift;
  actions: StagingAction[];
  defaultAction?: StagingAction;
}

/** "Hand-edited" and "Interface out of date" badges of the fallback staging panel. */
export function renderStagingBadges(f: ActionFile): string {
  const handEdited = f.handEdited
    ? `<span class="badge-hand-edited" title="This file differs from what IPCraft last generated">Hand-edited</span>`
    : '';
  let drift = '';
  if (f.interfaceDrift) {
    const d = describeInterfaceDrift(f.interfaceDrift);
    drift = `<span class="badge-drift" title="${escHtml(d.title)}">Interface out of date: ${escHtml(d.summary)}</span>`;
  }
  return handEdited + drift;
}

/**
 * Segmented per-file action choice of a modified file, seeded from its default
 * action, plus the (initially hidden unless chosen) sync-interface hint.
 * Clicks are handled by the panel's delegated script via `data-choice`.
 */
export function renderStagingActionChoice(f: ActionFile): string {
  const chosen = f.defaultAction ?? 'keep';
  const path = escHtml(f.relativePath);
  const buttons = orderStagingActions(f.actions)
    .map(
      (a) =>
        `<button class="choice${a === chosen ? ' choice-active' : ''}" data-choice="${a}" data-path="${path}" title="${escHtml(STAGING_ACTION_DESCRIPTIONS[a])}" aria-pressed="${a === chosen}">${STAGING_ACTION_LABELS[a]}</button>`
    )
    .join('');
  return (
    `<span class="chosen-tag" data-chosen-for="${path}">${STAGING_ACTION_LABELS[chosen]}</span>` +
    `<span class="btn-action action-group" role="group" aria-label="Action">${buttons}</span>` +
    `<span class="sync-hint" data-hint-for="${path}"${chosen === 'sync-interface' ? '' : ' hidden'}>${SYNC_INTERFACE_HINT}</span>`
  );
}

export const STAGING_ACTIONS_CSS = `
.chosen-tag{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:3px;color:var(--vscode-descriptionForeground);background:var(--vscode-button-secondaryBackground);white-space:nowrap}
.tree-row:hover .chosen-tag{display:none}
.action-group{border-radius:3px;overflow:hidden}
.choice{font-family:var(--vscode-font-family);font-size:11px;padding:2px 8px;border:none;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.choice:hover{background:var(--vscode-button-secondaryHoverBackground)}
.choice.choice-active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.sync-hint{flex-basis:100%;font-size:10px;color:var(--vscode-descriptionForeground)}
.sync-hint[hidden]{display:none}
.badge-hand-edited,.badge-drift{display:inline-flex;align-items:center;flex-shrink:0;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:600;white-space:nowrap;color:var(--vscode-charts-orange,#d18616);background:color-mix(in srgb,var(--vscode-charts-orange,#d18616) 16%,transparent);border:1px solid color-mix(in srgb,var(--vscode-charts-orange,#d18616) 30%,transparent)}
.badge-hand-edited{color:var(--vscode-charts-blue,#3794ff);background:color-mix(in srgb,var(--vscode-charts-blue,#3794ff) 16%,transparent);border-color:color-mix(in srgb,var(--vscode-charts-blue,#3794ff) 30%,transparent)}
`;
