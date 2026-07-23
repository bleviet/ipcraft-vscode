import React, { useEffect, useRef, useState } from 'react';
import { BitVector } from '../../dataInspector/BitVector';
import type { ProvenanceBit } from '../../dataInspector/evaluateRecipe';
import {
  getLaneRange,
  rangeToLaneFractions,
  segmentFieldAcrossLanes,
} from '../../dataInspector/fieldGeometry';
import type { InspectorField, ProjectedInspectorField } from '../../dataInspector/fieldLayout';

const LANE_HEIGHT = 74;
const COMPACT_LANE_HEIGHT = 54;

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
  const hasInsertedBits = provenance?.some((bit) => bit === null) ?? false;
  const showFieldOverlay = fields.length > 0 || hasInsertedBits;
  const laneHeight = showFieldOverlay ? LANE_HEIGHT : COMPACT_LANE_HEIGHT;
  const overscan = 2;
  const start = Math.max(0, Math.floor(scrollTop / laneHeight) - overscan);
  const end = Math.min(laneCount, Math.ceil((scrollTop + viewportHeight) / laneHeight) + overscan);

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
    viewportRef.current?.scrollTo({ top: next * laneHeight, behavior: 'smooth' });
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
        className={`di-lane ${showFieldOverlay ? '' : 'is-compact'} ${
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
              {provenance ? (
                sourceSegments.map((segment) => (
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
                      : sourceSegments.length === 1
                        ? segment.sourceId
                        : `${segment.sourceId} [${segment.msb}:${segment.lsb}]`}
                  </span>
                ))
              ) : (
                <span className="di-source-band__fallback">input</span>
              )}
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
            {showFieldOverlay && (
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
            )}
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
        <div style={{ height: laneCount * laneHeight, position: 'relative' }}>
          <div style={{ position: 'absolute', insetInline: 0, top: start * laneHeight }}>
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
