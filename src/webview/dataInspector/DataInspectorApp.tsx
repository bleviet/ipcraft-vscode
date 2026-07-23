import React, { useRef, useState } from 'react';
import { validateFieldLayout } from '../../dataInspector/fieldLayout';
import type {
  DataInspectorToExtensionMessage,
  RegisterLayoutCopy,
} from '../../shared/messages/dataInspector';
import type { IPCraftDataInspectorRecipe } from '../../domain/dataInspector.types';
import { TransformTab } from './transform/TransformTab';
import { WorkbenchLibrary } from './WorkbenchLibrary';
import { ButtonTooltip } from './ButtonTooltip';
import { CapturePanel } from './CapturePanel';
import { FieldPanel } from './FieldPanel';
import { ValueComposer } from './ValueComposer';
import { InspectorPropertiesPanel } from './InspectorPropertiesPanel';
import { LaneRibbon } from './LaneRibbon';
import { createRevisionState } from '../sync/revisionFilter';
import { useCaptureImport } from './hooks/useCaptureImport';
import { useDataInspectorSync } from './hooks/useDataInspectorSync';
import { useFieldPanel } from './hooks/useFieldPanel';
import { useRecipeAutosave } from './hooks/useRecipeAutosave';
import { useRecipeGraphEditor } from './hooks/useRecipeGraphEditor';
import { useRecipeModel } from './hooks/useRecipeModel';
import { usePanelLayout } from './hooks/usePanelLayout';
import { useValueInput } from './hooks/useValueInput';

export { LaneRibbon };

declare const acquireVsCodeApi:
  | undefined
  | (() => { postMessage: (message: DataInspectorToExtensionMessage) => void });

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const postMessage = vscode
  ? (message: DataInspectorToExtensionMessage) => vscode.postMessage(message)
  : undefined;
