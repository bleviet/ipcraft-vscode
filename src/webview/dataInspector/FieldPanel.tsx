import React, {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { BitVector } from '../../dataInspector/BitVector';
import { decodeField, type InspectorField } from '../../dataInspector/fieldLayout';
import {
  compareExpected,
  decodeEnum,
  decodeFixedPoint,
  decodeFloat,
  decodeSigned,
  decodeUnsigned,
} from '../../dataInspector/numericDecode';
import type { VcdSample } from '../../dataInspector/vcd';
import type { IPCraftDataInspectorRecipe } from '../../domain/dataInspector.types';
import type { RegisterLayoutCopy } from '../../shared/messages/dataInspector';
import type { evaluateRecipe } from '../../dataInspector/evaluateRecipe';

function hexDisplayText(value: BitVector): string | null {
  const exactHex = value.toHex();
  if (exactHex !== null) {
    return `0x${exactHex}`;
  }
  const knownValue = value.toBigInt();
  return knownValue === null
    ? null
    : `0x${knownValue
        .toString(16)
        .toUpperCase()
        .padStart(Math.ceil(value.width / 4), '0')}`;
}

function interpretedText(
  value: BitVector,
  field: IPCraftDataInspectorRecipe['fields'][number] | undefined
): { text: string; comparison?: 'pass' | 'fail' | 'unknown' } {
  if (!field) {
    const hex = hexDisplayText(value);
    return { text: hex ? `hex ${hex}` : `binary ${value.toBinary()}` };
  }
  const interpretation = field.display.interpretation;
  let result;
  if (interpretation === 'unsigned') {
    result = decodeUnsigned(value);
  } else if (interpretation === 'signed') {
    result = decodeSigned(value);
  } else if (interpretation === 'enum') {
    result = decodeEnum(value, field.enumValues ?? {});
  } else if (interpretation === 'float') {
    result = decodeFloat(value);
  } else if (interpretation === 'fixedPoint') {
    result = decodeFixedPoint(value, field.display.fractionalBits ?? -1);
  } else if (interpretation === 'binary') {
    result = { status: 'ok' as const, text: value.toBinary() };
  } else {
    result = { status: 'ok' as const, text: hexDisplayText(value) ?? value.toBinary() };
  }
  return {
    text: result.text,
    comparison: field.display.expectedValue
      ? compareExpected(value, field.display.expectedValue)
      : undefined,
  };
}

interface FieldPanelProps {
  addField: () => void;
  copySelectedRegisterLayout: () => void;
  currentRecipe: IPCraftDataInspectorRecipe;
  displayVector: BitVector | null;
  draggedFieldId: string | null;
  evaluation: ReturnType<typeof evaluateRecipe>;
  fieldAnnouncement: string;
  fieldDragPointerRef: MutableRefObject<{ x: number; y: number }>;
  fieldPanelRef: RefObject<HTMLDivElement>;
  fields: InspectorField[];
  fieldSearch: string;
  filteredFields: InspectorField[];
  inspectorTab: 'properties' | 'fields' | 'capture';
  layoutErrors: string[];
  layoutId: string;
  layouts: RegisterLayoutCopy[];
  newGroupName: string;
  removeField: (fieldId: string) => void;
  selectedFieldId: string | null;
  setDraggedFieldId: Dispatch<SetStateAction<string | null>>;
  setFieldSearch: Dispatch<SetStateAction<string>>;
  setLayoutId: Dispatch<SetStateAction<string>>;
  setNewGroupName: Dispatch<SetStateAction<string>>;
  setRecipeBase: (recipe: IPCraftDataInspectorRecipe) => void;
  setSelectedFieldId: Dispatch<SetStateAction<string | null>>;
  updateSelectedField: (patch: Partial<InspectorField>) => void;
  updateSelectedFieldDisplay: (
    patch: Partial<IPCraftDataInspectorRecipe['fields'][number]['display']>
  ) => void;
  vcdSample: VcdSample | null;
}

export function FieldPanel({
  addField,
  copySelectedRegisterLayout,
  currentRecipe,
  displayVector,
  draggedFieldId,
  evaluation,
  fieldAnnouncement,
  fieldDragPointerRef,
  fieldPanelRef,
  fields,
  fieldSearch,
  filteredFields,
  inspectorTab,
  layoutErrors,
  layoutId,
  layouts,
  newGroupName,
  removeField,
  selectedFieldId,
  setDraggedFieldId,
  setFieldSearch,
  setLayoutId,
  setNewGroupName,
  setRecipeBase,
  setSelectedFieldId,
  updateSelectedField,
  updateSelectedFieldDisplay,
  vcdSample,
}: FieldPanelProps) {
  return (
    <div
      aria-labelledby="di-inspector-tab-fields"
      className={`di-inspector-panel di-fields ${inspectorTab === 'fields' ? 'is-active' : ''}`}
      id="di-inspector-panel-fields"
      ref={fieldPanelRef}
      role="tabpanel"
    >
      <header className="di-section-header">
        <div>
          <span className="di-eyebrow">Decoded ranges</span>
          <h2 id="fields-heading">Fields</h2>
        </div>
        <button onClick={addField}>Add field</button>
      </header>
      <details className="di-field-import">
        <summary>Import register layout</summary>
        <label>
          Register
          <select value={layoutId} onChange={(event) => setLayoutId(event.target.value)}>
            <option value="">Choose a register…</option>
            {layouts.map((layout) => (
              <option value={layout.id} key={layout.id}>
                {layout.label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!layoutId} onClick={copySelectedRegisterLayout}>
          Copy fields
        </button>
        <p className="di-note">One-way copy. The memory map is never modified or linked.</p>
      </details>
      <label className="di-search">
        <span className="codicon codicon-search" aria-hidden="true" />
        <span className="sr-only">Search fields</span>
        <input
          placeholder="Find field"
          value={fieldSearch}
          onChange={(event) => setFieldSearch(event.target.value)}
        />
      </label>
      {layoutErrors.map((layoutError) => (
        <div className="di-message is-error" key={layoutError}>
          {layoutError}
        </div>
      ))}
      <div className="di-field-table" role="table">
        <div className="di-field-row is-head" role="row">
          <span>Name</span>
          <span>Bits</span>
          <span>Raw</span>
          <span>Shown as</span>
        </div>
        {filteredFields.map((field) => {
          const definition = currentRecipe.fields.find((candidate) => candidate.id === field.id);
          const sourceVector = definition
            ? evaluation.values.get(definition.sourceId)?.value
            : displayVector;
          const valid =
            sourceVector !== undefined &&
            sourceVector !== null &&
            field.lsb >= 0 &&
            field.msb >= field.lsb &&
            field.msb < sourceVector.width;
          const value = valid && sourceVector ? decodeField(sourceVector, field) : null;
          const shown = value ? interpretedText(value, definition) : { text: 'invalid' };
          const raw = value?.toBinary() ?? 'invalid';
          const sourceName = currentRecipe.sources.find(
            (source) => source.id === definition?.sourceId
          )?.name;
          const changed = sourceName
            ? [...(vcdSample?.changedBits.get(sourceName) ?? [])].some(
                (bit) => bit >= field.lsb && bit <= field.msb
              )
            : false;
          return (
            <button
              className={`di-field-row ${selectedFieldId === field.id ? 'is-selected' : ''} ${changed ? 'is-changed' : ''} ${draggedFieldId === field.id ? 'is-dragging' : ''}`}
              draggable
              role="row"
              key={field.id}
              title="Select field. Press Delete or drag outside this panel to remove it."
              onClick={() => setSelectedFieldId(field.id)}
              onDragStart={(event) => {
                fieldDragPointerRef.current = { x: event.clientX, y: event.clientY };
                setDraggedFieldId(field.id);
                setSelectedFieldId(field.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDrag={(event) => {
                if (event.clientX !== 0 || event.clientY !== 0) {
                  fieldDragPointerRef.current = { x: event.clientX, y: event.clientY };
                }
              }}
              onDragEnd={(event) => {
                const panelBounds = fieldPanelRef.current?.getBoundingClientRect();
                const pointer =
                  event.clientX !== 0 || event.clientY !== 0
                    ? { x: event.clientX, y: event.clientY }
                    : fieldDragPointerRef.current;
                const outsidePanel =
                  panelBounds !== undefined &&
                  (pointer.x < panelBounds.left ||
                    pointer.x > panelBounds.right ||
                    pointer.y < panelBounds.top ||
                    pointer.y > panelBounds.bottom);
                if (outsidePanel) {
                  removeField(field.id);
                }
                setDraggedFieldId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault();
                  removeField(field.id);
                }
              }}
            >
              <span title={field.name}>{field.name}</span>
              <span title={`[${field.msb}:${field.lsb}]`}>
                [{field.msb}:{field.lsb}]
              </span>
              <span title={raw}>{raw}</span>
              <span title={shown.text}>
                {shown.text}
                {shown.comparison && (
                  <b className={`di-compare is-${shown.comparison}`}>{shown.comparison}</b>
                )}
                {changed && <b className="di-changed">changed</b>}
              </span>
            </button>
          );
        })}
      </div>
      {draggedFieldId !== null && (
        <div className="di-drag-delete-hint" aria-hidden="true">
          <span className="codicon codicon-trash" />
          Drag outside this panel to delete field
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {fieldAnnouncement}
      </div>
      {selectedFieldId && (
        <div className="di-field-decode-controls">
          <label>
            Name
            <input
              value={fields.find((field) => field.id === selectedFieldId)?.name ?? ''}
              onChange={(event) => updateSelectedField({ name: event.target.value })}
            />
          </label>
          <label>
            MSB
            <input
              type="number"
              min={0}
              value={fields.find((field) => field.id === selectedFieldId)?.msb ?? 0}
              onChange={(event) => updateSelectedField({ msb: Number(event.target.value) })}
            />
          </label>
          <label>
            LSB
            <input
              type="number"
              min={0}
              value={fields.find((field) => field.id === selectedFieldId)?.lsb ?? 0}
              onChange={(event) => updateSelectedField({ lsb: Number(event.target.value) })}
            />
          </label>
          <label>
            Overlay group
            <select
              value={fields.find((field) => field.id === selectedFieldId)?.groupId ?? 'default'}
              onChange={(event) => updateSelectedField({ groupId: event.target.value })}
            >
              {currentRecipe.overlayGroups.map((group) => (
                <option value={group.id} key={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Interpretation
            <select
              value={
                currentRecipe.fields.find((field) => field.id === selectedFieldId)?.display
                  .interpretation ?? 'hex'
              }
              onChange={(event) =>
                updateSelectedFieldDisplay({
                  interpretation: event.target
                    .value as IPCraftDataInspectorRecipe['fields'][number]['display']['interpretation'],
                })
              }
            >
              {['hex', 'binary', 'unsigned', 'signed', 'enum', 'float', 'fixedPoint'].map(
                (interpretation) => (
                  <option key={interpretation}>{interpretation}</option>
                )
              )}
            </select>
          </label>
          {currentRecipe.fields.find((field) => field.id === selectedFieldId)?.display
            .interpretation === 'fixedPoint' && (
            <label>
              Fractional bits
              <input
                type="number"
                min={0}
                value={
                  currentRecipe.fields.find((field) => field.id === selectedFieldId)?.display
                    .fractionalBits ?? 0
                }
                onChange={(event) =>
                  updateSelectedFieldDisplay({
                    fractionalBits: Number(event.target.value),
                  })
                }
              />
            </label>
          )}
          <label>
            Expected literal
            <input
              placeholder="optional"
              value={
                currentRecipe.fields.find((field) => field.id === selectedFieldId)?.display
                  .expectedValue ?? ''
              }
              onChange={(event) =>
                updateSelectedFieldDisplay({
                  expectedValue: event.target.value || undefined,
                })
              }
            />
          </label>
          <div className="di-new-group">
            <input
              aria-label="New overlay group"
              placeholder="Alternative view"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
            <button
              disabled={!newGroupName.trim()}
              onClick={() => {
                const id = newGroupName
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9._-]+/g, '-');
                setRecipeBase({
                  ...currentRecipe,
                  overlayGroups: [
                    ...currentRecipe.overlayGroups,
                    { id, name: newGroupName.trim() },
                  ],
                });
                updateSelectedField({ groupId: id });
                setNewGroupName('');
              }}
            >
              Add group
            </button>
          </div>
        </div>
      )}
      {fields.length === 0 && <p className="di-note">Define a field or copy a register layout.</p>}
    </div>
  );
}
