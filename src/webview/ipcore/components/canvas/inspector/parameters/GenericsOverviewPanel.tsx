import React, { useMemo } from 'react';
import type { IpCore } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import type { BatchUpdate } from '../../../../hooks/useGroupPorts';
import { EmptyState, Section } from '../controls/InspectorFields';
import { computeParamGroups, computeParamPages, PlacementSelectField } from './PlacementControls';
import { PageGroupManager } from './PageGroupManager';

interface GenericsOverviewPanelProps {
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  batchUpdate?: BatchUpdate;
  onSelectElement?: (id: string) => void;
}

export const GenericsOverviewPanel: React.FC<GenericsOverviewPanelProps> = ({
  ipCore,
  onUpdate,
  batchUpdate,
  onSelectElement,
}) => {
  const params = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;

  const allPages = useMemo(() => computeParamPages(params), [params]);

  if (params.length === 0) {
    return <EmptyState label="No generics defined" />;
  }

  const handlePageChange = (index: number, v: string) => {
    onUpdate(['parameters', index, 'uiPage'], v || null);
    // clear group when page is cleared
    if (!v) {
      onUpdate(['parameters', index, 'uiGroup'], null);
    }
  };

  const handleGroupChange = (index: number, v: string) => {
    onUpdate(['parameters', index, 'uiGroup'], v || null);
  };

  return (
    <Section title="Generics">
      <div className="ci-placement-manage__section-title">Manage Pages &amp; Groups</div>
      <PageGroupManager ipCore={ipCore} onUpdate={onUpdate} batchUpdate={batchUpdate} />

      <div
        style={{
          fontSize: 11,
          color: 'var(--vscode-descriptionForeground)',
          marginBottom: 8,
          marginTop: 14,
        }}
      >
        Click a name to edit its value and constraints. Page/Group control where it appears in the
        Vivado / Platform Designer wizard.
      </div>
      <div className="ci-generics-header-row">
        <span className="ci-generics-header-row__name">Name</span>
        <span className="ci-generics-header-row__page">Page</span>
        <span className="ci-generics-header-row__group">Group</span>
      </div>
      {params.map((param, index) => {
        const name = String(param.name ?? '');
        const uiPage = param.uiPage ? String(param.uiPage) : '';
        const uiGroup = param.uiGroup ? String(param.uiGroup) : '';
        const allGroups = computeParamGroups(params, uiPage);

        return (
          <div className="ci-generics-row" key={index}>
            <button
              className="ci-generics-row__name"
              type="button"
              title={`Open ${name || 'parameter'}`}
              onClick={() => onSelectElement?.(`parameter:${index}`)}
            >
              {name || `(param ${index})`}
            </button>
            <div className="ci-generics-row__page">
              <PlacementSelectField
                value={uiPage}
                options={allPages}
                onChange={(v) => handlePageChange(index, v)}
                addTitle="New page"
                addPlaceholder="New page name…"
                selectStyle={{ flex: 1, minWidth: 0 }}
              />
            </div>
            <div className="ci-generics-row__group">
              {uiPage ? (
                <PlacementSelectField
                  value={uiGroup}
                  options={allGroups}
                  onChange={(v) => handleGroupChange(index, v)}
                  addTitle="New group"
                  addPlaceholder="New group name…"
                  selectStyle={{ flex: 1, minWidth: 0 }}
                />
              ) : (
                <span className="ci-generics-row__group-empty">—</span>
              )}
            </div>
          </div>
        );
      })}
    </Section>
  );
};