export function DataInspectorApp() {
  const [recipeBase, setRecipeBase] = useState<IPCraftDataInspectorRecipe | null>(null);
  const valueInput = useValueInput(recipeBase?.sources[0]?.id ?? 'input');
  const {
    changeValueRepresentation,
    error,
    setDraft,
    setError,
    setSamples,
    setSourceDrafts,
    setSourceOriginalTexts,
    setVector,
    setWidthDraft,
    valueRepresentation,
    vector,
    warnings,
  } = valueInput;
  const fieldPanel = useFieldPanel();
  const {
    draggedFieldId,
    fieldAnnouncement,
    fields,
    fieldSearch,
    layoutId,
    newGroupName,
    selectedFieldId,
    setDraggedFieldId,
    setFieldProvenance,
    setFields,
    setFieldSearch,
    setFieldSourceIds,
    setLayoutId,
    setNewGroupName,
    setNextFieldNumber,
    setSelectedFieldId,
    updateSelectedField,
  } = fieldPanel;
  const [layouts, setLayouts] = useState<RegisterLayoutCopy[]>([]);
  const [recipeFileName, setRecipeFileName] = useState('');
  const [recipeError, setRecipeError] = useState('');
  const panelLayout = usePanelLayout(vector);
  const {
    beginCenterResize,
    beginPanelResize,
    bitsPercent,
    canvasAddCommand,
    centerMode,
    centerRef,
    inspectCanvasValue,
    inspectorCollapsed,
    inspectorPanelWidth,
    inspectorTab,
    laneWidth,
    libraryCollapsed,
    libraryPanelWidth,
    mobileTab,
    problemsOpen,
    queueCanvasAdd,
    selectedNodeId,
    setBitsPercent,
    setCenterMode,
    setInspectedValueId,
    setInspectorCollapsed,
    setInspectorPanelWidth,
    setInspectorTab,
    setLaneWidth,
    setLibraryCollapsed,
    setLibraryPanelWidth,
    setMobileTab,
    setProblemsOpen,
    setSelectedNodeId,
    setZoom,
    zoom,
  } = panelLayout;
  const fieldPanelRef = useRef<HTMLDivElement>(null);
  const fieldDragPointerRef = useRef({ x: 0, y: 0 });
  const revisionStateRef = useRef(createRevisionState());

  useDataInspectorSync({
    postMessage,
    revisionStateRef,
    setDraft,
    setFieldProvenance,
    setFields,
    setFieldSourceIds,
    setInspectedValueId,
    setLaneWidth,
    setLayouts,
    setNextFieldNumber,
    setRecipeBase,
    setRecipeError,
    setRecipeFileName,
    setSamples,
    setSelectedNodeId,
    setSourceDrafts,
    setSourceOriginalTexts,
    setVector,
    setWidthDraft,
    setZoom,
  });

  const recipeModel = useRecipeModel({ recipeBase, fieldPanel, panelLayout, valueInput });
  const {
    currentRecipe,
    displayVector,
    evaluatedValue,
    evaluation,
    recipeSemanticProblems,
    ribbonFields,
    sampleMap,
  } = recipeModel;

  useRecipeAutosave({
    currentRecipe,
    enabled: recipeBase !== null,
    postMessage,
    revisionStateRef,
    semanticProblemCount: recipeSemanticProblems.length,
  });

  const selectedSource = currentRecipe.sources.find((source) => source.id === selectedNodeId);
  const selectedStep = currentRecipe.steps.find((step) => step.id === selectedNodeId);
  const activeSource = selectedSource ?? currentRecipe.sources[0];
  const capture = useCaptureImport({
    activeSource,
    currentRecipe,
    setError,
    setRecipeBase,
    setSamples,
    setVector,
    setWidthDraft,
  });
  const { vcdSample } = capture;
  const activeSourceVector = activeSource
    ? evaluation.values.get(activeSource.id)?.value
    : undefined;
  const activeSourceFields = fields.filter((field) => {
    const definition = currentRecipe.fields.find((candidate) => candidate.id === field.id);
    return (definition?.sourceId ?? currentRecipe.sources[0]?.id) === activeSource?.id;
  });
  const layoutErrors = activeSourceVector
    ? validateFieldLayout(activeSourceFields, activeSourceVector.width)
    : [];
  const filteredFields = activeSourceFields.filter((field) =>
    field.name.toLowerCase().includes(fieldSearch.toLowerCase())
  );

  const graphEditor = useRecipeGraphEditor({
    fieldPanel,
    panelLayout,
    recipeModel,
    setRecipeBase,
    valueInput,
  });
  const { deleteCanvasNodes, updateSelectedFieldDisplay } = graphEditor;

  const addField = () =>
    fieldPanel.addField({
      activeSource,
      activeSourceFields,
      activeSourceVector,
      currentRecipe,
      setError,
      showFields: () => setInspectorTab('fields'),
    });

  const removeField = fieldPanel.removeField;

  const copySelectedRegisterLayout = () =>
    fieldPanel.copySelectedRegisterLayout({
      activeSource,
      activeSourceFields,
      currentRecipe,
      layout: layouts.find((candidate) => candidate.id === layoutId),
      setError,
      showFields: () => setInspectorTab('fields'),
    });

  const problems = [
    ...recipeSemanticProblems,
    ...(error ? [error] : []),
    ...(recipeError ? [recipeError] : []),
    ...warnings,
  ].filter((problem, index, all) => all.indexOf(problem) === index);
  const saveProblemCount = recipeSemanticProblems.length + (recipeError ? 1 : 0);

  return (
    <main className="di-shell" onContextMenu={(event) => event.preventDefault()}>
      <ButtonTooltip />
      <header className="di-topbar">
        <div>
          <span className="di-brand">IPCraft</span>
          <h1>{recipeFileName || 'Data Inspector'}</h1>
        </div>
        <div className="di-topbar-actions">
          <span className="di-status">Session only · samples are never saved</span>
          {recipeBase !== null && saveProblemCount > 0 && (
            <span className="di-save-status" role="status">
              Not saved — {saveProblemCount} {saveProblemCount === 1 ? 'problem' : 'problems'}
            </span>
          )}
          {vector && (
            <>
              <button
                className={problems.length > 0 ? 'has-problems' : ''}
                aria-expanded={problemsOpen}
                onClick={() => setProblemsOpen((current) => !current)}
              >
                Problems {problems.length}
              </button>
              <button
                disabled={saveProblemCount > 0}
                onClick={() => vscode?.postMessage({ type: 'saveRecipe', recipe: currentRecipe })}
              >
                Save recipe…
              </button>
            </>
          )}
        </div>
      </header>

      <nav className="di-mobile-tabs" aria-label="Data Inspector sections">
        {(vector
          ? (['bits', 'transform', 'library', 'inspect'] as const)
          : (['value'] as const)
        ).map((tab) => (
          <button
            aria-current={mobileTab === tab ? 'page' : undefined}
            className={mobileTab === tab ? 'is-active' : ''}
            key={tab}
            onClick={() => setMobileTab(tab)}
          >
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {!vector && (
        <ValueComposer
          mobileActive={mobileTab === 'value'}
          onCleared={() => setMobileTab('value')}
          onDecoded={() => setMobileTab('bits')}
          recipeError={recipeError}
          valueInput={valueInput}
        />
      )}

      {!vector ? (
        <section className="di-empty">
          <div className="di-empty__mark">[X:0]</div>
          <h2>Paste a waveform, capture, or register value</h2>
          <p>Binary, hexadecimal, decimal, Verilog, and VHDL literals are accepted exactly.</p>
        </section>
      ) : (
        <div
          className={`di-workbench ${libraryCollapsed ? 'is-library-collapsed' : ''} ${inspectorCollapsed ? 'is-inspector-collapsed' : ''}`}
          style={
            {
              '--di-library-panel-width': `${libraryCollapsed ? 42 : libraryPanelWidth}px`,
              '--di-inspector-panel-width': `${inspectorCollapsed ? 42 : inspectorPanelWidth}px`,
              gridTemplateColumns: `${libraryCollapsed ? 42 : libraryPanelWidth}px ${libraryCollapsed ? 0 : 7}px minmax(320px, 1fr) ${inspectorCollapsed ? 0 : 7}px ${inspectorCollapsed ? 42 : inspectorPanelWidth}px`,
            } as React.CSSProperties
          }
        >
          <div className="di-vector-status" aria-label="Displayed value status">
            <span>{displayVector?.width ?? vector.width} bits</span>
            <span>
              {(displayVector ?? vector).hasUnknown ? 'contains X/Z states' : 'all bits known'}
            </span>
            <span>rightmost digit maps to bit 0</span>
          </div>
          {problemsOpen && (
            <aside className="di-problems-drawer" aria-label="Problems">
              <header>
                <strong>Problems</strong>
                <button aria-label="Close Problems" onClick={() => setProblemsOpen(false)}>
                  <span className="codicon codicon-close" aria-hidden="true" />
                </button>
              </header>
              {problems.length === 0 ? (
                <p>No problems detected.</p>
              ) : (
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </aside>
          )}
          <div className={`di-mobile-panel ${mobileTab === 'library' ? 'is-mobile-active' : ''}`}>
            <WorkbenchLibrary
              collapsed={libraryCollapsed}
              onToggleCollapsed={() => setLibraryCollapsed((current) => !current)}
              onAddSource={() => queueCanvasAdd('source', 'source')}
              onAddOperation={(type) => queueCanvasAdd('operation', type)}
            />
          </div>

          <div
            aria-label="Resize Library and workspace"
            aria-orientation="vertical"
            aria-valuemax={420}
            aria-valuemin={180}
            aria-valuenow={Math.round(libraryPanelWidth)}
            className="di-workbench-divider is-library"
            onDoubleClick={() => setLibraryPanelWidth(238)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setLibraryPanelWidth((current) =>
                  Math.max(180, Math.min(420, current + (event.key === 'ArrowLeft' ? -12 : 12)))
                );
              }
            }}
            onPointerDown={(event) => beginPanelResize(event, 'library')}
            role="separator"
            tabIndex={libraryCollapsed ? -1 : 0}
          />

          <div
            className="di-center-workspace"
            ref={centerRef}
            style={{
              gridTemplateRows:
                centerMode === 'bits'
                  ? 'minmax(0, 1fr)'
                  : centerMode === 'transform'
                    ? 'minmax(0, 1fr)'
                    : `minmax(180px, ${bitsPercent}fr) 7px minmax(260px, ${100 - bitsPercent}fr)`,
            }}
          >
            <div
              className={`di-center-pane di-bits-pane di-mobile-panel ${centerMode === 'transform' ? 'is-hidden' : ''} ${mobileTab === 'bits' ? 'is-mobile-active' : ''}`}
            >
              <LaneRibbon
                vector={displayVector ?? vector}
                fields={ribbonFields.filter(
                  (field) =>
                    field.lsb >= 0 &&
                    field.msb >= field.lsb &&
                    field.msb < (displayVector?.width ?? vector.width)
                )}
                laneWidth={laneWidth}
                selectedFieldId={selectedFieldId}
                onSelectField={(fieldId) => {
                  setSelectedFieldId(fieldId);
                  const definition = currentRecipe.fields.find((field) => field.id === fieldId);
                  if (definition) {
                    setSelectedNodeId(definition.sourceId);
                    setInspectedValueId(definition.sourceId);
                    setInspectorTab('fields');
                  }
                }}
                provenance={evaluatedValue?.provenance}
                maskedBits={evaluatedValue?.maskedBits}
                zoom={zoom}
                onLaneWidthChange={setLaneWidth}
                onZoomChange={setZoom}
                maximized={centerMode === 'bits'}
                onToggleMaximized={() => setCenterMode(centerMode === 'bits' ? 'both' : 'bits')}
                mobileActive={mobileTab === 'bits'}
              />
            </div>

            {centerMode === 'both' && (
              <div
                className="di-center-divider"
                role="separator"
                aria-label="Resize bits and transform views"
                aria-orientation="horizontal"
                aria-valuemin={24}
                aria-valuemax={72}
                aria-valuenow={Math.round(bitsPercent)}
                tabIndex={0}
                onDoubleClick={() => setBitsPercent(42)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    setBitsPercent((current) =>
                      Math.max(24, Math.min(72, current + (event.key === 'ArrowUp' ? -4 : 4)))
                    );
                  }
                }}
                onPointerDown={beginCenterResize}
              />
            )}

            <div
              className={`di-center-pane di-transform-pane di-mobile-panel ${centerMode === 'bits' ? 'is-hidden' : ''} ${mobileTab === 'transform' ? 'is-mobile-active' : ''}`}
            >
              <TransformTab
                active
                maximized={centerMode === 'transform'}
                recipe={currentRecipe}
                samples={sampleMap}
                valueRepresentation={valueRepresentation}
                onValueRepresentationChange={changeValueRepresentation}
                resetToken={recipeError}
                onToggleMaximized={() =>
                  setCenterMode(centerMode === 'transform' ? 'both' : 'transform')
                }
                preserveViewport={centerMode === 'transform'}
                onRecipeChange={setRecipeBase}
                onInspectValue={inspectCanvasValue}
                onDeleteNodes={deleteCanvasNodes}
                addCommand={canvasAddCommand}
              />
            </div>
          </div>

          <div
            aria-label="Resize workspace and Inspector"
            aria-orientation="vertical"
            aria-valuemax={520}
            aria-valuemin={260}
            aria-valuenow={Math.round(inspectorPanelWidth)}
            className="di-workbench-divider is-inspector"
            onDoubleClick={() => setInspectorPanelWidth(350)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setInspectorPanelWidth((current) =>
                  Math.max(260, Math.min(520, current + (event.key === 'ArrowLeft' ? 12 : -12)))
                );
              }
            }}
            onPointerDown={(event) => beginPanelResize(event, 'inspector')}
            role="separator"
            tabIndex={inspectorCollapsed ? -1 : 0}
          />

          <section
            className={`di-card di-inspector di-mobile-panel ${inspectorCollapsed ? 'is-collapsed' : ''} ${mobileTab === 'inspect' ? 'is-mobile-active' : ''}`}
            aria-label="Inspector tools"
          >
            <header className="di-rail-header di-inspector-header">
              {!inspectorCollapsed && (
                <div>
                  <span className="di-eyebrow">Selected node</span>
                  <h2>{selectedSource?.name ?? selectedStep?.id ?? 'Inspector'}</h2>
                </div>
              )}
              <button
                className="di-icon-button"
                aria-label={inspectorCollapsed ? 'Expand Inspector' : 'Collapse Inspector'}
                onClick={() => setInspectorCollapsed((current) => !current)}
                data-tooltip={inspectorCollapsed ? 'Expand Inspector' : 'Collapse Inspector'}
              >
                <span
                  className={`codicon codicon-${inspectorCollapsed ? 'inspect' : 'layout-sidebar-right-off'}`}
                  aria-hidden="true"
                />
              </button>
            </header>
            {!inspectorCollapsed && (
              <>
                <nav className="di-inspector-tabs" aria-label="Inspector tool" role="tablist">
                  {(selectedSource
                    ? (['properties', 'fields', 'capture'] as const)
                    : (['properties'] as const)
                  ).map((tab) => (
                    <button
                      aria-controls={`di-inspector-panel-${tab}`}
                      aria-selected={inspectorTab === tab}
                      className={inspectorTab === tab ? 'is-active' : ''}
                      id={`di-inspector-tab-${tab}`}
                      key={tab}
                      role="tab"
                      tabIndex={inspectorTab === tab ? 0 : -1}
                      onClick={() => setInspectorTab(tab)}
                    >
                      {tab[0].toUpperCase() + tab.slice(1)}
                      {tab === 'fields' && activeSourceFields.length > 0
                        ? ` ${activeSourceFields.length}`
                        : ''}
                    </button>
                  ))}
                </nav>

                <InspectorPropertiesPanel
                  active={inspectorTab === 'properties'}
                  graphEditor={graphEditor}
                  recipeModel={recipeModel}
                  valueInput={valueInput}
                />

                <CapturePanel
                  active={inspectorTab === 'capture'}
                  capture={capture}
                  setError={setError}
                />

                <FieldPanel
                  addField={addField}
                  copySelectedRegisterLayout={copySelectedRegisterLayout}
                  currentRecipe={currentRecipe}
                  displayVector={displayVector}
                  draggedFieldId={draggedFieldId}
                  evaluation={evaluation}
                  fieldAnnouncement={fieldAnnouncement}
                  fieldDragPointerRef={fieldDragPointerRef}
                  fieldPanelRef={fieldPanelRef}
                  fields={fields}
                  fieldSearch={fieldSearch}
                  filteredFields={filteredFields}
                  inspectorTab={inspectorTab}
                  layoutErrors={layoutErrors}
                  layoutId={layoutId}
                  layouts={layouts}
                  newGroupName={newGroupName}
                  removeField={removeField}
                  selectedFieldId={selectedFieldId}
                  setDraggedFieldId={setDraggedFieldId}
                  setFieldSearch={setFieldSearch}
                  setLayoutId={setLayoutId}
                  setNewGroupName={setNewGroupName}
                  setRecipeBase={setRecipeBase}
                  setSelectedFieldId={setSelectedFieldId}
                  updateSelectedField={updateSelectedField}
                  updateSelectedFieldDisplay={updateSelectedFieldDisplay}
                  vcdSample={vcdSample}
                />
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
