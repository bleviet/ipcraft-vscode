import React from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import type { VersionRefIssue } from '../../../shared/versioning/validateVersionRefs';
import { useDebugMode } from '../../hooks/useDebugMode';
import { useVersionContext } from '../../hooks/useVersionContext';
import { getFieldBitWidth, resolveResetInput } from '../../shared/utils/fieldValidation';
import { versionRefHint } from '../../shared/utils/versionRefDisplay';
import { EditableCell, CellInput } from '../../shared/components';
import { VersionIssueList } from '../../shared/components/VersionIssueList';
import type { FieldDef } from './FieldsTable';

interface ResetCellProps {
  field: FieldDef;
  /** Index of the field in its register; the `onUpdate` path is `['fields', index, 'resetValue']`. */
  index: number;
  isActive: boolean;
  isEditing: boolean;
  /** Text shown in the input (the draft, or the committed reset value or `$version` token). */
  value: string;
  error: string | null;
  /** `$version` diagnostics for this field. */
  issues?: readonly VersionRefIssue[];
  cancelEditRef?: React.MutableRefObject<boolean>;
  onCellClick: (e: React.MouseEvent<HTMLElement>) => void;
  onFocus: () => void;
  onDraftChange: (raw: string) => void;
  onErrorChange: (error: string | null) => void;
  onUpdate: YamlUpdateHandler;
}

/**
 * The Reset column cell of a bit-field row: commits a valid number or `$version` reference on
 * every keystroke, shows the resolved value under a reference, and lists its diagnostics.
 */
const ResetCell = ({
  field,
  index,
  isActive,
  isEditing,
  value,
  error,
  issues,
  cancelEditRef,
  onCellClick,
  onFocus,
  onDraftChange,
  onErrorChange,
  onUpdate,
}: ResetCellProps) => {
  const { debugMode } = useDebugMode();
  const versionContext = useVersionContext();
  const hint = field.versionRef
    ? versionRefHint(versionContext, field.versionRef, getFieldBitWidth(field))
    : null;

  return (
    <EditableCell
      columnKey="reset"
      isActive={isActive}
      onCellClick={onCellClick}
      className="px-4 py-2 font-mono vscode-muted"
    >
      <div className="flex flex-col justify-center h-10">
        <CellInput
          editKey="reset"
          className="w-full font-mono"
          isEditing={isEditing}
          value={value}
          onFocus={onFocus}
          cancelEditRef={cancelEditRef}
          onInput={(input) => {
            const raw = input ?? '';
            onDraftChange(raw);

            const outcome = resolveResetInput(raw, field, { debugMode, versionContext });
            onErrorChange(outcome.kind === 'error' ? outcome.message : null);
            if (outcome.kind === 'unchanged') {
              return;
            }
            if (outcome.kind === 'clear') {
              onUpdate(['fields', index, 'resetValue'], null);
            } else if (outcome.kind === 'commit') {
              onUpdate(['fields', index, 'resetValue'], outcome.value);
            }
          }}
        />
        {hint ? (
          <div className="text-xs vscode-muted mt-0.5" data-testid="version-ref-hint">
            {hint}
          </div>
        ) : null}
        {error ? <div className="text-xs vscode-error mt-1">{error}</div> : null}
      </div>
      <VersionIssueList issues={issues} className="mt-1" />
    </EditableCell>
  );
};

export default ResetCell;
