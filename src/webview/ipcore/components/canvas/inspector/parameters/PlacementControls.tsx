import React, { useState } from 'react';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import type { BatchUpdate } from '../../../../hooks/useGroupPorts';

// ─── GUI Placement helpers (shared by ParameterPanel + GenericsOverviewPanel) ──

/** All unique non-empty uiPage values already used by any parameter in this IP core. */
export function computeParamPages(params: Array<Record<string, unknown>>): string[] {
  return [...new Set(params.map((p) => (p.uiPage ? String(p.uiPage) : '')).filter(Boolean))].sort();
}

/** All unique non-empty uiGroup values already used by parameters on the given page. */
export function computeParamGroups(params: Array<Record<string, unknown>>, page: string): string[] {
  return [
    ...new Set(
      params
        .filter((p) => p.uiPage && String(p.uiPage) === page)
        .map((p) => (p.uiGroup ? String(p.uiGroup) : ''))
        .filter(Boolean)
    ),
  ].sort();
}

export type Mutation = [Array<string | number>, unknown];

/** Apply several parameter mutations as one atomic edit when possible, falling back to
 *  sequential single-path updates (e.g. in tests that don't pass a `batchUpdate` prop). */
export function applyBulkUpdate(
  mutations: Mutation[],
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  if (mutations.length === 0) {
    return;
  }
  if (batchUpdate) {
    batchUpdate(mutations);
  } else {
    mutations.forEach(([path, value]) => onUpdate(path, value));
  }
}

