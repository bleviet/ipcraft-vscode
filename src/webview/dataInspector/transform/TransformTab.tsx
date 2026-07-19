import React from 'react';
import type { BitVector } from '../../../dataInspector/BitVector';
import type { ValueRepresentation } from '../../../dataInspector/formatValue';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import { TransformCanvas, type CanvasAddCommand } from '../canvas/TransformCanvas';

interface TransformTabProps {
  active: boolean;
  maximized: boolean;
  recipe: IPCraftDataInspectorRecipe;
  samples: ReadonlyMap<string, BitVector>;
  valueRepresentation: ValueRepresentation;
  onValueRepresentationChange: (representation: ValueRepresentation) => void;
  resetToken?: string;
  onToggleMaximized: () => void;
  onRecipeChange: (recipe: IPCraftDataInspectorRecipe) => void;
  onInspectValue: (nodeId: string, kind: 'source' | 'step') => void;
  onDeleteNodes: (nodeIds: string[]) => string | undefined;
  addCommand?: CanvasAddCommand;
}

export function TransformTab({
  active,
  maximized,
  recipe,
  samples,
  valueRepresentation,
  onValueRepresentationChange,
  resetToken,
  onToggleMaximized,
  onRecipeChange,
  onInspectValue,
  onDeleteNodes,
  addCommand,
}: TransformTabProps) {
  return (
    <div
      aria-label="Transform workspace"
      className={`di-transform-workspace di-transform-panel is-canvas ${active ? 'is-active' : ''}`}
      id="di-inspector-panel-transform"
      role="tabpanel"
    >
      <div className="di-panel-heading di-transform-heading">
        <span>
          <span className="di-eyebrow">Compose derived values</span>
          <h2>Transform recipe</h2>
        </span>
        <button
          aria-label={maximized ? 'Restore split view' : 'Maximize transform view'}
          className="di-icon-button"
          onClick={onToggleMaximized}
          title={maximized ? 'Restore split view' : 'Maximize transform view'}
          type="button"
        >
          <span
            className={`codicon ${maximized ? 'codicon-layout' : 'codicon-screen-full'}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <TransformCanvas
        recipe={recipe}
        samples={samples}
        valueRepresentation={valueRepresentation}
        onValueRepresentationChange={onValueRepresentationChange}
        resetToken={resetToken}
        onRecipeChange={onRecipeChange}
        onInspectValue={onInspectValue}
        onDeleteNodes={onDeleteNodes}
        addCommand={addCommand}
      />
    </div>
  );
}
