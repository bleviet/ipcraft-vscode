import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BitVector } from '../../dataInspector/BitVector';
import {
  InspectorField,
  projectFieldsToOutput,
  type ProjectedInspectorField,
  validateFieldLayout,
} from '../../dataInspector/fieldLayout';
import {
  getLaneRange,
  rangeToLaneFractions,
  segmentFieldAcrossLanes,
} from '../../dataInspector/fieldGeometry';
import { parseLiteral } from '../../dataInspector/parseLiteral';
import { formatValue, type ValueRepresentation } from '../../dataInspector/formatValue';
import type {
  DataInspectorToExtensionMessage,
  RegisterLayoutCopy,
} from '../../shared/messages/dataInspector';
import type { IPCraftDataInspectorRecipe } from '../../domain/dataInspector.types';
import { createEmptyRecipe, validateRecipeSemantics } from '../../dataInspector/recipe';
import { evaluateRecipe, type ProvenanceBit } from '../../dataInspector/evaluateRecipe';
import { applyGraphEdit } from '../../dataInspector/recipeGraph';
import { TransformTab } from './transform/TransformTab';
import { WorkbenchLibrary } from './WorkbenchLibrary';
import type { CanvasAddCommand } from './canvas/TransformCanvas';
import { ButtonTooltip } from './ButtonTooltip';
import { CapturePanel } from './CapturePanel';
import { FieldPanel } from './FieldPanel';
import { ValueComposer } from './ValueComposer';
import { createRevisionState } from '../sync/revisionFilter';
import { useCaptureImport } from './hooks/useCaptureImport';
import { useDataInspectorSync } from './hooks/useDataInspectorSync';
import { useFieldPanel } from './hooks/useFieldPanel';
import { useRecipeAutosave } from './hooks/useRecipeAutosave';
import { useValueInput } from './hooks/useValueInput';

declare const acquireVsCodeApi:
  | undefined
  | (() => { postMessage: (message: DataInspectorToExtensionMessage) => void });

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const postMessage = vscode
  ? (message: DataInspectorToExtensionMessage) => vscode.postMessage(message)
  : undefined;
const LANE_HEIGHT = 74;
interface LaneRibbonProps {
  vector: BitVector;
  fields: Array<InspectorField | ProjectedInspectorField>;
  laneWidth: number;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  provenance?: Array<ProvenanceBit | null>;
  maskedBits?: ReadonlySet<number>;
  zoom?: 'overview' | 'field' | 'bit';
  onLaneWidthChange?: (width: 8 | 16 | 32 | 64) => void;
  onZoomChange?: (zoom: 'overview' | 'field' | 'bit') => void;
  maximized?: boolean;
  onToggleMaximized?: () => void;
  mobileActive?: boolean;
}

