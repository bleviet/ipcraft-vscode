import React from 'react';
import { formatValue } from '../../dataInspector/formatValue';
import { CopyableValue } from './CopyableValue';
import type { RecipeGraphEditorState } from './hooks/useRecipeGraphEditor';
import type { RecipeModelState } from './hooks/useRecipeModel';
import type { ValueInputState } from './hooks/useValueInput';
import { SourceWidthInput } from './SourceWidthInput';

interface InspectorPropertiesPanelProps {
  active: boolean;
  graphEditor: RecipeGraphEditorState;
  recipeModel: RecipeModelState;
  valueInput: ValueInputState;
}

export function InspectorPropertiesPanel({
  active,
  graphEditor,
  recipeModel,
  valueInput,
}: InspectorPropertiesPanelProps) {
  const {
    applySelectedSourceDraft,
    connectStepDependency,
    removeSelectedSource,
    removeStep,
    selectedSource,
    selectedSourceIndex,
    selectedStep,
    updateSelectedSource,
    updateStep,
  } = graphEditor;
  const { currentRecipe, evaluation } = recipeModel;
  const { setSourceDrafts, sourceDrafts, sourceOriginalTexts, valueRepresentation } = valueInput;
  const activeSourceVector = selectedSource
    ? evaluation.values.get(selectedSource.id)?.value
    : undefined;

  return (
    <div
      aria-labelledby="di-inspector-tab-properties"
      className={`di-inspector-panel di-properties-panel ${active ? 'is-active' : ''}`}
      id="di-inspector-panel-properties"
      role="tabpanel"
    >
      {selectedSource && (
        <>
          <div className="di-node-kind">
            <span className="di-source__badge">
              {String.fromCharCode(65 + selectedSourceIndex)}
            </span>
            <span>
              <small>Input</small>
              <strong>{selectedSource.id}</strong>
            </span>
          </div>
          <label>
            Name
            <input
              aria-label={`Source ${selectedSourceIndex + 1} name`}
              value={selectedSource.name}
              onChange={(event) => updateSelectedSource({ name: event.target.value })}
            />
          </label>
          <label>
            Width
            <SourceWidthInput
              width={selectedSource.width}
              onChange={(width) => updateSelectedSource({ width })}
            />
          </label>
          <label>
            Transient value
            <div className="di-source__input">
              <input
                aria-label={selectedSourceIndex === 0 ? 'Literal' : `${selectedSource.name} value`}
                placeholder="0x…"
                value={sourceDrafts[selectedSource.id] ?? ''}
                onChange={(event) =>
                  setSourceDrafts((current) => ({
                    ...current,
                    [selectedSource.id]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.nextElementSibling?.dispatchEvent(
                      new MouseEvent('click', { bubbles: true })
                    );
                  }
                }}
              />
              <button
                aria-label={`Decode ${selectedSource.name}`}
                onClick={applySelectedSourceDraft}
              >
                Set
              </button>
            </div>
          </label>
          {activeSourceVector && (
            <CopyableValue
              label="Value"
              representation={valueRepresentation}
              value={formatValue(activeSourceVector, valueRepresentation)}
            />
          )}
          {sourceOriginalTexts[selectedSource.id] &&
            activeSourceVector &&
            sourceOriginalTexts[selectedSource.id] !==
              formatValue(activeSourceVector, valueRepresentation) && (
              <CopyableValue
                label="Original entered value"
                value={sourceOriginalTexts[selectedSource.id]}
              />
            )}
          <button
            className="di-danger-button"
            disabled={currentRecipe.sources.length === 1}
            onClick={removeSelectedSource}
          >
            Delete input
          </button>
        </>
      )}

      {selectedStep && (
        <>
          <div className="di-node-kind">
            <span className="di-operation-badge">
              {selectedStep.type === 'concat' ? '{ }' : selectedStep.type}
            </span>
            <span>
              <small>Operator</small>
              <strong>{selectedStep.id}</strong>
            </span>
          </div>
          <label>
            Primary input
            <select
              value={selectedStep.inputId}
              onChange={(event) =>
                connectStepDependency(selectedStep.id, 'input', event.target.value)
              }
            >
              {[...currentRecipe.sources, ...currentRecipe.steps]
                .filter((value) => value.id !== selectedStep.id)
                .map((value) => (
                  <option value={value.id} key={value.id}>
                    {value.id}
                  </option>
                ))}
            </select>
          </label>
          {['concat', 'and', 'or', 'xor'].includes(selectedStep.type) && (
            <label>
              Operand
              <select
                value={selectedStep.operandId}
                onChange={(event) =>
                  connectStepDependency(selectedStep.id, 'operand', event.target.value)
                }
              >
                {[...currentRecipe.sources, ...currentRecipe.steps]
                  .filter((value) => value.id !== selectedStep.id)
                  .map((value) => (
                    <option value={value.id} key={value.id}>
                      {value.id}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {selectedStep.type === 'slice' && (
            <div className="di-property-grid">
              <label>
                MSB
                <input
                  type="number"
                  min={0}
                  max={4095}
                  value={selectedStep.msb ?? 0}
                  onChange={(event) =>
                    updateStep(currentRecipe.steps.indexOf(selectedStep), {
                      msb: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                LSB
                <input
                  type="number"
                  min={0}
                  max={4095}
                  value={selectedStep.lsb ?? 0}
                  onChange={(event) =>
                    updateStep(currentRecipe.steps.indexOf(selectedStep), {
                      lsb: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          )}
          {(selectedStep.type === 'shiftLeft' || selectedStep.type === 'shiftRight') && (
            <label>
              Shift amount
              <input
                type="number"
                min={0}
                max={4096}
                value={selectedStep.amount ?? 0}
                onChange={(event) =>
                  updateStep(currentRecipe.steps.indexOf(selectedStep), {
                    amount: Number(event.target.value),
                  })
                }
              />
            </label>
          )}
          {['zeroExtend', 'signExtend', 'truncate'].includes(selectedStep.type) && (
            <label>
              Output width
              <input
                type="number"
                min={1}
                max={4096}
                value={selectedStep.width ?? 1}
                onChange={(event) =>
                  updateStep(currentRecipe.steps.indexOf(selectedStep), {
                    width: Number(event.target.value),
                  })
                }
              />
            </label>
          )}
          {evaluation.values.get(selectedStep.id)?.value ? (
            <CopyableValue
              label="Value"
              representation={valueRepresentation}
              value={formatValue(
                evaluation.values.get(selectedStep.id)!.value,
                valueRepresentation
              )}
            />
          ) : (
            <code className="di-inspector-value">No value</code>
          )}
          <button
            className="di-danger-button"
            onClick={() => removeStep(currentRecipe.steps.indexOf(selectedStep))}
          >
            Delete operator
          </button>
        </>
      )}
    </div>
  );
}
