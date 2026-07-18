import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BitVector } from '../../dataInspector/BitVector';
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
import type {
  DataInspectorToExtensionMessage,
  DataInspectorToWebviewMessage,
  RegisterLayoutCopy,
} from '../../shared/messages/dataInspector';
import type { IPCraftDataInspectorRecipe } from '../../domain/dataInspector.types';
import { createEmptyRecipe, recipeFields } from '../../dataInspector/recipe';
import { evaluateRecipe, type ProvenanceBit } from '../../dataInspector/evaluateRecipe';
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

declare const acquireVsCodeApi:
  | undefined
  | (() => { postMessage: (message: DataInspectorToExtensionMessage) => void });

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const LANE_HEIGHT = 74;
const VALUE_EXAMPLES = [
  { label: 'Known hex', literal: "32'hDEAD_BEEF" },
  { label: 'Unknown states', literal: "16'b0000_XXXX_0011_ZZZZ" },
  { label: 'VHDL hex', literal: 'x"0123_ABCD"' },
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

export function DataInspectorApp() {
  const [draft, setDraft] = useState('');
  const [widthDraft, setWidthDraft] = useState('');
  const [vector, setVector] = useState<BitVector | null>(null);
  const [originalText, setOriginalText] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fields, setFields] = useState<InspectorField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [laneWidth, setLaneWidth] = useState<8 | 16 | 32 | 64>(32);
  const [zoom, setZoom] = useState<'overview' | 'field' | 'bit'>('field');
  const [layouts, setLayouts] = useState<RegisterLayoutCopy[]>([]);
  const [layoutId, setLayoutId] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [nextFieldNumber, setNextFieldNumber] = useState(1);
  const [recipeBase, setRecipeBase] = useState<IPCraftDataInspectorRecipe | null>(null);
  const [recipeFileName, setRecipeFileName] = useState('');
  const [recipeDocVersion, setRecipeDocVersion] = useState<number | undefined>();
  const [recipeError, setRecipeError] = useState('');
  const [fieldProvenance, setFieldProvenance] = useState<
    Record<string, { sourceFile: string; registerName: string }>
  >({});
  const [samples, setSamples] = useState<Record<string, BitVector>>({});
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({});
  const [newStepType, setNewStepType] =
    useState<IPCraftDataInspectorRecipe['steps'][number]['type']>('concat');
  const [newStepInputId, setNewStepInputId] = useState('input');
  const [newStepOperandId, setNewStepOperandId] = useState('input');
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
  const [mobileTab, setMobileTab] = useState<'value' | 'bits' | 'sources' | 'inspect'>('value');
  const [inspectorTab, setInspectorTab] = useState<'fields' | 'capture' | 'transform'>('fields');

  useEffect(() => {
    const receive = (event: MessageEvent<DataInspectorToWebviewMessage>) => {
      if (event.data.type === 'registerLayouts') {
        setLayouts(event.data.layouts);
      } else if (event.data.type === 'recipe') {
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
        setRecipeError('');
      } else if (event.data.type === 'recipeError') {
        setRecipeError(event.data.error);
      } else if (event.data.type === 'applyRegisterLayout') {
        const { layout } = event.data;
        setWidthDraft(String(layout.width));
        setFields(layout.fields.map((field) => ({ ...field })));
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
    const draftWidth = vector?.width ?? (widthDraft === '' ? undefined : Number(widthDraft));
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
          sourceId: existing?.sourceId ?? sourceId,
          display: existing?.display ?? { interpretation: 'hex' as const },
          importProvenance: fieldProvenance[field.id] ?? existing?.importProvenance,
        };
      }),
      view: { ...base.view, laneWidth, zoom },
    };
  }, [fields, fieldProvenance, laneWidth, recipeBase, vector?.width, widthDraft, zoom]);

  useEffect(() => {
    if (recipeBase === null) {
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

  const layoutErrors = vector ? validateFieldLayout(fields, vector.width) : [];
  const filteredFields = fields.filter((field) =>
    field.name.toLowerCase().includes(fieldSearch.toLowerCase())
  );

  const parseValue = (literal: string, literalWidth = widthDraft) => {
    try {
      const parsed = parseLiteral(literal, {
        width: literalWidth === '' ? undefined : Number(literalWidth),
      });
      setVector(parsed.vector);
      const sourceId = currentRecipe.sources[0]?.id ?? 'input';
      setSamples((current) => ({ ...current, [sourceId]: parsed.vector }));
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

  const sampleMap = useMemo(() => new Map(Object.entries(samples)), [samples]);
  const evaluation = useMemo(
    () => evaluateRecipe(currentRecipe, sampleMap),
    [currentRecipe, sampleMap]
  );
  const selectedOutput =
    currentRecipe.outputs.find((output) => output.id === currentRecipe.view.selectedOutputId) ??
    currentRecipe.outputs[0];
  const lastStep = currentRecipe.steps[currentRecipe.steps.length - 1];
  const selectedValueId = selectedOutput?.valueId ?? lastStep?.id ?? currentRecipe.sources[0]?.id;
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

  const addSource = () => {
    const index = currentRecipe.sources.length + 1;
    const id = `input${index}`;
    setRecipeBase({
      ...currentRecipe,
      sources: [...currentRecipe.sources, { id, name: `INPUT_${index}`, width: 32 }],
    });
    setNewStepOperandId(id);
  };

  const addStep = () => {
    const id = `step${currentRecipe.steps.length + 1}`;
    const input = evaluation.values.get(newStepInputId);
    const step: IPCraftDataInspectorRecipe['steps'][number] = {
      id,
      type: newStepType,
      inputId: newStepInputId,
    };
    if (['concat', 'and', 'or', 'xor'].includes(newStepType)) {
      step.operandId = newStepOperandId;
    } else if (newStepType === 'slice') {
      step.msb = Math.max(0, (input?.value.width ?? 1) - 1);
      step.lsb = 0;
    } else if (['shiftLeft', 'shiftRight'].includes(newStepType)) {
      step.amount = 1;
    } else if (['zeroExtend', 'signExtend'].includes(newStepType)) {
      step.width = Math.min(4096, (input?.value.width ?? 1) + 1);
    } else if (newStepType === 'truncate') {
      step.width = Math.max(1, (input?.value.width ?? 2) - 1);
    }
    setRecipeBase({
      ...currentRecipe,
      steps: [...currentRecipe.steps, step],
      outputs: currentRecipe.outputs.map((output, index) =>
        index === 0 ? { ...output, valueId: id } : output
      ),
      view: { ...currentRecipe.view, selectedOutputId: currentRecipe.outputs[0]?.id },
    });
    setNewStepInputId(id);
  };

  const addPreset = (
    preset: 'hiLo' | 'maskShift' | 'slice' | 'extend' | 'truncate' | 'byteSwap'
  ) => {
    const inputId = newStepInputId || currentRecipe.sources[0]?.id;
    const operandId = newStepOperandId || currentRecipe.sources[1]?.id;
    const inputWidth = evaluation.values.get(inputId)?.value.width ?? 1;
    const start = currentRecipe.steps.length + 1;
    const steps: IPCraftDataInspectorRecipe['steps'] = [];
    if (preset === 'hiLo' && operandId) {
      steps.push({ id: `step${start}`, type: 'concat', inputId, operandId });
    } else if (preset === 'maskShift' && operandId) {
      steps.push({ id: `step${start}`, type: 'and', inputId, operandId });
      steps.push({
        id: `step${start + 1}`,
        type: 'shiftRight',
        inputId: `step${start}`,
        amount: 1,
      });
    } else if (preset === 'slice') {
      steps.push({ id: `step${start}`, type: 'slice', inputId, msb: inputWidth - 1, lsb: 0 });
    } else if (preset === 'extend') {
      steps.push({
        id: `step${start}`,
        type: 'zeroExtend',
        inputId,
        width: Math.min(4096, inputWidth + 1),
      });
    } else if (preset === 'truncate') {
      steps.push({
        id: `step${start}`,
        type: 'truncate',
        inputId,
        width: Math.max(1, inputWidth - 1),
      });
    } else if (preset === 'byteSwap') {
      steps.push({ id: `step${start}`, type: 'byteSwap', inputId });
    }
    if (steps.length === 0) {
      setError('This preset requires a second source');
      return;
    }
    const valueId = steps[steps.length - 1].id;
    setRecipeBase({
      ...currentRecipe,
      steps: [...currentRecipe.steps, ...steps],
      outputs: currentRecipe.outputs.map((output, index) =>
        index === 0 ? { ...output, valueId } : output
      ),
      view: { ...currentRecipe.view, selectedOutputId: currentRecipe.outputs[0]?.id },
    });
    setNewStepInputId(valueId);
    setError('');
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
    const source = currentRecipe.sources[0];
    const value = capture.samples[index]?.values.get(source?.name ?? 'INPUT');
    if (!source || !value) {
      return;
    }
    setSamples((current) => ({ ...current, [source.id]: value }));
    setVector(value);
    setCsvSampleIndex(index);
  };

  const addField = () => {
    if (!vector) {
      return;
    }
    const occupied = new Set(
      fields
        .filter((field) => field.groupId === 'default')
        .flatMap((field) =>
          Array.from({ length: field.msb - field.lsb + 1 }, (_, i) => field.lsb + i)
        )
    );
    let bit = vector.width - 1;
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
    setSelectedFieldId(id);
  };

  return (
    <main className="di-shell">
      <header className="di-topbar">
        <div>
          <span className="di-brand">IPCraft</span>
          <h1>{recipeFileName || 'Data Inspector'}</h1>
        </div>
        <div className="di-status">Session only · samples are never saved</div>
      </header>

      <nav className="di-mobile-tabs" aria-label="Data Inspector sections">
        {(['value', 'bits', 'sources', 'inspect'] as const).map((tab) => (
          <button
            className={mobileTab === tab ? 'is-active' : ''}
            key={tab}
            onClick={() => setMobileTab(tab)}
          >
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

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
              placeholder="64'h0001_2000_0000_3F00"
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
        {vector && (
          <div className="di-detection">
            <span>{vector.width} bits</span>
            <span>{vector.hasUnknown ? 'contains X/Z states' : 'all bits known'}</span>
            <span>rightmost digit maps to bit 0</span>
            <button
              className="di-copy"
              onClick={() => void navigator.clipboard.writeText(vector.toLiteral())}
            >
              Copy normalized
            </button>
            {originalText !== vector.toLiteral() && (
              <button
                className="di-copy"
                onClick={() => void navigator.clipboard.writeText(originalText)}
              >
                Copy original
              </button>
            )}
            <button
              className="di-copy"
              onClick={() => vscode?.postMessage({ type: 'saveRecipe', recipe: currentRecipe })}
            >
              Save as recipe…
            </button>
          </div>
        )}
      </section>

      {!vector ? (
        <section className="di-empty">
          <div className="di-empty__mark">[X:0]</div>
          <h2>Paste a waveform, capture, or register value</h2>
          <p>Binary, hexadecimal, decimal, Verilog, and VHDL literals are accepted exactly.</p>
        </section>
      ) : (
        <div className="di-workspace">
          <aside
            className={`di-card di-source-rail di-mobile-panel ${mobileTab === 'sources' ? 'is-mobile-active' : ''}`}
          >
            <span className="di-eyebrow">Physical input</span>
            <h2>Sources</h2>
            {currentRecipe.sources.map((source, index) => (
              <div className="di-source" key={source.id}>
                <span className="di-source__badge">{String.fromCharCode(65 + index)}</span>
                <div className="di-source__body">
                  <input
                    aria-label={`Source ${index + 1} name`}
                    className="di-source__name"
                    value={source.name}
                    onChange={(event) =>
                      setRecipeBase({
                        ...currentRecipe,
                        sources: currentRecipe.sources.map((candidate) =>
                          candidate.id === source.id
                            ? { ...candidate, name: event.target.value }
                            : candidate
                        ),
                      })
                    }
                  />
                  <label>
                    Width · transient sample
                    <input
                      type="number"
                      min={1}
                      max={4096}
                      value={source.width}
                      onChange={(event) =>
                        setRecipeBase({
                          ...currentRecipe,
                          sources: currentRecipe.sources.map((candidate) =>
                            candidate.id === source.id
                              ? { ...candidate, width: Number(event.target.value) }
                              : candidate
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="di-source__input">
                    <input
                      aria-label={`${source.name} value`}
                      placeholder={`${source.width}'h…`}
                      value={sourceDrafts[source.id] ?? ''}
                      onChange={(event) =>
                        setSourceDrafts((current) => ({
                          ...current,
                          [source.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      aria-label={`Decode ${source.name}`}
                      onClick={() => {
                        try {
                          const parsed = parseLiteral(sourceDrafts[source.id] ?? '', {
                            width: source.width,
                          });
                          setSamples((current) => ({ ...current, [source.id]: parsed.vector }));
                          if (index === 0) {
                            setVector(parsed.vector);
                          }
                          setError('');
                        } catch (sourceError) {
                          setError(
                            sourceError instanceof Error ? sourceError.message : String(sourceError)
                          );
                        }
                      }}
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {currentRecipe.outputs.length > 0 && (
              <div className="di-derived-outputs">
                <span className="di-eyebrow">Derived outputs</span>
                {currentRecipe.outputs.map((output) => (
                  <button
                    className={
                      currentRecipe.view.selectedOutputId === output.id ? 'is-selected' : ''
                    }
                    key={output.id}
                    onClick={() =>
                      setRecipeBase({
                        ...currentRecipe,
                        view: { ...currentRecipe.view, selectedOutputId: output.id },
                      })
                    }
                  >
                    {output.name} · {output.valueId}
                  </button>
                ))}
              </div>
            )}
            <button onClick={addSource}>Add source</button>
          </aside>

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
            onSelectField={setSelectedFieldId}
            provenance={evaluatedValue?.provenance}
            maskedBits={evaluatedValue?.maskedBits}
            zoom={zoom}
            onLaneWidthChange={setLaneWidth}
            onZoomChange={setZoom}
            mobileActive={mobileTab === 'bits'}
          />

          <section
            className={`di-card di-inspector di-mobile-panel ${mobileTab === 'inspect' ? 'is-mobile-active' : ''}`}
            aria-label="Inspector tools"
          >
            <nav className="di-inspector-tabs" aria-label="Inspector tool" role="tablist">
              {(['fields', 'capture', 'transform'] as const).map((tab) => (
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
                  {tab === 'fields' && fields.length > 0 ? ` ${fields.length}` : ''}
                  {tab === 'transform' && currentRecipe.steps.length > 0
                    ? ` ${currentRecipe.steps.length}`
                    : ''}
                </button>
              ))}
            </nav>

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
              <label>
                Import register layout
                <select value={layoutId} onChange={(event) => setLayoutId(event.target.value)}>
                  <option value="">Choose a register…</option>
                  {layouts.map((layout) => (
                    <option value={layout.id} key={layout.id}>
                      {layout.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!layoutId}
                onClick={() => {
                  const layout = layouts.find((candidate) => candidate.id === layoutId);
                  if (layout) {
                    setFields(layout.fields.map((field) => ({ ...field })));
                    setFieldProvenance(
                      Object.fromEntries(
                        layout.fields.map((field) => [
                          field.id,
                          { sourceFile: layout.sourceFile, registerName: layout.registerName },
                        ])
                      )
                    );
                    if (layout.width !== vector.width) {
                      setError(
                        `Copied ${layout.width}-bit register layout onto a ${vector.width}-bit value; out-of-range fields are flagged below`
                      );
                    }
                  }
                }}
              >
                Copy fields
              </button>
              <p className="di-note">
                Import is a one-way copy. The memory map is never modified or linked.
              </p>
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
                      onChange={(event) => applyVcdSample(vcdSelection, Number(event.target.value))}
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
                          setError(csvError instanceof Error ? csvError.message : String(csvError))
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
                          const source = currentRecipe.sources[0];
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
                          setError(csvError instanceof Error ? csvError.message : String(csvError));
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
                      onChange={(event) => applyCsvSample(csvCapture, Number(event.target.value))}
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
              aria-labelledby="di-inspector-tab-transform"
              className={`di-inspector-panel di-transform-panel ${inspectorTab === 'transform' ? 'is-active' : ''}`}
              id="di-inspector-panel-transform"
              role="tabpanel"
            >
              <div className="di-panel-heading">
                <span className="di-eyebrow">Compose derived values</span>
                <h2>Transform recipe</h2>
              </div>
              <div className="di-output-editor">
                {currentRecipe.outputs.map((output, index) => (
                  <div key={output.id}>
                    <input
                      aria-label={`Output ${index + 1} name`}
                      value={output.name}
                      onChange={(event) =>
                        setRecipeBase({
                          ...currentRecipe,
                          outputs: currentRecipe.outputs.map((candidate) =>
                            candidate.id === output.id
                              ? { ...candidate, name: event.target.value }
                              : candidate
                          ),
                        })
                      }
                    />
                    <select
                      aria-label={`Output ${index + 1} value`}
                      value={output.valueId}
                      onChange={(event) =>
                        setRecipeBase({
                          ...currentRecipe,
                          outputs: currentRecipe.outputs.map((candidate) =>
                            candidate.id === output.id
                              ? { ...candidate, valueId: event.target.value }
                              : candidate
                          ),
                        })
                      }
                    >
                      {[...currentRecipe.sources, ...currentRecipe.steps].map((value) => (
                        <option value={value.id} key={value.id}>
                          {value.id}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const index = currentRecipe.outputs.length + 1;
                    setRecipeBase({
                      ...currentRecipe,
                      outputs: [
                        ...currentRecipe.outputs,
                        { id: `output${index}`, name: `OUTPUT_${index}`, valueId: newStepInputId },
                      ],
                    });
                  }}
                >
                  Add output
                </button>
              </div>
              <div className="di-presets" aria-label="Transform presets">
                <span>Presets</span>
                <button onClick={() => addPreset('hiLo')}>HI/LO concat</button>
                <button onClick={() => addPreset('maskShift')}>Mask + shift</button>
                <button onClick={() => addPreset('slice')}>Slice</button>
                <button onClick={() => addPreset('extend')}>Extend</button>
                <button onClick={() => addPreset('truncate')}>Truncate</button>
                <button onClick={() => addPreset('byteSwap')}>Byte swap</button>
              </div>
              <div className="di-step-builder">
                <label>
                  Operation
                  <select
                    value={newStepType}
                    onChange={(event) =>
                      setNewStepType(
                        event.target.value as IPCraftDataInspectorRecipe['steps'][number]['type']
                      )
                    }
                  >
                    {[
                      'concat',
                      'slice',
                      'and',
                      'or',
                      'xor',
                      'not',
                      'shiftLeft',
                      'shiftRight',
                      'zeroExtend',
                      'signExtend',
                      'truncate',
                      'byteSwap',
                    ].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Input (high operand for concat)
                  <select
                    value={newStepInputId}
                    onChange={(event) => setNewStepInputId(event.target.value)}
                  >
                    {[
                      ...currentRecipe.sources.map((source) => source.id),
                      ...currentRecipe.steps.map((step) => step.id),
                    ].map((id) => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
                {['concat', 'and', 'or', 'xor'].includes(newStepType) && (
                  <label>
                    {newStepType === 'concat' ? 'Low operand' : 'Operand'}
                    <select
                      value={newStepOperandId}
                      onChange={(event) => setNewStepOperandId(event.target.value)}
                    >
                      {currentRecipe.sources.map((source) => (
                        <option key={source.id}>{source.id}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button onClick={addStep}>Add step</button>
              </div>
              <ol className="di-step-list">
                {currentRecipe.steps.map((step, index) => {
                  const result = evaluation.steps[index];
                  return (
                    <li key={step.id} className={result?.error ? 'is-error' : ''}>
                      <strong>{step.type}</strong>({step.inputId}
                      {step.operandId ? `, ${step.operandId}` : ''})
                      <small>{result?.error ?? result?.widthEquation ?? 'Waiting for input'}</small>
                      {result?.value && <code>{result.value.value.toLiteral()}</code>}
                      {result?.transform && result.transform.droppedRanges.length > 0 && (
                        <em>
                          Dropped{' '}
                          {result.transform.droppedRanges
                            .map((range) => `[${range.msb}:${range.lsb}]`)
                            .join(', ')}
                        </em>
                      )}
                      <div className="di-step-parameters">
                        {step.operandId !== undefined && (
                          <label>
                            Operand
                            <select
                              value={step.operandId}
                              onChange={(event) =>
                                updateStep(index, { operandId: event.target.value })
                              }
                            >
                              {[
                                ...currentRecipe.sources.map((source) => source.id),
                                ...currentRecipe.steps
                                  .slice(0, index)
                                  .map((candidate) => candidate.id),
                              ].map((id) => (
                                <option key={id}>{id}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {step.msb !== undefined && (
                          <label>
                            MSB
                            <input
                              type="number"
                              value={step.msb}
                              onChange={(event) =>
                                updateStep(index, { msb: Number(event.target.value) })
                              }
                            />
                          </label>
                        )}
                        {step.lsb !== undefined && (
                          <label>
                            LSB
                            <input
                              type="number"
                              value={step.lsb}
                              onChange={(event) =>
                                updateStep(index, { lsb: Number(event.target.value) })
                              }
                            />
                          </label>
                        )}
                        {step.amount !== undefined && (
                          <label>
                            Amount
                            <input
                              type="number"
                              min={0}
                              value={step.amount}
                              onChange={(event) =>
                                updateStep(index, { amount: Number(event.target.value) })
                              }
                            />
                          </label>
                        )}
                        {step.width !== undefined && (
                          <label>
                            Width
                            <input
                              type="number"
                              min={1}
                              max={4096}
                              value={step.width}
                              onChange={(event) =>
                                updateStep(index, { width: Number(event.target.value) })
                              }
                            />
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div
              aria-labelledby="di-inspector-tab-fields"
              className={`di-inspector-panel di-fields ${inspectorTab === 'fields' ? 'is-active' : ''}`}
              id="di-inspector-panel-fields"
              role="tabpanel"
            >
              <header className="di-section-header">
                <div>
                  <span className="di-eyebrow">Decoded ranges</span>
                  <h2 id="fields-heading">Fields</h2>
                </div>
                <button onClick={addField}>Add field</button>
              </header>
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
                      className={`di-field-row ${selectedFieldId === field.id ? 'is-selected' : ''} ${changed ? 'is-changed' : ''}`}
                      role="row"
                      key={field.id}
                      onClick={() => setSelectedFieldId(field.id)}
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
                      value={
                        fields.find((field) => field.id === selectedFieldId)?.groupId ?? 'default'
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
                          currentRecipe.fields.find((field) => field.id === selectedFieldId)
                            ?.display.fractionalBits ?? 0
                        }
                        onChange={(event) =>
                          updateSelectedFieldDisplay({ fractionalBits: Number(event.target.value) })
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
              {fields.length === 0 && (
                <p className="di-note">Define a field or copy a register layout.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
