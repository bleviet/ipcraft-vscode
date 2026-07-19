import React from 'react';
import { detectCsvCapturePreset, type CsvSignalMapping } from '../../dataInspector/csvCapture';
import type { CaptureImportState } from './hooks/useCaptureImport';

interface CapturePanelProps {
  active: boolean;
  capture: CaptureImportState;
  setError: (error: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CapturePanel({ active, capture, setError }: CapturePanelProps) {
  const preset = detectCsvCapturePreset(capture.csvHeaders);

  return (
    <div
      aria-labelledby="di-inspector-tab-capture"
      className={`di-inspector-panel di-capture-panel ${active ? 'is-active' : ''}`}
      id="di-inspector-panel-capture"
      role="tabpanel"
    >
      <div className="di-panel-heading">
        <span className="di-eyebrow">Bring in structure or samples</span>
        <h2>Capture</h2>
      </div>
      <details className="di-capture" open={capture.vcdCapture !== null}>
        <summary>VCD capture</summary>
        <label>
          VCD file
          <input
            type="file"
            accept=".vcd,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void file
                  .text()
                  .then(capture.loadVcdText)
                  .catch((error: unknown) => {
                    setError(errorText(error));
                  });
              }
            }}
          />
        </label>
        {capture.vcdCapture && (
          <div className="di-capture__signals">
            {capture.vcdCapture.signals.map((signal) => (
              <label key={signal.id}>
                <input
                  type="checkbox"
                  checked={capture.vcdSignalNames.includes(signal.name)}
                  onChange={(event) =>
                    capture.setVcdSignalNames((current) =>
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
              disabled={capture.vcdSignalNames.length === 0}
              onClick={() => {
                const selection = capture.vcdCapture!.selectSignals(capture.vcdSignalNames);
                capture.setVcdSelection(selection);
                capture.applyVcdSample(selection, 0);
              }}
            >
              Index selected signals
            </button>
          </div>
        )}
        {capture.vcdSelection && capture.vcdSample && (
          <div className="di-timeline">
            <button
              aria-label="Previous sample"
              disabled={capture.vcdSampleIndex === 0}
              onClick={() =>
                capture.applyVcdSample(capture.vcdSelection!, capture.vcdSampleIndex - 1)
              }
            >
              Previous
            </button>
            <input
              aria-label="Capture sample"
              type="range"
              min={0}
              max={capture.vcdSelection.sampleCount - 1}
              value={capture.vcdSampleIndex}
              onChange={(event) =>
                capture.applyVcdSample(capture.vcdSelection!, Number(event.target.value))
              }
            />
            <button
              aria-label="Next sample"
              disabled={capture.vcdSampleIndex === capture.vcdSelection.sampleCount - 1}
              onClick={() =>
                capture.applyVcdSample(capture.vcdSelection!, capture.vcdSampleIndex + 1)
              }
            >
              Next
            </button>
            <small>
              Sample {capture.vcdSampleIndex + 1} of {capture.vcdSelection.sampleCount} · time{' '}
              {capture.vcdSample.time.toString()} {capture.vcdCapture?.timescale}
            </small>
          </div>
        )}
      </details>
      <details className="di-capture" open={capture.csvText !== ''}>
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
                    .then(capture.loadCsvText)
                    .catch((error: unknown) => {
                      setError(errorText(error));
                    });
                }
              }}
            />
          </label>
          <button
            onClick={() =>
              void navigator.clipboard
                .readText()
                .then(capture.loadCsvText)
                .catch((error: unknown) => setError(errorText(error)))
            }
          >
            Paste CSV
          </button>
        </div>
        {capture.csvText && (
          <div className="di-csv-mapping">
            {preset && (
              <p className="di-note">
                Detected {preset === 'vivadoIla' ? 'Vivado ILA' : 'SignalTap'} export; metadata
                columns are excluded.
              </p>
            )}
            <label>
              Signal column
              <select
                value={capture.csvColumn}
                onChange={(event) => capture.setCsvColumn(event.target.value)}
              >
                {capture.csvHeaders.map((header) => (
                  <option key={header}>{header}</option>
                ))}
              </select>
            </label>
            <label>
              Radix
              <select
                value={capture.csvRadix}
                onChange={(event) =>
                  capture.setCsvRadix(event.target.value as CsvSignalMapping['radix'])
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
                value={capture.csvByteOrder}
                onChange={(event) =>
                  capture.setCsvByteOrder(event.target.value as CsvSignalMapping['byteOrder'])
                }
              >
                <option value="bigEndian">big endian</option>
                <option value="littleEndian">little endian</option>
              </select>
            </label>
            <label>
              Word order
              <select
                value={capture.csvWordOrder}
                onChange={(event) =>
                  capture.setCsvWordOrder(event.target.value as CsvSignalMapping['wordOrder'])
                }
              >
                <option value="highFirst">high word first</option>
                <option value="lowFirst">low word first</option>
              </select>
            </label>
            <label>
              Word width
              <select
                value={capture.csvWordWidth}
                onChange={(event) =>
                  capture.setCsvWordWidth(
                    Number(event.target.value) as CsvSignalMapping['wordWidth']
                  )
                }
              >
                {[8, 16, 32, 64].map((width) => (
                  <option key={width}>{width}</option>
                ))}
              </select>
            </label>
            <button onClick={capture.importCsvSamples}>Import samples</button>
          </div>
        )}
        {capture.csvCapture && (
          <div className="di-timeline">
            <button
              disabled={capture.csvSampleIndex === 0}
              onClick={() =>
                capture.applyCsvSample(capture.csvCapture!, capture.csvSampleIndex - 1)
              }
            >
              Previous
            </button>
            <input
              aria-label="CSV sample"
              type="range"
              min={0}
              max={capture.csvCapture.samples.length - 1}
              value={capture.csvSampleIndex}
              onChange={(event) =>
                capture.applyCsvSample(capture.csvCapture!, Number(event.target.value))
              }
            />
            <button
              disabled={capture.csvSampleIndex === capture.csvCapture.samples.length - 1}
              onClick={() =>
                capture.applyCsvSample(capture.csvCapture!, capture.csvSampleIndex + 1)
              }
            >
              Next
            </button>
            <small>
              Sample {capture.csvSampleIndex + 1} of {capture.csvCapture.samples.length}
            </small>
          </div>
        )}
      </details>
    </div>
  );
}
