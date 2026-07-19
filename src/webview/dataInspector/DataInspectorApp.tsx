import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BitVector } from '../../dataInspector/BitVector';
import {
  decodeField,
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
  DataInspectorToWebviewMessage,
  RegisterLayoutCopy,
} from '../../shared/messages/dataInspector';
import type { IPCraftDataInspectorRecipe } from '../../domain/dataInspector.types';
import {
  createEmptyRecipe,
  recipeFields,
  validateRecipeSemantics,
} from '../../dataInspector/recipe';
import { evaluateRecipe, type ProvenanceBit } from '../../dataInspector/evaluateRecipe';
import { applyGraphEdit } from '../../dataInspector/recipeGraph';
import {
  compareExpected,
  decodeEnum,
  decodeFixedPoint,
  decodeFloat,
  decodeSigned,
  decodeUnsigned,
} from '../../dataInspector/numericDecode';
import { VcdCapture, VcdSelection, type VcdSample } from '../../dataInspector/vcd';
import {
  CsvCapture,
  csvSignalColumns,
  detectCsvCapturePreset,
  getCsvHeaders,
  type CsvSignalMapping,
} from '../../dataInspector/csvCapture';
import { TransformTab } from './transform/TransformTab';
import { WorkbenchLibrary } from './WorkbenchLibrary';
import type { CanvasAddCommand } from './canvas/TransformCanvas';

