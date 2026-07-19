import { useState } from 'react';
import { BitVector } from '../../../dataInspector/BitVector';
import { formatValue, type ValueRepresentation } from '../../../dataInspector/formatValue';
import { parseLiteral } from '../../../dataInspector/parseLiteral';

const DEFAULT_VECTOR = BitVector.fromBigInt(BigInt(0), 32);

export function useValueInput(primarySourceId: string) {
  const [draft, setDraft] = useState('0');
  const [widthDraft, setWidthDraft] = useState('32');
  const [vector, setVector] = useState<BitVector | null>(DEFAULT_VECTOR);
  const [valueRepresentation, setValueRepresentation] = useState<ValueRepresentation>('hex');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, BitVector>>({ input: DEFAULT_VECTOR });
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({ input: '0' });
  const [sourceOriginalTexts, setSourceOriginalTexts] = useState<Record<string, string>>({
    input: '0',
  });

  const parseValue = (literal: string, literalWidth = widthDraft) => {
    try {
      const parsed = parseLiteral(literal, {
        width: literalWidth === '' ? undefined : Number(literalWidth),
      });
      const normalizedText = formatValue(parsed.vector, valueRepresentation);
      setDraft(normalizedText);
      setVector(parsed.vector);
      setSamples((current) => ({ ...current, [primarySourceId]: parsed.vector }));
      setSourceDrafts((current) => ({ ...current, [primarySourceId]: normalizedText }));
      setSourceOriginalTexts((current) => ({
        ...current,
        [primarySourceId]: parsed.originalText,
      }));
      setWarnings(parsed.warnings);
      setError('');
      if (literalWidth === '') {
        setWidthDraft(String(parsed.vector.width));
      }
      return true;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
      return false;
    }
  };

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

  const clearValue = () => {
    setDraft('');
    setWidthDraft('');
    setVector(null);
    setSamples({});
    setSourceOriginalTexts({});
    setError('');
    setWarnings([]);
  };

  return {
    changeValueRepresentation,
    clearValue,
    draft,
    error,
    parseValue,
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
  };
}

export type ValueInputState = ReturnType<typeof useValueInput>;
