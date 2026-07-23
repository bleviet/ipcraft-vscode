import React, { useMemo } from 'react';
import type { IpCore } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import { validateUniqueName, validateVhdlIdentifier } from '../../../../../shared/utils/validation';
import type { BatchUpdate } from '../../../../hooks/useGroupPorts';
import {
  PropCheckbox,
  PropField,
  PropSelect,
  PropTextArea,
  Section,
  TagInput,
} from '../controls/InspectorFields';
import {
  computeParamGroups,
  computeParamPages,
  deleteGroup,
  deletePage,
  renameGroup,
  renamePage,
  UiPlacementTree,
} from './PlacementControls';

const PARAM_TYPE_OPTS = [
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
  { value: 'string', label: 'string' },
];

interface ParameterPanelProps {
  param: Record<string, unknown>;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  batchUpdate?: BatchUpdate;
}

export const ParameterPanel: React.FC<ParameterPanelProps> = ({
  param,
  index,
  ipCore,
  onUpdate,
  batchUpdate,
}) => {
  const params = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;
  const existingNames = params.map((p) => String(p.name ?? '')).filter((_, i) => i !== index);

  const dataType = String(param.dataType ?? 'integer');
  const uiPage = param.uiPage ? String(param.uiPage) : '';
  const uiGroup = param.uiGroup ? String(param.uiGroup) : '';

  // All unique page names already used by other parameters in this IP core
  const allPages = useMemo(() => computeParamPages(params), [params]);

  // All unique group names already used by other parameters on the same page
  const allGroups = useMemo(() => computeParamGroups(params, uiPage), [params, uiPage]);

  const defVal =
    param.defaultValue !== undefined
      ? param.defaultValue
      : param.value !== undefined && typeof param.value !== 'object'
        ? param.value
        : '';

  const saveDefault = (v: string) => {
    if (dataType === 'integer') {
      const n = Number(v);
      onUpdate(['parameters', index, 'defaultValue'], Number.isFinite(n) ? n : v);
    } else if (dataType === 'boolean') {
      onUpdate(['parameters', index, 'defaultValue'], v === 'true' || v === '1');
    } else {
      onUpdate(['parameters', index, 'defaultValue'], v);
    }
  };

  const handleTypeChange = (newType: string) => {
    onUpdate(['parameters', index, 'dataType'], newType);

    // Clear constraints on type change
    onUpdate(['parameters', index, 'min'], null);
    onUpdate(['parameters', index, 'max'], null);
    onUpdate(['parameters', index, 'allowedValues'], null);

    // Apply clean default values
    if (newType === 'integer') {
      onUpdate(['parameters', index, 'defaultValue'], 0);
    } else if (newType === 'boolean') {
      onUpdate(['parameters', index, 'defaultValue'], false);
    } else {
      onUpdate(['parameters', index, 'defaultValue'], '');
    }
  };

  // Determine current constraint mode.
  // onUpdate(..., null) leaves the key in YAML as `null` (mergeNode mutates
  // the scalar in place rather than deleting it), so both null and undefined
  // must be treated as absent.
  let constraintMode = 'unrestricted';
  if (
    (param.min !== null && param.min !== undefined) ||
    (param.max !== null && param.max !== undefined)
  ) {
    constraintMode = 'range';
  } else if (param.allowedValues !== null && param.allowedValues !== undefined) {
    constraintMode = 'choices';
  }

  const handleConstraintModeChange = (mode: string) => {
    if (mode === 'unrestricted') {
      onUpdate(['parameters', index, 'min'], null);
      onUpdate(['parameters', index, 'max'], null);
      onUpdate(['parameters', index, 'allowedValues'], null);
    } else if (mode === 'range') {
      onUpdate(['parameters', index, 'allowedValues'], null);
      onUpdate(['parameters', index, 'min'], 0);
      onUpdate(['parameters', index, 'max'], 255);
    } else if (mode === 'choices') {
      onUpdate(['parameters', index, 'min'], null);
      onUpdate(['parameters', index, 'max'], null);
      onUpdate(['parameters', index, 'allowedValues'], []);
    }
  };

  const allowedValuesList = (
    Array.isArray(param.allowedValues) ? param.allowedValues : []
  ) as Array<string | number>;

  const isDefaultInvalid =
    constraintMode === 'choices' &&
    allowedValuesList.length > 0 &&
    !allowedValuesList.includes(dataType === 'integer' ? Number(defVal) : String(defVal));

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={String(param.name ?? '')}
          onSave={(v) => onUpdate(['parameters', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="DATA_WIDTH"
          mono
        />
        <PropField
          label="Display Name"
          value={param.displayName ? String(param.displayName) : ''}
          onSave={(v) => onUpdate(['parameters', index, 'displayName'], v === '' ? null : v)}
          placeholder={String(param.name ?? '')}
          hint="Shown in vendor tools (e.g. Vivado IP Packager). Defaults to the parameter name."
        />
        <PropSelect
          label="Data Type"
          value={dataType}
          options={PARAM_TYPE_OPTS}
          onSave={handleTypeChange}
        />
      </Section>

      <Section title="Value">
        {dataType === 'boolean' ? (
          <PropCheckbox
            label="Default Value (True)"
            checked={!!defVal}
            onChange={(v) => onUpdate(['parameters', index, 'defaultValue'], v)}
          />
        ) : (
          <PropField
            label="Default Value"
            value={String(defVal)}
            onSave={saveDefault}
            placeholder={dataType === 'integer' ? '32' : 'none'}
            mono
            hasError={isDefaultInvalid}
            errorMsg="Value must be one of the allowed choices"
          />
        )}
      </Section>

      {dataType !== 'boolean' && (
        <Section title="Constraints">
          <PropSelect
            label="Constraint Mode"
            value={constraintMode}
            options={
              dataType === 'integer'
                ? [
                    { value: 'unrestricted', label: 'Unrestricted' },
                    { value: 'range', label: 'Range (Min/Max)' },
                    { value: 'choices', label: 'Discrete Choices' },
                  ]
                : [
                    { value: 'unrestricted', label: 'Unrestricted' },
                    { value: 'choices', label: 'Discrete Choices' },
                  ]
            }
            onSave={handleConstraintModeChange}
          />
          {constraintMode === 'range' && dataType === 'integer' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <PropField
                  label="Minimum"
                  value={param.min !== undefined ? String(param.min) : ''}
                  onSave={(v) => onUpdate(['parameters', index, 'min'], v ? Number(v) : null)}
                  placeholder="0"
                  mono
                />
              </div>
              <div style={{ flex: 1 }}>
                <PropField
                  label="Maximum"
                  value={param.max !== undefined ? String(param.max) : ''}
                  onSave={(v) => onUpdate(['parameters', index, 'max'], v ? Number(v) : null)}
                  placeholder="255"
                  mono
                />
              </div>
            </div>
          )}
          {constraintMode === 'choices' && (
            <div style={{ marginTop: 10 }}>
              <TagInput
                label="Allowed Choices"
                values={allowedValuesList}
                isNumeric={dataType === 'integer'}
                onChange={(vals) => onUpdate(['parameters', index, 'allowedValues'], vals)}
              />
            </div>
          )}
        </Section>
      )}

      <Section title="Documentation">
        <PropTextArea
          label="Description"
          value={param.description ? String(param.description) : ''}
          onSave={(v) => onUpdate(['parameters', index, 'description'], v || null)}
          placeholder="Optional parameter description..."
        />
      </Section>

      <Section title="GUI Placement (Vendor XGUI)">
        <div
          style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 8 }}
        >
          Assign where this parameter appears in the Vivado / Platform Designer wizard.
        </div>
        <UiPlacementTree
          uiPage={uiPage}
          uiGroup={uiGroup}
          paramName={String(param.name ?? '')}
          allPages={allPages}
          allGroups={allGroups}
          onPageChange={(v) => {
            onUpdate(['parameters', index, 'uiPage'], v || null);
            // clear group when page is cleared
            if (!v) {
              onUpdate(['parameters', index, 'uiGroup'], null);
            }
          }}
          onGroupChange={(v) => onUpdate(['parameters', index, 'uiGroup'], v || null)}
          onRenamePage={(oldName, newName) =>
            renamePage(params, oldName, newName, onUpdate, batchUpdate)
          }
          onDeletePage={(name) => deletePage(params, name, onUpdate, batchUpdate)}
          onRenameGroup={(oldName, newName) =>
            renameGroup(params, uiPage, oldName, newName, onUpdate, batchUpdate)
          }
          onDeleteGroup={(name) => deleteGroup(params, uiPage, name, onUpdate, batchUpdate)}
        />
      </Section>
    </>
  );
};
