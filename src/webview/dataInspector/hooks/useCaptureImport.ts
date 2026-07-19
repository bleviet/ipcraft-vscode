import { useState, type Dispatch, type SetStateAction } from 'react';
import { BitVector } from '../../../dataInspector/BitVector';
import {
  CsvCapture,
  csvSignalColumns,
  detectCsvCapturePreset,
  getCsvHeaders,
  type CsvSignalMapping,
} from '../../../dataInspector/csvCapture';
import { VcdCapture, VcdSelection, type VcdSample } from '../../../dataInspector/vcd';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';

interface CaptureImportOptions {
  activeSource: IPCraftDataInspectorRecipe['sources'][number] | undefined;
  currentRecipe: IPCraftDataInspectorRecipe;
  setError: (error: string) => void;
  setRecipeBase: (recipe: IPCraftDataInspectorRecipe) => void;
  setSamples: Dispatch<SetStateAction<Record<string, BitVector>>>;
  setVector: (vector: BitVector | null) => void;
  setWidthDraft: (width: string) => void;
}

export function useCaptureImport({
  activeSource,
  currentRecipe,
  setError,
  setRecipeBase,
  setSamples,
  setVector,
  setWidthDraft,
}: CaptureImportOptions) {
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
    if (nextSources[0]) {
      setWidthDraft(String(nextSources[0].width));
    }
    setVcdSampleIndex(index);
    setVcdSample(sample);
  };

  const loadVcdText = (text: string) => {
    try {
      const capture = VcdCapture.parse(text);
      setVcdCapture(capture);
      setVcdSignalNames(capture.signals.slice(0, 1).map((signal) => signal.name));
      setError('');
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    }
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
    const value = capture.samples[index]?.values.get(activeSource?.name ?? 'INPUT');
    if (!activeSource || !value) {
      return;
    }
    setSamples((current) => ({ ...current, [activeSource.id]: value }));
    if (activeSource.id === currentRecipe.sources[0]?.id) {
      setVector(value);
    }
    setCsvSampleIndex(index);
  };

  const importCsvSamples = () => {
    if (!activeSource) {
      return;
    }
    try {
      const capture = CsvCapture.parse(csvText, [
        {
          name: activeSource.name,
          column: csvColumn,
          radix: csvRadix,
          width: activeSource.width,
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
  };

  return {
    applyCsvSample,
    applyVcdSample,
    csvByteOrder,
    csvCapture,
    csvColumn,
    csvHeaders,
    csvRadix,
    csvSampleIndex,
    csvText,
    csvWordOrder,
    csvWordWidth,
    importCsvSamples,
    loadCsvText,
    loadVcdText,
    setCsvByteOrder,
    setCsvColumn,
    setCsvRadix,
    setCsvWordOrder,
    setCsvWordWidth,
    setVcdCapture,
    setVcdSelection,
    setVcdSignalNames,
    vcdCapture,
    vcdSample,
    vcdSampleIndex,
    vcdSelection,
    vcdSignalNames,
  };
}

export type CaptureImportState = ReturnType<typeof useCaptureImport>;