export function LaneRibbon({
  vector,
  fields,
  laneWidth,
  selectedFieldId,
  onSelectField,
  provenance,
  maskedBits,
  zoom = 'field',
  onLaneWidthChange,
  onZoomChange,
  maximized = false,
  onToggleMaximized,
  mobileActive = false,
}: LaneRibbonProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);
  const [focusedLane, setFocusedLane] = useState(0);
  const [goToBit, setGoToBit] = useState('');
  const [targetBit, setTargetBit] = useState<number | null>(null);
  const [jumpMessage, setJumpMessage] = useState('');
  const [jumpError, setJumpError] = useState(false);
  const laneCount = Math.ceil(vector.width / laneWidth);
  const overscan = 2;
  const start = Math.max(0, Math.floor(scrollTop / LANE_HEIGHT) - overscan);
  const end = Math.min(laneCount, Math.ceil((scrollTop + viewportHeight) / LANE_HEIGHT) + overscan);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const observer = new ResizeObserver(() => setViewportHeight(viewport.clientHeight));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const focusLane = (laneIndex: number) => {
    const next = Math.max(0, Math.min(laneCount - 1, laneIndex));
    setFocusedLane(next);
    viewportRef.current?.scrollTo({ top: next * LANE_HEIGHT, behavior: 'smooth' });
    window.setTimeout(() => {
      viewportRef.current?.querySelector<HTMLElement>(`[data-lane="${next}"]`)?.focus();
    }, 0);
  };

  const lanes = [];
  for (let laneIndex = start; laneIndex < end; laneIndex++) {
    const range = getLaneRange(vector.width, laneWidth, laneIndex);
    const laneVector = vector.slice(range.laneMsb, range.laneLsb);
    const laneBits = laneVector.toBinary();
    const laneDisplay = zoom === 'overview' ? (laneVector.toHex() ?? laneBits) : laneBits;
    const sourceSegments: Array<{ sourceId: string | null; msb: number; lsb: number }> = [];
    if (provenance) {
      for (let bit = range.laneMsb; bit >= range.laneLsb; bit--) {
        const sourceId = provenance[bit]?.sourceId ?? null;
        const previous = sourceSegments[sourceSegments.length - 1];
        if (previous?.sourceId === sourceId && previous.lsb === bit + 1) {
          previous.lsb = bit;
        } else {
          sourceSegments.push({ sourceId, msb: bit, lsb: bit });
        }
      }
    }
    lanes.push(
      <div
        aria-current={
          targetBit !== null && targetBit <= range.laneMsb && targetBit >= range.laneLsb
        }
        className={`di-lane ${
          targetBit !== null && targetBit <= range.laneMsb && targetBit >= range.laneLsb
            ? 'is-target'
            : ''
        }`}
        data-lane={laneIndex}
        key={laneIndex}
        role="row"
        tabIndex={focusedLane === laneIndex ? 0 : -1}
        aria-label={`Bits ${range.laneMsb} through ${range.laneLsb}: ${laneBits}`}
        onFocus={() => setFocusedLane(laneIndex)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusLane(laneIndex + 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusLane(laneIndex - 1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            focusLane(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            focusLane(laneCount - 1);
          }
        }}
      >
        <div className="di-lane__gutter">
          [{range.laneMsb}:{range.laneLsb}]
        </div>
        <div className={`di-lane__content is-${zoom}`}>
          <div
            className="di-lane__track"
            style={zoom === 'bit' ? { minWidth: `${laneBits.length * 24}px` } : undefined}
          >
            <div className="di-source-band">
              {provenance
                ? sourceSegments.map((segment) => (
                    <span
                      className={segment.sourceId === null ? 'is-inserted' : ''}
                      key={`${segment.sourceId ?? 'inserted'}-${segment.msb}`}
                      style={{
                        width: `${
                          ((segment.msb - segment.lsb + 1) / (range.laneMsb - range.laneLsb + 1)) *
                          100
                        }%`,
                      }}
                      title={
                        segment.sourceId === null
                          ? `Transform-inserted ${vector.slice(segment.msb, segment.lsb).toBinary()} [${segment.msb}:${segment.lsb}]`
                          : `${segment.sourceId} [${segment.msb}:${segment.lsb}]`
                      }
                    >
                      {segment.sourceId === null
                        ? `+${vector.slice(segment.msb, segment.lsb).toBinary()}`
                        : `${segment.sourceId} [${segment.msb}:${segment.lsb}]`}
                    </span>
                  ))
                : `INPUT · bits [${range.laneMsb}:${range.laneLsb}]`}
            </div>
            <div className={`di-bits is-${zoom}`} aria-hidden="true">
              {zoom === 'overview'
                ? laneDisplay
                : Array.from(laneDisplay, (state, index) => {
                    const bit = range.laneMsb - index;
                    const separator = bit % 8 === 7 ? 'is-byte' : bit % 4 === 3 ? 'is-nibble' : '';
                    const stateClass =
                      state === '1' ? 'is-one' : state === '0' ? 'is-zero' : 'is-unknown';
                    return (
                      <span
                        className={`${maskedBits?.has(bit) ? 'is-masked' : ''} ${
                          targetBit === bit ? 'is-target' : ''
                        } ${stateClass} ${separator}`}
                        data-bit={bit}
                        key={bit}
                      >
                        {state}
                      </span>
                    );
                  })}
            </div>
            <div className="di-field-overlay">
              {sourceSegments
                .filter((segment) => segment.sourceId === null)
                .map((segment) => {
                  const fractions = rangeToLaneFractions(
                    range.laneMsb,
                    range.laneLsb,
                    segment.msb,
                    segment.lsb
                  );
                  const insertedBits = vector.slice(segment.msb, segment.lsb).toBinary();
                  return (
                    <span
                      aria-label={`Transform-inserted ${insertedBits}, bits ${segment.msb} through ${segment.lsb}`}
                      className="di-inserted-segment"
                      key={`inserted-${segment.msb}`}
                      style={{
                        left: `${fractions.startFraction * 100}%`,
                        width: `${fractions.widthFraction * 100}%`,
                      }}
                      title={`Transform-inserted ${insertedBits} [${segment.msb}:${segment.lsb}]`}
                    >
                      +{insertedBits}
                    </span>
                  );
                })}
              {fields.flatMap((field) =>
                segmentFieldAcrossLanes(vector.width, laneWidth, field.msb, field.lsb)
                  .filter((segment) => segment.laneIndex === laneIndex)
                  .map((segment) => (
                    <button
                      className={`di-field-segment ${
                        selectedFieldId ===
                        ('sourceFieldId' in field ? field.sourceFieldId : field.id)
                          ? 'is-selected'
                          : ''
                      }`}
                      key={field.id}
                      style={{
                        left: `${segment.startFraction * 100}%`,
                        width: `${segment.widthFraction * 100}%`,
                      }}
                      title={`${field.name} [${field.msb}:${field.lsb}]`}
                      onClick={() =>
                        onSelectField('sourceFieldId' in field ? field.sourceFieldId : field.id)
                      }
                    >
                      {field.name}
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`di-card di-ribbon-card di-mobile-panel ${mobileActive ? 'is-mobile-active' : ''}`}
      aria-labelledby="bits-heading"
    >
      <header className="di-section-header">
        <div>
          <span className="di-eyebrow">Continuous vector</span>
          <h2 id="bits-heading">Bits</h2>
        </div>
        <div className="di-ribbon-tools">
          {onLaneWidthChange && (
            <div className="di-tool-group">
              <div className="di-segmented-control" role="group" aria-label="Lane width">
                {[8, 16, 32, 64].map((value) => (
                  <button
                    aria-pressed={laneWidth === value}
                    className={laneWidth === value ? 'is-active' : ''}
                    key={value}
                    onClick={() => onLaneWidthChange(value as 8 | 16 | 32 | 64)}
                    data-tooltip={`Show ${value} bits per lane`}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <span className="di-tool-label">Lane width</span>
            </div>
          )}
          {onZoomChange && (
            <div className="di-tool-group">
              <div className="di-segmented-control" role="group" aria-label="Zoom">
                {(['overview', 'field', 'bit'] as const).map((value) => (
                  <button
                    aria-pressed={zoom === value}
                    className={zoom === value ? 'is-active' : ''}
                    key={value}
                    onClick={() => onZoomChange(value)}
                    data-tooltip={`Use ${value} zoom`}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <span className="di-tool-label">Zoom</span>
            </div>
          )}
          <form
            className="di-go-to di-tool-group"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const bit = Number(goToBit);
              if (Number.isInteger(bit) && bit >= 0 && bit < vector.width) {
                const laneIndex = Math.floor((vector.width - 1 - bit) / laneWidth);
                const range = getLaneRange(vector.width, laneWidth, laneIndex);
                setTargetBit(bit);
                setJumpMessage(`Bit ${bit} · lane [${range.laneMsb}:${range.laneLsb}]`);
                setJumpError(false);
                focusLane(laneIndex);
              } else {
                setTargetBit(null);
                setJumpMessage(`Enter a bit from 0 to ${vector.width - 1}`);
                setJumpError(true);
              }
            }}
          >
            <div className="di-jump-control">
              <label className="sr-only" htmlFor="go-to-bit">
                Jump to bit
              </label>
              <input
                aria-describedby="go-to-bit-status"
                id="go-to-bit"
                type="number"
                min={0}
                max={vector.width - 1}
                placeholder={`0–${vector.width - 1}`}
                value={goToBit}
                onChange={(event) => {
                  setGoToBit(event.target.value);
                  setJumpMessage('');
                  setJumpError(false);
                }}
              />
              <button type="submit">Jump</button>
            </div>
            <span
              className={`di-tool-label di-jump-status ${jumpError ? 'is-error' : ''}`}
              id="go-to-bit-status"
              aria-live="polite"
            >
              {jumpMessage || 'Jump to bit'}
            </span>
          </form>
          {onToggleMaximized && (
            <button
              aria-label={maximized ? 'Restore split view' : 'Maximize bits view'}
              className="di-icon-button di-panel-maximize"
              onClick={onToggleMaximized}
              data-tooltip={maximized ? 'Restore split view' : 'Maximize bits view'}
              type="button"
            >
              <span
                className={`codicon ${maximized ? 'codicon-layout' : 'codicon-screen-full'}`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </header>
      <div
        className="di-lanes"
        ref={viewportRef}
        role="table"
        aria-rowcount={laneCount}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: laneCount * LANE_HEIGHT, position: 'relative' }}>
          <div style={{ position: 'absolute', insetInline: 0, top: start * LANE_HEIGHT }}>
            {lanes}
          </div>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        Lane {focusedLane + 1} of {laneCount}
      </div>
    </section>
  );
}

interface SourceWidthInputProps {
  width: number;
  onChange: (width: number) => void;
}

function SourceWidthInput({ width, onChange }: SourceWidthInputProps) {
  const [draft, setDraft] = useState(String(width));

  useEffect(() => {
    setDraft(String(width));
  }, [width]);

  return (
    <input
      type="number"
      min={1}
      max={4096}
      value={draft}
      onBlur={() => setDraft(String(width))}
      onChange={(event) => {
        const nextDraft = event.target.value;
        const nextWidth = Number(nextDraft);
        setDraft(nextDraft);
        if (
          nextDraft !== '' &&
          Number.isInteger(nextWidth) &&
          nextWidth >= 1 &&
          nextWidth <= 4096
        ) {
          onChange(nextWidth);
        }
      }}
    />
  );
}

interface CopyableValueProps {
  label: string;
  value: string;
  representation?: ValueRepresentation;
}

function CopyableValue({ label, value, representation }: CopyableValueProps) {
  return (
    <div className="di-copyable-value">
      <div className="di-copyable-value__heading">
        <span>{label}</span>
        {representation && <small>{representation}</small>}
      </div>
      <div className="di-copyable-value__content">
        <code className={label === 'Value' ? 'di-inspector-value' : undefined}>{value}</code>
        <button
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void navigator.clipboard.writeText(value)}
          data-tooltip={`Copy ${label.toLowerCase()}`}
          type="button"
        >
          <span className="codicon codicon-copy" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function DataInspectorApp() {
  const [recipeBase, setRecipeBase] = useState<IPCraftDataInspectorRecipe | null>(null);
  const valueInput = useValueInput(recipeBase?.sources[0]?.id ?? 'input');
  const {
    changeValueRepresentation,
    error,
    samples,
    setDraft,
    setError,
    setSamples,
    setSourceDrafts,
    setSourceOriginalTexts,
    setVector,
    setWarnings,
    setWidthDraft,
    sourceDrafts,
    sourceOriginalTexts,
    valueRepresentation,
    vector,
    warnings,
    widthDraft,
  } = valueInput;
  const fieldPanel = useFieldPanel();
  const {
    draggedFieldId,
    fieldAnnouncement,
    fieldProvenance,
    fields,
    fieldSearch,
    fieldSourceIds,
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
  const [laneWidth, setLaneWidth] = useState<8 | 16 | 32 | 64>(32);
  const [zoom, setZoom] = useState<'overview' | 'field' | 'bit'>('field');
  const [layouts, setLayouts] = useState<RegisterLayoutCopy[]>([]);
  const [recipeFileName, setRecipeFileName] = useState('');
  const [recipeError, setRecipeError] = useState('');
  const [mobileTab, setMobileTab] = useState<
    'value' | 'bits' | 'transform' | 'library' | 'inspect'
  >('bits');
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'fields' | 'capture'>(
    'properties'
  );
  const [inspectedValueId, setInspectedValueId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('input');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [libraryPanelWidth, setLibraryPanelWidth] = useState(238);
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(350);
  const [centerMode, setCenterMode] = useState<'both' | 'bits' | 'transform'>('both');
  const [bitsPercent, setBitsPercent] = useState(42);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [canvasAddCommand, setCanvasAddCommand] = useState<CanvasAddCommand>();
  const centerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    setMobileTab((current) => {
      if (!vector) {
        return 'value';
      }
      return current === 'value' ? 'bits' : current;
    });
  }, [vector]);

  const currentRecipe = useMemo<IPCraftDataInspectorRecipe>(() => {
    const draftWidth = widthDraft === '' ? vector?.width : Number(widthDraft);
    const width = draftWidth ?? recipeBase?.sources[0]?.width ?? 32;
    const base = recipeBase ?? createEmptyRecipe('data-inspector');
    const sourceId = base.sources[0]?.id ?? 'input';
    const existingFields = new Map(base.fields.map((field) => [field.id, field]));
    return {
      ...base,
      sources:
        base.sources.length > 0
          ? base.sources.map((source, index) => (index === 0 ? { ...source, width } : source))
          : [{ id: sourceId, name: 'INPUT', width }],
      fields: fields.map((field) => {
        const existing = existingFields.get(field.id);
        return {
          ...field,
          sourceId: fieldSourceIds[field.id] ?? existing?.sourceId ?? sourceId,
          display: existing?.display ?? { interpretation: 'hex' as const },
          importProvenance: fieldProvenance[field.id] ?? existing?.importProvenance,
        };
      }),
      view: { ...base.view, laneWidth, zoom },
    };
  }, [
    fieldSourceIds,
    fields,
    fieldProvenance,
    laneWidth,
    recipeBase,
    vector?.width,
    widthDraft,
    zoom,
  ]);
  const recipeSemanticProblems = useMemo(
    () => validateRecipeSemantics(currentRecipe),
    [currentRecipe]
  );

  useEffect(() => {
    setSourceDrafts((current) => {
      const missingSources = currentRecipe.sources.filter(
        (source) => current[source.id] === undefined
      );
      if (missingSources.length === 0) {
        return current;
      }
      return {
        ...current,
        ...Object.fromEntries(missingSources.map((source) => [source.id, '0'])),
      };
    });
  }, [currentRecipe.sources]);

  useEffect(() => {
    setSamples((current) => {
      let next = current;
      for (const source of currentRecipe.sources) {
        if (current[source.id]?.width === source.width) {
          continue;
        }
        try {
          const value = parseLiteral(sourceDrafts[source.id] ?? '0', {
            width: source.width,
          }).vector;
          if (next === current) {
            next = { ...current };
          }
          next[source.id] = value;
        } catch {
          // The Inspector reports invalid explicit literals when the user applies them.
        }
      }
      return next;
    });
  }, [currentRecipe.sources, sourceDrafts]);

  useRecipeAutosave({
    currentRecipe,
    enabled: recipeBase !== null,
    postMessage,
    revisionStateRef,
    semanticProblemCount: recipeSemanticProblems.length,
  });

  const sampleMap = useMemo(() => new Map(Object.entries(samples)), [samples]);
  const evaluation = useMemo(
    () => evaluateRecipe(currentRecipe, sampleMap),
    [currentRecipe, sampleMap]
  );
  const selectedSource = currentRecipe.sources.find((source) => source.id === selectedNodeId);
  const selectedSourceIndex = selectedSource
    ? currentRecipe.sources.findIndex((source) => source.id === selectedSource.id)
    : -1;
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
  const lastStep = currentRecipe.steps[currentRecipe.steps.length - 1];
  const selectedValueId = inspectedValueId ?? lastStep?.id ?? currentRecipe.sources[0]?.id;
  const evaluatedValue = selectedValueId ? evaluation.values.get(selectedValueId) : undefined;
  const displayVector = evaluatedValue?.value ?? vector;
  const ribbonFields = useMemo(
    () =>
      evaluatedValue
        ? projectFieldsToOutput(
            currentRecipe.fields.map((field) => ({
              ...field,
              description: field.description,
              enumValues: field.enumValues,
            })),
            evaluatedValue.provenance
          )
        : fields,
    [currentRecipe.fields, evaluatedValue, fields]
  );

  const inspectCanvasValue = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setInspectedValueId(nodeId);
    setInspectorTab('properties');
  };

  const deleteCanvasNodes = (nodeIds: string[]): string | undefined => {
    try {
      const candidate = applyGraphEdit(currentRecipe, { type: 'deleteNodes', nodeIds });
      const remainingNodeIds = new Set([
        ...candidate.sources.map((source) => source.id),
        ...candidate.steps.map((step) => step.id),
      ]);
      const remainingSourceIds = new Set(candidate.sources.map((source) => source.id));
      const remainingFieldIds = new Set(candidate.fields.map((field) => field.id));
      const fallbackSource = candidate.sources[0];

      setRecipeBase(candidate);
      setFields((current) => current.filter((field) => remainingFieldIds.has(field.id)));
      setFieldSourceIds((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([fieldId, sourceId]) =>
              remainingFieldIds.has(fieldId) && remainingSourceIds.has(sourceId)
          )
        )
      );
      setFieldProvenance((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([fieldId]) => remainingFieldIds.has(fieldId))
        )
      );
      setSamples((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sourceId]) => remainingSourceIds.has(sourceId))
        )
      );
      setSourceDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sourceId]) => remainingSourceIds.has(sourceId))
        )
      );
      setSourceOriginalTexts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sourceId]) => remainingSourceIds.has(sourceId))
        )
      );
      setSelectedFieldId((current) => (current && remainingFieldIds.has(current) ? current : null));

      if (!remainingNodeIds.has(selectedNodeId)) {
        setSelectedNodeId(fallbackSource.id);
      }
      if (inspectedValueId && !remainingNodeIds.has(inspectedValueId)) {
        setInspectedValueId(fallbackSource.id);
      }
      if (!remainingSourceIds.has(currentRecipe.sources[0].id)) {
        const nextVector = samples[fallbackSource.id] ?? null;
        setVector(nextVector);
        setWidthDraft(String(nextVector?.width ?? fallbackSource.width));
      }
      setError('');
      return undefined;
    } catch (deleteError) {
      return deleteError instanceof Error ? deleteError.message : String(deleteError);
    }
  };

  const updateSelectedFieldDisplay = (
    patch: Partial<IPCraftDataInspectorRecipe['fields'][number]['display']>
  ) => {
    if (!selectedFieldId) {
      return;
    }
    setRecipeBase({
      ...currentRecipe,
      fields: currentRecipe.fields.map((field) =>
        field.id === selectedFieldId ? { ...field, display: { ...field.display, ...patch } } : field
      ),
    });
  };

  const updateStep = (
    index: number,
    patch: Partial<IPCraftDataInspectorRecipe['steps'][number]>
  ) => {
    setRecipeBase({
      ...currentRecipe,
      steps: currentRecipe.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step
      ),
    });
  };

  const connectStepDependency = (
    stepId: string,
    targetHandle: 'input' | 'operand',
    sourceId: string
  ) => {
    try {
      setRecipeBase(
        applyGraphEdit(currentRecipe, { type: 'connect', sourceId, targetId: stepId, targetHandle })
      );
      setError('');
    } catch (connectionError) {
      setError(
        connectionError instanceof Error ? connectionError.message : String(connectionError)
      );
    }
  };

  const removeStep = (index: number) => {
    const removed = currentRecipe.steps[index];
    if (!removed) {
      return;
    }
    const fallbackId = removed.inputId;
    const steps = currentRecipe.steps
      .filter((_, stepIndex) => stepIndex !== index)
      .map((step) => ({
        ...step,
        inputId: step.inputId === removed.id ? fallbackId : step.inputId,
        ...(step.operandId === removed.id ? { operandId: fallbackId } : {}),
      }));
    setRecipeBase({ ...currentRecipe, steps });
  };

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

  const removeSelectedSource = () => {
    if (!selectedSource || currentRecipe.sources.length === 1) {
      return;
    }
    const referenced = currentRecipe.steps.some(
      (step) => step.inputId === selectedSource.id || step.operandId === selectedSource.id
    );
    if (referenced) {
      setError('Disconnect this input from all operators before deleting it');
      return;
    }
    const removedFieldIds = new Set(
      currentRecipe.fields
        .filter((field) => field.sourceId === selectedSource.id)
        .map((field) => field.id)
    );
    setRecipeBase({
      ...currentRecipe,
      sources: currentRecipe.sources.filter((source) => source.id !== selectedSource.id),
      fields: currentRecipe.fields.filter((field) => field.sourceId !== selectedSource.id),
    });
    setFields((current) => current.filter((field) => !removedFieldIds.has(field.id)));
    setSamples((current) => {
      const next = { ...current };
      delete next[selectedSource.id];
      return next;
    });
    setSourceOriginalTexts((current) => {
      const next = { ...current };
      delete next[selectedSource.id];
      return next;
    });
    setSelectedNodeId(currentRecipe.sources[0].id);
    setInspectedValueId(currentRecipe.sources[0].id);
    setError('');
  };

  const copySelectedRegisterLayout = () =>
    fieldPanel.copySelectedRegisterLayout({
      activeSource,
      activeSourceFields,
      currentRecipe,
      layout: layouts.find((candidate) => candidate.id === layoutId),
      setError,
      showFields: () => setInspectorTab('fields'),
    });

  const beginCenterResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = centerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize = (moveEvent: PointerEvent) => {
      const next = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      setBitsPercent(Math.max(24, Math.min(72, next)));
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
  };

  const beginPanelResize = (
    event: React.PointerEvent<HTMLDivElement>,
    panel: 'library' | 'inspector'
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = panel === 'library' ? libraryPanelWidth : inspectorPanelWidth;
    const resize = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = panel === 'library' ? startWidth + delta : startWidth - delta;
      if (panel === 'library') {
        setLibraryPanelWidth(Math.max(180, Math.min(420, next)));
      } else {
        setInspectorPanelWidth(Math.max(260, Math.min(520, next)));
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
  };

  const problems = [
    ...recipeSemanticProblems,
    ...(error ? [error] : []),
    ...(recipeError ? [recipeError] : []),
    ...warnings,
  ].filter((problem, index, all) => all.indexOf(problem) === index);
  const saveProblemCount = recipeSemanticProblems.length + (recipeError ? 1 : 0);

  const queueCanvasAdd = (kind: CanvasAddCommand['kind'], value: string) => {
    setCanvasAddCommand((current) => ({ id: (current?.id ?? 0) + 1, kind, value }));
    setMobileTab('transform');
  };

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

                <div
                  aria-labelledby="di-inspector-tab-properties"
                  className={`di-inspector-panel di-properties-panel ${inspectorTab === 'properties' ? 'is-active' : ''}`}
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
                          onChange={(event) =>
                            setRecipeBase({
                              ...currentRecipe,
                              sources: currentRecipe.sources.map((source) =>
                                source.id === selectedSource.id
                                  ? { ...source, name: event.target.value }
                                  : source
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Width
                        <SourceWidthInput
                          width={selectedSource.width}
                          onChange={(width) => {
                            setRecipeBase({
                              ...currentRecipe,
                              sources: currentRecipe.sources.map((source) =>
                                source.id === selectedSource.id ? { ...source, width } : source
                              ),
                            });
                            if (selectedSourceIndex === 0) {
                              setWidthDraft(String(width));
                            }
                          }}
                        />
                      </label>
                      <label>
                        Transient value
                        <div className="di-source__input">
                          <input
                            aria-label={
                              selectedSourceIndex === 0 ? 'Literal' : `${selectedSource.name} value`
                            }
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
                            onClick={() => {
                              try {
                                const parsed = parseLiteral(sourceDrafts[selectedSource.id] ?? '', {
                                  width: selectedSource.width,
                                });
                                setSamples((current) => ({
                                  ...current,
                                  [selectedSource.id]: parsed.vector,
                                }));
                                const normalizedText = formatValue(
                                  parsed.vector,
                                  valueRepresentation
                                );
                                setSourceDrafts((current) => ({
                                  ...current,
                                  [selectedSource.id]: normalizedText,
                                }));
                                setSourceOriginalTexts((current) => ({
                                  ...current,
                                  [selectedSource.id]: parsed.originalText,
                                }));
                                if (selectedSourceIndex === 0) {
                                  setVector(parsed.vector);
                                  setDraft(normalizedText);
                                  setWarnings(parsed.warnings);
                                }
                                setError('');
                              } catch (sourceError) {
                                setError(
                                  sourceError instanceof Error
                                    ? sourceError.message
                                    : String(sourceError)
                                );
                              }
                            }}
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
                      {(selectedStep.type === 'shiftLeft' ||
                        selectedStep.type === 'shiftRight') && (
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
