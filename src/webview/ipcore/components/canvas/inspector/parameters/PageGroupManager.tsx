import React, { useMemo, useState } from 'react';
import type { IpCore } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import type { BatchUpdate } from '../../../../hooks/useGroupPorts';
import {
  applyBulkUpdate,
  computeParamGroups,
  computeParamPages,
  deleteGroup,
  deletePage,
  type Mutation,
  PlacementActions,
  renameGroup,
  renamePage,
} from './PlacementControls';

interface CreateEntityFormProps {
  label: string;
  placeholder: string;
  candidateParams: Array<{ index: number; name: string }>;
  onCreate: (name: string, indices: number[]) => void;
}

const CreateEntityForm: React.FC<CreateEntityFormProps> = ({
  label,
  placeholder,
  candidateParams,
  onCreate,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const reset = () => {
    setExpanded(false);
    setName('');
    setChecked(new Set());
  };

  if (!expanded) {
    return (
      <button type="button" className="ci-placement-manage__add" onClick={() => setExpanded(true)}>
        <span className="codicon codicon-add" style={{ fontSize: 11 }} />
        New {label}
      </button>
    );
  }

  const canCreate = name.trim().length > 0 && checked.size > 0;

  return (
    <div className="ci-placement-manage__form">
      <input
        autoFocus
        className="ci-placement-manage__form-input"
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="ci-placement-manage__form-hint">
        Assign to at least one parameter to create it:
      </div>
      <div className="ci-placement-manage__form-list">
        {candidateParams.length === 0 ? (
          <div className="ci-placement-manage__form-empty">No eligible parameters</div>
        ) : (
          candidateParams.map((p) => (
            <label className="ci-placement-manage__form-item" key={p.index}>
              <input
                type="checkbox"
                checked={checked.has(p.index)}
                onChange={(e) => {
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) {
                      next.add(p.index);
                    } else {
                      next.delete(p.index);
                    }
                    return next;
                  });
                }}
              />
              <span>{p.name}</span>
            </label>
          ))
        )}
      </div>
      <div className="ci-placement-manage__form-actions">
        <button
          type="button"
          className="ci-placement-manage__form-create"
          disabled={!canCreate}
          onClick={() => {
            onCreate(name.trim(), [...checked]);
            reset();
          }}
        >
          Create
        </button>
        <button type="button" className="ci-placement-manage__form-cancel" onClick={reset}>
          Cancel
        </button>
      </div>
    </div>
  );
};

interface PageGroupManagerProps {
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  batchUpdate?: BatchUpdate;
}

export const PageGroupManager: React.FC<PageGroupManagerProps> = ({
  ipCore,
  onUpdate,
  batchUpdate,
}) => {
  const params = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;
  const allPages = useMemo(() => computeParamPages(params), [params]);
  const [groupsPageChoice, setGroupsPageChoice] = useState('');
  const groupsPage = allPages.includes(groupsPageChoice) ? groupsPageChoice : (allPages[0] ?? '');
  const allGroups = useMemo(
    () => (groupsPage ? computeParamGroups(params, groupsPage) : []),
    [params, groupsPage]
  );

  const allParamOptions = params.map((p, index) => ({
    index,
    name: String(p.name ?? `(param ${index})`),
  }));
  const pageParamOptions = allParamOptions.filter(
    (p) => params[p.index].uiPage && String(params[p.index].uiPage) === groupsPage
  );

  return (
    <div className="ci-placement-manage">
      <div className="ci-placement-manage__col">
        <div className="ci-placement-manage__title">Pages</div>
        {allPages.length === 0 && <div className="ci-placement-manage__empty">No pages yet</div>}
        {allPages.map((page) => (
          <div className="ci-placement-manage__row" key={page}>
            <span className="ci-placement-manage__name" title={page}>
              {page}
            </span>
            <PlacementActions
              key={page}
              value={page}
              onRename={(oldName, newName) =>
                renamePage(params, oldName, newName, onUpdate, batchUpdate)
              }
              onDelete={(name) => deletePage(params, name, onUpdate, batchUpdate)}
              renameTitle="Rename this page (updates every parameter on it)"
              deleteTitle="Delete this page (clears it from every parameter on it)"
            />
          </div>
        ))}
        <CreateEntityForm
          label="page"
          placeholder="New page name…"
          candidateParams={allParamOptions}
          onCreate={(name, indices) => {
            const mutations: Mutation[] = indices.map((i) => [['parameters', i, 'uiPage'], name]);
            applyBulkUpdate(mutations, onUpdate, batchUpdate);
          }}
        />
      </div>

      <div className="ci-placement-manage__col">
        <div className="ci-placement-manage__title-row">
          <span className="ci-placement-manage__title">Groups</span>
          {allPages.length > 0 && (
            <select
              className="ci-placement-manage__page-picker"
              value={groupsPage}
              onChange={(e) => setGroupsPageChoice(e.target.value)}
              title="Page these groups belong to"
            >
              {allPages.map((page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ))}
            </select>
          )}
        </div>
        {allPages.length === 0 ? (
          <div className="ci-placement-manage__empty">Create a page first</div>
        ) : (
          <>
            {allGroups.length === 0 && (
              <div className="ci-placement-manage__empty">No groups yet on this page</div>
            )}
            {allGroups.map((group) => (
              <div className="ci-placement-manage__row" key={group}>
                <span className="ci-placement-manage__name" title={group}>
                  {group}
                </span>
                <PlacementActions
                  key={group}
                  value={group}
                  onRename={(oldName, newName) =>
                    renameGroup(params, groupsPage, oldName, newName, onUpdate, batchUpdate)
                  }
                  onDelete={(name) => deleteGroup(params, groupsPage, name, onUpdate, batchUpdate)}
                  renameTitle="Rename this group (updates every parameter in it)"
                  deleteTitle="Delete this group (clears it from every parameter in it)"
                />
              </div>
            ))}
            <CreateEntityForm
              label="group"
              placeholder="New group name…"
              candidateParams={pageParamOptions}
              onCreate={(name, indices) => {
                const mutations: Mutation[] = indices.map((i) => [
                  ['parameters', i, 'uiGroup'],
                  name,
                ]);
                applyBulkUpdate(mutations, onUpdate, batchUpdate);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
};
