import React, { useEffect, useId, useRef, useState } from 'react';
import type {
  ExportImageArea,
  ExportImageFormat,
  ExportImageOptions,
} from '../../../shared/messages/imageExport';
import './toolbar.css';

/** Which options an editor offers; the others are not shown. */
export interface ExportImageFeatures {
  /** The system viewer's legend. */
  legend: boolean;
  /** The name of the full drawing in the Area list: "Whole level" or "Whole diagram". */
  wholeLabel: string;
}

interface ExportImageButtonProps {
  options: ExportImageOptions;
  features: ExportImageFeatures;
  onOptionsChange: (options: ExportImageOptions) => void;
  /** The Export button: the editor sends the options with its view state. */
  onExport: (options: ExportImageOptions) => void;
  /** Rises each time the Export Diagram as Image command asks to open the popover. */
  openToken?: number;
}

const FORMATS: { value: ExportImageFormat; label: string }[] = [
  { value: 'svg', label: 'SVG' },
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
];

/**
 * The Export image toolbar button and its options popover, shared by the system viewer and the IP
 * core editor. Escape closes it and returns focus to the button; a click outside closes it.
 */
export const ExportImageButton: React.FC<ExportImageButtonProps> = ({
  options,
  features,
  onOptionsChange,
  onExport,
  openToken = 0,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLSelectElement>(null);
  const seenToken = useRef(openToken);
  const id = useId();

  useEffect(() => {
    if (openToken !== seenToken.current) {
      seenToken.current = openToken;
      setOpen(true);
    }
  }, [openToken]);

  useEffect(() => {
    if (!open) {
      return;
    }
    firstRef.current?.focus();
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const change = (patch: Partial<ExportImageOptions>) => {
    const next = { ...options, ...patch };
    // A JPG is always opaque.
    onOptionsChange(next.format === 'jpg' ? { ...next, background: 'editor' } : next);
  };
  const raster = options.format !== 'svg';

  return (
    <div ref={rootRef} className="export-image">
      <button
        ref={buttonRef}
        type="button"
        className={`canvas-view-toggle${open ? ' canvas-view-toggle--active' : ''}`}
        aria-label="Export image"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Export image: save the diagram as SVG, PNG or JPG"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className="codicon codicon-device-camera" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Export image options"
          className="export-image-popover"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <label className="export-image-row">
            Format
            <select
              ref={firstRef}
              value={options.format}
              onChange={(event) => change({ format: event.target.value as ExportImageFormat })}
            >
              {FORMATS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="export-image-row">
            Area
            <select
              value={options.area}
              onChange={(event) => change({ area: event.target.value as ExportImageArea })}
            >
              <option value="view">Current view</option>
              <option value="whole">{features.wholeLabel}</option>
            </select>
          </label>
          <label className="export-image-row">
            Scale
            <select
              value={options.scale}
              disabled={!raster}
              onChange={(event) => change({ scale: Number(event.target.value) })}
            >
              {[1, 2, 3, 4].map((scale) => (
                <option key={scale} value={scale}>
                  {scale}x
                </option>
              ))}
            </select>
          </label>
          <label className="export-image-row">
            Theme
            <select
              value={options.theme}
              onChange={(event) => change({ theme: event.target.value as 'light' | 'dark' })}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="export-image-row" htmlFor={`${id}-grid`}>
            Grid
            <input
              id={`${id}-grid`}
              type="checkbox"
              checked={options.grid}
              onChange={(event) => change({ grid: event.target.checked })}
            />
          </label>
          {features.legend && (
            <label className="export-image-row" htmlFor={`${id}-legend`}>
              Legend
              <input
                id={`${id}-legend`}
                type="checkbox"
                checked={options.legend}
                onChange={(event) => change({ legend: event.target.checked })}
              />
            </label>
          )}
          <label className="export-image-row">
            Background
            <select
              value={options.background}
              disabled={options.format === 'jpg'}
              onChange={(event) =>
                change({ background: event.target.value as 'editor' | 'transparent' })
              }
            >
              <option value="editor">Editor</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
          <button
            type="button"
            className="export-image-submit"
            onClick={() => {
              onExport(options);
              close();
            }}
          >
            Export
          </button>
        </div>
      )}
    </div>
  );
};