declare const acquireVsCodeApi:
  | undefined
  | (() => { postMessage: (message: DataInspectorToExtensionMessage) => void });

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const LANE_HEIGHT = 74;
const DEFAULT_VECTOR = BitVector.fromBigInt(BigInt(0), 32);
const VALUE_EXAMPLES = [
  { label: 'Known hex', literal: '0xDEAD_BEEF' },
  { label: 'Unknown states', literal: '0b0000_XXXX_0011_ZZZZ' },
  { label: 'Decimal', literal: '305419896' },
] as const;

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
    result = {
      status: 'ok' as const,
      text: hexDisplayText(value) ?? value.toBinary(),
    };
  }
  return {
    text: result.text,
    comparison: field.display.expectedValue
      ? compareExpected(value, field.display.expectedValue)
      : undefined,
  };
}

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
                    title={`Show ${value} bits per lane`}
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
                    title={`Use ${value} zoom`}
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
              title={maximized ? 'Restore split view' : 'Maximize bits view'}
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
          title={`Copy ${label.toLowerCase()}`}
          type="button"
        >
          <span className="codicon codicon-copy" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function DataInspectorApp() {
  const [draft, setDraft] = useState('0');
  const [widthDraft, setWidthDraft] = useState('32');
  const [vector, setVector] = useState<BitVector | null>(DEFAULT_VECTOR);
  const [originalText, setOriginalText] = useState('0');
  const [valueRepresentation, setValueRepresentation] = useState<ValueRepresentation>('hex');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fields, setFields] = useState<InspectorField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [laneWidth, setLaneWidth] = useState<8 | 16 | 32 | 64>(32);
  const [zoom, setZoom] = useState<'overview' | 'field' | 'bit'>('field');
  const [layouts, setLayouts] = useState<RegisterLayoutCopy[]>([]);
  const [layoutId, setLayoutId] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [fieldAnnouncement, setFieldAnnouncement] = useState('');
  const [nextFieldNumber, setNextFieldNumber] = useState(1);
  const [recipeBase, setRecipeBase] = useState<IPCraftDataInspectorRecipe | null>(null);
  const [recipeFileName, setRecipeFileName] = useState('');
  const [recipeDocVersion, setRecipeDocVersion] = useState<number | undefined>();
  const [recipeError, setRecipeError] = useState('');
  const [fieldProvenance, setFieldProvenance] = useState<
    Record<string, { sourceFile: string; registerName: string }>
  >({});
  const [fieldSourceIds, setFieldSourceIds] = useState<Record<string, string>>({});
  const [samples, setSamples] = useState<Record<string, BitVector>>({ input: DEFAULT_VECTOR });
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({ input: '0' });
  const [vcdCapture, setVcdCapture] = useState<VcdCapture | null>(null);
  const [vcdSignalNames, setVcdSignalNames] = useState<string[]>([]);
  const [vcdSelection, setVcdSelection] = useState<VcdSelection | null>(null);
  const [vcdSampleIndex, setVcdSampleIndex] = useState(0);
  const [vcdSample, setVcdSample] = useState<VcdSample | null>(null);
  const [csvText, setCsvText] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvColumn, setCsvColumn] = useState('');
  const [csvRadix, setCsvRadix] = useState<CsvSignalMapping['radix']>('hex');
  const [csvByteOrder, setCsvByteOrder] = useState<CsvSignalMapping['byteOrder']>('bigEndian');
  const [csvWordOrder, setCsvWordOrder] = useState<CsvSignalMapping['wordOrder']>('highFirst');
  const [csvWordWidth, setCsvWordWidth] = useState<CsvSignalMapping['wordWidth']>(8);
  const [csvCapture, setCsvCapture] = useState<CsvCapture | null>(null);
  const [csvSampleIndex, setCsvSampleIndex] = useState(0);
  const [newGroupName, setNewGroupName] = useState('');
  const [mobileTab, setMobileTab] = useState<
    'value' | 'bits' | 'transform' | 'library' | 'inspect'
  >('value');
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
  const recipeInitializedRef = useRef(false);

  useEffect(() => {
    const receive = (event: MessageEvent<DataInspectorToWebviewMessage>) => {
      if (event.data.type === 'registerLayouts') {
        setLayouts(event.data.layouts);
      } else if (event.data.type === 'recipe') {
        const firstSource = event.data.recipe.sources[0];
        if (!recipeInitializedRef.current && firstSource) {
          const initialRecipeVector = BitVector.fromBigInt(BigInt(0), firstSource.width);
          setDraft('0');
          setVector(initialRecipeVector);
          setOriginalText('0');
          setSamples({ [firstSource.id]: initialRecipeVector });
          setSourceDrafts({ [firstSource.id]: '0' });
          recipeInitializedRef.current = true;
        }
        setRecipeBase(event.data.recipe);
        setRecipeFileName(event.data.fileName);
        setRecipeDocVersion(event.data.docVersion);
        setFields(recipeFields(event.data.recipe));
        setLaneWidth(event.data.recipe.view.laneWidth);
        setZoom(event.data.recipe.view.zoom);
        setWidthDraft(String(event.data.recipe.sources[0]?.width ?? 32));
        setFieldProvenance(
          Object.fromEntries(
            event.data.recipe.fields
              .filter((field) => field.importProvenance !== undefined)
              .map((field) => [field.id, field.importProvenance!])
          )
        );
        setFieldSourceIds(
          Object.fromEntries(event.data.recipe.fields.map((field) => [field.id, field.sourceId]))
        );
        setSelectedNodeId(event.data.recipe.sources[0]?.id ?? 'input');
        setInspectedValueId(event.data.recipe.sources[0]?.id ?? null);
        setRecipeError('');
      } else if (event.data.type === 'recipeError') {
        setRecipeError(event.data.error);
      } else if (event.data.type === 'applyRegisterLayout') {
        const { layout } = event.data;
        const sourceId = 'input';
        const initialLayoutVector = BitVector.fromBigInt(BigInt(0), layout.width);
        setDraft('0');
        setWidthDraft(String(layout.width));
        setVector(initialLayoutVector);
        setOriginalText('0');
        setSamples({ [sourceId]: initialLayoutVector });
        setSourceDrafts({ [sourceId]: '0' });
        setFields(layout.fields.map((field) => ({ ...field })));
        setFieldSourceIds(Object.fromEntries(layout.fields.map((field) => [field.id, sourceId])));
        setFieldProvenance(
          Object.fromEntries(
            layout.fields.map((field) => [
              field.id,
              { sourceFile: layout.sourceFile, registerName: layout.registerName },
            ])
          )
        );
      }
    };
    window.addEventListener('message', receive);
    vscode?.postMessage({ type: 'ready' });
    vscode?.postMessage({ type: 'requestRegisterLayouts' });
    return () => window.removeEventListener('message', receive);
  }, []);

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

  useEffect(() => {
    if (recipeBase === null || validateRecipeSemantics(currentRecipe).length > 0) {
      return;
    }
    const timeout = window.setTimeout(() => {
      vscode?.postMessage({
        type: 'updateRecipe',
        recipe: currentRecipe,
        baseDocVersion: recipeDocVersion,
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [currentRecipe, recipeBase, recipeDocVersion]);

  const parseValue = (literal: string, literalWidth = widthDraft) => {
    try {
      const parsed = parseLiteral(literal, {
        width: literalWidth === '' ? undefined : Number(literalWidth),
      });
      const normalizedText = formatValue(parsed.vector, valueRepresentation);
      setDraft(normalizedText);
      setVector(parsed.vector);
      const sourceId = currentRecipe.sources[0]?.id ?? 'input';
      setSamples((current) => ({ ...current, [sourceId]: parsed.vector }));
      setSourceDrafts((current) => ({ ...current, [sourceId]: normalizedText }));
      setOriginalText(parsed.originalText);
      setWarnings(parsed.warnings);
      setError('');
      setMobileTab('bits');
      if (literalWidth === '') {
        setWidthDraft(String(parsed.vector.width));
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  };

  const parseDraft = () => parseValue(draft);

  const changeValueRepresentation = (representation: ValueRepresentation) => {
    setValueRepresentation(representation);
    if (!vector) {
      return;
    }
    setDraft(formatValue(vector, representation));
    setSourceDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([sourceId, sourceText]) => [
          sourceId,
          samples[sourceId] ? formatValue(samples[sourceId], representation) : sourceText,
        ])
      )
    );
  };

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

  const updateSelectedField = (patch: Partial<InspectorField>) => {
    if (!selectedFieldId) {
      return;
    }
    setFields((current) =>
      current.map((field) => (field.id === selectedFieldId ? { ...field, ...patch } : field))
    );
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

  const applyVcdSample = (selection: VcdSelection, index: number) => {
    const sample = selection.sample(index);
    const nextSamples: Record<string, BitVector> = {};
    const nextSources = selection.signals.map((signal, signalIndex) => {
      const existing = currentRecipe.sources[signalIndex];
      const source = existing ?? {
        id: signalIndex === 0 ? 'input' : `input${signalIndex + 1}`,
        name: signal.name,
        width: signal.width,
      };
      const value = sample.values.get(signal.name);
      if (value) {
        nextSamples[source.id] = value;
      }
      return { ...source, name: signal.name, width: signal.width };
    });
    setRecipeBase({ ...currentRecipe, sources: nextSources });
    setSamples(nextSamples);
    setVector(nextSamples[nextSources[0]?.id] ?? null);
    setVcdSampleIndex(index);
    setVcdSample(sample);
  };

  const loadCsvText = (text: string) => {
    try {
      const headers = getCsvHeaders(text);
      setCsvText(text);
      setCsvHeaders(headers);
      setCsvColumn(
        csvSignalColumns(headers, detectCsvCapturePreset(headers))[0] ?? headers[0] ?? ''
      );
      setError('');
    } catch (csvError) {
      setError(csvError instanceof Error ? csvError.message : String(csvError));
    }
  };

  const applyCsvSample = (capture: CsvCapture, index: number) => {
    const source = activeSource;
    const value = capture.samples[index]?.values.get(source?.name ?? 'INPUT');
    if (!source || !value) {
      return;
    }
    setSamples((current) => ({ ...current, [source.id]: value }));
    if (source.id === currentRecipe.sources[0]?.id) {
      setVector(value);
    }
    setCsvSampleIndex(index);
  };

  const addField = () => {
    if (!activeSource || !activeSourceVector) {
      return;
    }
    const occupied = new Set(
      activeSourceFields
        .filter((field) => field.groupId === 'default')
        .flatMap((field) =>
          Array.from({ length: field.msb - field.lsb + 1 }, (_, i) => field.lsb + i)
        )
    );
    let bit = activeSourceVector.width - 1;
    while (bit >= 0 && occupied.has(bit)) {
      bit--;
    }
    if (bit < 0) {
      setError('The default overlay group has no unassigned bits');
      return;
    }
    const id = `field-${nextFieldNumber}`;
    setNextFieldNumber((value) => value + 1);
    setFields((current) => [
      ...current,
      { id, name: `FIELD_${nextFieldNumber}`, msb: bit, lsb: bit, groupId: 'default' },
    ]);
    setFieldSourceIds((current) => ({ ...current, [id]: activeSource.id }));
    setSelectedFieldId(id);
    setInspectorTab('fields');
  };

  const removeField = (fieldId: string) => {
    const removed = fields.find((field) => field.id === fieldId);
    if (!removed) {
      return;
    }
    setFields((current) => current.filter((field) => field.id !== fieldId));
    setFieldSourceIds((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setSelectedFieldId((current) => (current === fieldId ? null : current));
    setFieldAnnouncement(`Removed field ${removed.name}`);
  };

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
    setSelectedNodeId(currentRecipe.sources[0].id);
    setInspectedValueId(currentRecipe.sources[0].id);
    setError('');
  };

  const copySelectedRegisterLayout = () => {
    const layout = layouts.find((candidate) => candidate.id === layoutId);
    if (!layout || !activeSource) {
      return;
    }
    const activeIds = new Set(activeSourceFields.map((field) => field.id));
    setFields((current) => [
      ...current.filter((field) => !activeIds.has(field.id)),
      ...layout.fields.map((field) => ({ ...field })),
    ]);
    setFieldProvenance((current) => ({
      ...current,
      ...Object.fromEntries(
        layout.fields.map((field) => [
          field.id,
          { sourceFile: layout.sourceFile, registerName: layout.registerName },
        ])
      ),
    }));
    setFieldSourceIds((current) => ({
      ...current,
      ...Object.fromEntries(layout.fields.map((field) => [field.id, activeSource.id])),
    }));
    if (layout.width !== activeSource.width) {
      setError(
        `Copied ${layout.width}-bit register layout onto a ${activeSource.width}-bit value; out-of-range fields are flagged below`
      );
    }
    setInspectorTab('fields');
  };

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
    ...validateRecipeSemantics(currentRecipe),
    ...(error ? [error] : []),
    ...(recipeError ? [recipeError] : []),
    ...warnings,
  ].filter((problem, index, all) => all.indexOf(problem) === index);

  const queueCanvasAdd = (kind: CanvasAddCommand['kind'], value: string) => {
    setCanvasAddCommand((current) => ({ id: (current?.id ?? 0) + 1, kind, value }));
    setCenterMode('both');
    setMobileTab('transform');
  };

  return (
    <main className="di-shell">
      <header className="di-topbar">
        <div>
          <span className="di-brand">IPCraft</span>
          <h1>{recipeFileName || 'Data Inspector'}</h1>
        </div>
        <div className="di-topbar-actions">
          <span className="di-status">Session only · samples are never saved</span>
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
            className={mobileTab === tab ? 'is-active' : ''}
            key={tab}
            onClick={() => setMobileTab(tab)}
          >
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {!vector && (
        <section
          className={`di-composer di-mobile-panel ${mobileTab === 'value' ? 'is-mobile-active' : ''}`}
          aria-labelledby="value-heading"
        >
          <div className="di-composer__title">
            <span className="di-step">1</span>
            <div>
              <span className="di-eyebrow">Paste any value</span>
              <h2 id="value-heading">Value composer</h2>
            </div>
          </div>
          <div className="di-input-row">
            <label className="di-value-input">
              <span>Literal</span>
              <input
                value={draft}
                placeholder="0x0001_2000_0000_3F00"
                spellCheck={false}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    parseDraft();
                  }
                }}
              />
            </label>
            <label className="di-width-input">
              <span>Width</span>
              <input
                type="number"
                min={1}
                max={4096}
                value={widthDraft}
                placeholder="auto"
                onChange={(event) => setWidthDraft(event.target.value)}
              />
            </label>
            <button className="di-primary" onClick={parseDraft}>
              Decode
            </button>
            <button
              onClick={() => {
                setDraft('');
                setWidthDraft('');
                setVector(null);
                setSamples({});
                setOriginalText('');
                setError('');
                setWarnings([]);
              }}
            >
              Clear
            </button>
          </div>
          {!vector && (
            <div className="di-examples" aria-label="Example values">
              <span>Try an example</span>
              {VALUE_EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  onClick={() => {
                    setDraft(example.literal);
                    setWidthDraft('');
                    parseValue(example.literal, '');
                  }}
                >
                  <strong>{example.label}</strong>
                  <code>{example.literal}</code>
                </button>
              ))}
            </div>
          )}
          {error && <div className="di-message is-error">{error}</div>}
          {recipeError && <div className="di-message is-error">{recipeError}</div>}
          {warnings.map((warning) => (
            <div className="di-message is-warning" key={warning}>
              {warning}
            </div>
          ))}
        </section>
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
                title={inspectorCollapsed ? 'Expand Inspector' : 'Collapse Inspector'}
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
                                if (selectedSourceIndex === 0) {
                                  setVector(parsed.vector);
                                  setDraft(normalizedText);
                                  setOriginalText(sourceDrafts[selectedSource.id] ?? '');
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
                      {selectedSourceIndex === 0 &&
                        originalText &&
                        activeSourceVector &&
                        originalText !== formatValue(activeSourceVector, valueRepresentation) && (
                          <CopyableValue label="Original value" value={originalText} />
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
                            updateStep(currentRecipe.steps.indexOf(selectedStep), {
                              inputId: event.target.value,
                            })
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
                              updateStep(currentRecipe.steps.indexOf(selectedStep), {
                                operandId: event.target.value,
                              })
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

                <div
                  aria-labelledby="di-inspector-tab-capture"
                  className={`di-inspector-panel di-capture-panel ${inspectorTab === 'capture' ? 'is-active' : ''}`}
                  id="di-inspector-panel-capture"
                  role="tabpanel"
                >
                  <div className="di-panel-heading">
                    <span className="di-eyebrow">Bring in structure or samples</span>
                    <h2>Capture</h2>
                  </div>
                  <details className="di-capture" open={vcdCapture !== null}>
                    <summary>VCD capture</summary>
                    <label>
                      VCD file
                      <input
                        type="file"
                        accept=".vcd,text/plain"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) {
                            return;
                          }
                          void file
                            .text()
                            .then((text) => {
                              const capture = VcdCapture.parse(text);
                              setVcdCapture(capture);
                              setVcdSignalNames(
                                capture.signals.slice(0, 1).map((signal) => signal.name)
                              );
                              setError('');
                            })
                            .catch((captureError: unknown) =>
                              setError(
                                captureError instanceof Error
                                  ? captureError.message
                                  : String(captureError)
                              )
                            );
                        }}
                      />
                    </label>
                    {vcdCapture && (
                      <div className="di-capture__signals">
                        {vcdCapture.signals.map((signal) => (
                          <label key={signal.id}>
                            <input
                              type="checkbox"
                              checked={vcdSignalNames.includes(signal.name)}
                              onChange={(event) =>
                                setVcdSignalNames((current) =>
                                  event.target.checked
                                    ? [...current, signal.name]
                                    : current.filter((name) => name !== signal.name)
                                )
                              }
                            />
                            {signal.name} [{signal.width}]
                          </label>
                        ))}
                        <button
                          disabled={vcdSignalNames.length === 0}
                          onClick={() => {
                            const selection = vcdCapture.selectSignals(vcdSignalNames);
                            setVcdSelection(selection);
                            applyVcdSample(selection, 0);
                          }}
                        >
                          Index selected signals
                        </button>
                      </div>
                    )}
                    {vcdSelection && vcdSample && (
                      <div className="di-timeline">
                        <button
                          aria-label="Previous sample"
                          disabled={vcdSampleIndex === 0}
                          onClick={() => applyVcdSample(vcdSelection, vcdSampleIndex - 1)}
                        >
                          Previous
                        </button>
                        <input
                          aria-label="Capture sample"
                          type="range"
                          min={0}
                          max={vcdSelection.sampleCount - 1}
                          value={vcdSampleIndex}
                          onChange={(event) =>
                            applyVcdSample(vcdSelection, Number(event.target.value))
                          }
                        />
                        <button
                          aria-label="Next sample"
                          disabled={vcdSampleIndex === vcdSelection.sampleCount - 1}
                          onClick={() => applyVcdSample(vcdSelection, vcdSampleIndex + 1)}
                        >
                          Next
                        </button>
                        <small>
                          Sample {vcdSampleIndex + 1} of {vcdSelection.sampleCount} · time{' '}
                          {vcdSample.time.toString()} {vcdCapture?.timescale}
                        </small>
                      </div>
                    )}
                  </details>
                  <details className="di-capture" open={csvText !== ''}>
                    <summary>CSV / ILA / SignalTap capture</summary>
                    <div className="di-csv-actions">
                      <label>
                        CSV file
                        <input
                          type="file"
                          accept=".csv,text/csv,text/plain"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              void file
                                .text()
                                .then(loadCsvText)
                                .catch((csvError: unknown) =>
                                  setError(
                                    csvError instanceof Error ? csvError.message : String(csvError)
                                  )
                                );
                            }
                          }}
                        />
                      </label>
                      <button
                        onClick={() =>
                          void navigator.clipboard
                            .readText()
                            .then(loadCsvText)
                            .catch((csvError: unknown) =>
                              setError(
                                csvError instanceof Error ? csvError.message : String(csvError)
                              )
                            )
                        }
                      >
                        Paste CSV
                      </button>
                    </div>
                    {csvText && (
                      <div className="di-csv-mapping">
                        {detectCsvCapturePreset(csvHeaders) && (
                          <p className="di-note">
                            Detected{' '}
                            {detectCsvCapturePreset(csvHeaders) === 'vivadoIla'
                              ? 'Vivado ILA'
                              : 'SignalTap'}{' '}
                            export; metadata columns are excluded.
                          </p>
                        )}
                        <label>
                          Signal column
                          <select
                            value={csvColumn}
                            onChange={(event) => setCsvColumn(event.target.value)}
                          >
                            {csvHeaders.map((header) => (
                              <option key={header}>{header}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Radix
                          <select
                            value={csvRadix}
                            onChange={(event) =>
                              setCsvRadix(event.target.value as CsvSignalMapping['radix'])
                            }
                          >
                            {['hex', 'binary', 'decimal'].map((radix) => (
                              <option key={radix}>{radix}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Byte order
                          <select
                            value={csvByteOrder}
                            onChange={(event) =>
                              setCsvByteOrder(event.target.value as CsvSignalMapping['byteOrder'])
                            }
                          >
                            <option value="bigEndian">big endian</option>
                            <option value="littleEndian">little endian</option>
                          </select>
                        </label>
                        <label>
                          Word order
                          <select
                            value={csvWordOrder}
                            onChange={(event) =>
                              setCsvWordOrder(event.target.value as CsvSignalMapping['wordOrder'])
                            }
                          >
                            <option value="highFirst">high word first</option>
                            <option value="lowFirst">low word first</option>
                          </select>
                        </label>
                        <label>
                          Word width
                          <select
                            value={csvWordWidth}
                            onChange={(event) =>
                              setCsvWordWidth(
                                Number(event.target.value) as CsvSignalMapping['wordWidth']
                              )
                            }
                          >
                            {[8, 16, 32, 64].map((width) => (
                              <option key={width}>{width}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          onClick={() => {
                            try {
                              const source = activeSource;
                              if (!source) {
                                return;
                              }
                              const capture = CsvCapture.parse(csvText, [
                                {
                                  name: source.name,
                                  column: csvColumn,
                                  radix: csvRadix,
                                  width: source.width,
                                  byteOrder: csvByteOrder,
                                  wordOrder: csvWordOrder,
                                  wordWidth: csvWordWidth,
                                },
                              ]);
                              setCsvCapture(capture);
                              applyCsvSample(capture, 0);
                              setError('');
                            } catch (csvError) {
                              setError(
                                csvError instanceof Error ? csvError.message : String(csvError)
                              );
                            }
                          }}
                        >
                          Import samples
                        </button>
                      </div>
                    )}
                    {csvCapture && (
                      <div className="di-timeline">
                        <button
                          disabled={csvSampleIndex === 0}
                          onClick={() => applyCsvSample(csvCapture, csvSampleIndex - 1)}
                        >
                          Previous
                        </button>
                        <input
                          aria-label="CSV sample"
                          type="range"
                          min={0}
                          max={csvCapture.samples.length - 1}
                          value={csvSampleIndex}
                          onChange={(event) =>
                            applyCsvSample(csvCapture, Number(event.target.value))
                          }
                        />
                        <button
                          disabled={csvSampleIndex === csvCapture.samples.length - 1}
                          onClick={() => applyCsvSample(csvCapture, csvSampleIndex + 1)}
                        >
                          Next
                        </button>
                        <small>
                          Sample {csvSampleIndex + 1} of {csvCapture.samples.length}
                        </small>
                      </div>
                    )}
                  </details>
                </div>

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
                      <select
                        value={layoutId}
                        onChange={(event) => setLayoutId(event.target.value)}
                      >
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
                    <p className="di-note">
                      One-way copy. The memory map is never modified or linked.
                    </p>
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
                      const definition = currentRecipe.fields.find(
                        (candidate) => candidate.id === field.id
                      );
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
                      const shown = value
                        ? interpretedText(value, definition)
                        : { text: 'invalid' };
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
                              <b className={`di-compare is-${shown.comparison}`}>
                                {shown.comparison}
                              </b>
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
                          onChange={(event) =>
                            updateSelectedField({ msb: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        LSB
                        <input
                          type="number"
                          min={0}
                          value={fields.find((field) => field.id === selectedFieldId)?.lsb ?? 0}
                          onChange={(event) =>
                            updateSelectedField({ lsb: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        Overlay group
                        <select
                          value={
                            fields.find((field) => field.id === selectedFieldId)?.groupId ??
                            'default'
                          }
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
                            currentRecipe.fields.find((field) => field.id === selectedFieldId)
                              ?.display.interpretation ?? 'hex'
                          }
                          onChange={(event) =>
                            updateSelectedFieldDisplay({
                              interpretation: event.target
                                .value as IPCraftDataInspectorRecipe['fields'][number]['display']['interpretation'],
                            })
                          }
                        >
                          {[
                            'hex',
                            'binary',
                            'unsigned',
                            'signed',
                            'enum',
                            'float',
                            'fixedPoint',
                          ].map((interpretation) => (
                            <option key={interpretation}>{interpretation}</option>
                          ))}
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
                              currentRecipe.fields.find((field) => field.id === selectedFieldId)
                                ?.display.fractionalBits ?? 0
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
                            currentRecipe.fields.find((field) => field.id === selectedFieldId)
                              ?.display.expectedValue ?? ''
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
                  {fields.length === 0 && (
                    <p className="di-note">Define a field or copy a register layout.</p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