/** Rename a Page across every parameter that references it. */
export function renamePage(
  params: Array<Record<string, unknown>>,
  oldName: string,
  newName: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === oldName) {
      mutations.push([['parameters', i, 'uiPage'], newName]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

/** Delete a Page — clears uiPage (and uiGroup, which requires a page) on every parameter that used it. */
export function deletePage(
  params: Array<Record<string, unknown>>,
  name: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === name) {
      mutations.push([['parameters', i, 'uiPage'], null]);
      mutations.push([['parameters', i, 'uiGroup'], null]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

/** Rename a Group across every parameter that references it on the given page. */
export function renameGroup(
  params: Array<Record<string, unknown>>,
  page: string,
  oldName: string,
  newName: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === page && p.uiGroup && String(p.uiGroup) === oldName) {
      mutations.push([['parameters', i, 'uiGroup'], newName]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

/** Delete a Group — clears uiGroup on every parameter that used it on the given page. */
export function deleteGroup(
  params: Array<Record<string, unknown>>,
  page: string,
  name: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === page && p.uiGroup && String(p.uiGroup) === name) {
      mutations.push([['parameters', i, 'uiGroup'], null]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

const PLACEMENT_ADD_BTN_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 2px',
  color: 'var(--vscode-textLink-foreground)',
  fontSize: 14,
  lineHeight: 1,
};

const PLACEMENT_INLINE_INPUT_STYLE: React.CSSProperties = {
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-focusBorder)',
  borderRadius: 2,
  padding: '1px 4px',
  fontSize: 11,
  width: 120,
  outline: 'none',
};

interface PlacementSelectFieldProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  addTitle: string;
  addPlaceholder: string;
  selectStyle?: React.CSSProperties;
}

/**
 * A <select> over existing uiPage/uiGroup values plus an inline "⊕" affordance
 * to type a brand-new one. Shared by the single-parameter GUI Placement tree
 * (UiPlacementTree) and the Generics overview rows (GenericsOverviewPanel) so
 * both stay visually and behaviorally consistent.
 */
export const PlacementSelectField: React.FC<PlacementSelectFieldProps> = ({
  value,
  options,
  onChange,
  addTitle,
  addPlaceholder,
  selectStyle,
}) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (v) {
      onChange(v);
    }
    setDraft('');
    setAdding(false);
  };

  if (adding) {
    return (
      <input
        autoFocus
        style={PLACEMENT_INLINE_INPUT_STYLE}
        value={draft}
        placeholder={addPlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          }
          if (e.key === 'Escape') {
            setAdding(false);
            setDraft('');
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <>
      <select
        className="ci-field__select"
        style={selectStyle ?? { flex: 1 }}
        value={value}
        title={value || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button
        style={PLACEMENT_ADD_BTN_STYLE}
        title={addTitle}
        type="button"
        onClick={() => setAdding(true)}
      >
        ⊕
      </button>
    </>
  );
};

interface PlacementActionsProps {
  value: string;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
  renameTitle: string;
  deleteTitle: string;
}

/**
 * Rename/delete affordance for an existing Page or Group *name* (as opposed to
 * PlacementSelectField's "assign this parameter to a page/group" control). Renaming
 * or deleting rewrites every parameter that references the name — see renamePage/
 * deletePage/renameGroup/deleteGroup below.
 */
export const PlacementActions: React.FC<PlacementActionsProps> = ({
  value,
  onRename,
  onDelete,
  renameTitle,
  deleteTitle,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(value);

  if (renaming) {
    const commit = () => {
      const v = draft.trim();
      if (v && v !== value) {
        onRename(value, v);
      }
      setRenaming(false);
    };
    return (
      <input
        autoFocus
        style={PLACEMENT_INLINE_INPUT_STYLE}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          }
          if (e.key === 'Escape') {
            setRenaming(false);
            setDraft(value);
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <>
      <button
        style={PLACEMENT_ADD_BTN_STYLE}
        title={renameTitle}
        type="button"
        onClick={() => {
          setDraft(value);
          setRenaming(true);
        }}
      >
        <span className="codicon codicon-edit" style={{ fontSize: 12 }} />
      </button>
      <button
        style={PLACEMENT_ADD_BTN_STYLE}
        title={deleteTitle}
        type="button"
        onClick={() => onDelete(value)}
      >
        <span className="codicon codicon-trash" style={{ fontSize: 12 }} />
      </button>
    </>
  );
};

// ─── GUI Placement tree widget ────────────────────────────────────────────────

interface UiPlacementTreeProps {
  uiPage: string;
  uiGroup: string;
  paramName: string;
  allPages: string[];
  allGroups: string[];
  onPageChange: (v: string) => void;
  onGroupChange: (v: string) => void;
  onRenamePage: (oldName: string, newName: string) => void;
  onDeletePage: (name: string) => void;
  onRenameGroup: (oldName: string, newName: string) => void;
  onDeleteGroup: (name: string) => void;
}

export const UiPlacementTree: React.FC<UiPlacementTreeProps> = ({
  uiPage,
  uiGroup,
  paramName,
  allPages,
  allGroups,
  onPageChange,
  onGroupChange,
  onRenamePage,
  onDeletePage,
  onRenameGroup,
  onDeleteGroup,
}) => {
  const treeLineStyle: React.CSSProperties = {
    color: 'var(--vscode-editorLineNumber-foreground)',
    userSelect: 'none',
  };

  const leafStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    color: 'var(--vscode-foreground)',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 11,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  };

  return (
    <div style={{ paddingLeft: 2 }}>
      {/* Page row */}
      <div style={rowStyle}>
        <span style={{ ...treeLineStyle, minWidth: 40, fontSize: 11 }}>Page</span>
        <PlacementSelectField
          value={uiPage}
          options={allPages}
          onChange={onPageChange}
          addTitle="New page"
          addPlaceholder="New page name…"
        />
        {uiPage && (
          <PlacementActions
            key={uiPage}
            value={uiPage}
            onRename={onRenamePage}
            onDelete={onDeletePage}
            renameTitle="Rename this page (updates every parameter on it)"
            deleteTitle="Delete this page (clears it from every parameter on it)"
          />
        )}
      </div>

      {/* Tree connector + group row (only when page is set) */}
      {uiPage && (
        <>
          <div style={{ display: 'flex' }}>
            <div style={{ ...treeLineStyle, width: 40, fontSize: 11, paddingLeft: 8 }}>│</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            <div
              style={{
                ...treeLineStyle,
                width: 40,
                fontSize: 11,
                paddingLeft: 8,
                paddingTop: 4,
                flexShrink: 0,
              }}
            >
              └─
            </div>
            <div style={{ flex: 1 }}>
              <div style={rowStyle}>
                <span style={{ ...treeLineStyle, minWidth: 36, fontSize: 11 }}>Group</span>
                <PlacementSelectField
                  value={uiGroup}
                  options={allGroups}
                  onChange={onGroupChange}
                  addTitle="New group"
                  addPlaceholder="New group name…"
                />
                {uiGroup && (
                  <PlacementActions
                    key={uiGroup}
                    value={uiGroup}
                    onRename={onRenameGroup}
                    onDelete={onDeleteGroup}
                    renameTitle="Rename this group (updates every parameter in it)"
                    deleteTitle="Delete this group (clears it from every parameter in it)"
                  />
                )}
              </div>

              {/* Parameter leaf */}
              <div style={{ display: 'flex' }}>
                {uiGroup && (
                  <div
                    style={{
                      ...treeLineStyle,
                      width: 6,
                      fontSize: 11,
                      paddingTop: 2,
                      flexShrink: 0,
                    }}
                  >
                    │
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {uiGroup && (
                  <div
                    style={{
                      ...treeLineStyle,
                      width: 6,
                      fontSize: 11,
                      paddingTop: 2,
                      flexShrink: 0,
                      paddingRight: 4,
                    }}
                  >
                    └─
                  </div>
                )}
                <div style={leafStyle}>
                  <span
                    className="codicon codicon-symbol-variable"
                    style={{ fontSize: 11, opacity: 0.7 }}
                  />
                  <span>{paramName}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Leaf without page (floats to default) */}
      {!uiPage && (
        <div style={{ ...leafStyle, marginTop: 4, opacity: 0.5, fontSize: 11 }}>
          <span className="codicon codicon-symbol-variable" style={{ fontSize: 11 }} />
          <span>{paramName}</span>
          <span style={{ color: 'var(--vscode-descriptionForeground)' }}>(default page)</span>
        </div>
      )}
    </div>
  );
};
