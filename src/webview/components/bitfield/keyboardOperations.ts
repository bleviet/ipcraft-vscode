import type { FieldModel } from '../BitFieldVisualizer';
import {
  buildProLayoutSegments,
  findResizeBoundary,
  getFieldRange,
  repackSegments,
  toFieldRangeUpdates,
} from './utils';

export function getKeyboardReorderUpdates(
  fields: FieldModel[],
  registerSize: number,
  fieldIndex: number,
  direction: 'msb' | 'lsb'
): { idx: number; range: [number, number] }[] | null {
  const segments = buildProLayoutSegments(fields, registerSize);
  const sourceIndex = segments.findIndex(
    (segment) => segment.type === 'field' && segment.idx === fieldIndex
  );
  if (sourceIndex === -1) {
    return null;
  }

  const targetIndex = direction === 'msb' ? sourceIndex - 1 : sourceIndex + 1;
  if (targetIndex < 0 || targetIndex >= segments.length) {
    return null;
  }

  const reordered = [...segments];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);

  return toFieldRangeUpdates(repackSegments(reordered));
}

export function getKeyboardResizeRange(
  fields: FieldModel[],
  registerSize: number,
  fieldIndex: number,
  edge: 'msb' | 'lsb'
): [number, number] | null {
  const range = getFieldRange(fields[fieldIndex]);
  if (!range) {
    return null;
  }

  let newLo = range.lo;
  let newHi = range.hi;

  if (edge === 'msb') {
    const maxMsb = findResizeBoundary(fieldIndex, 'msb', fields, registerSize);
    if (range.hi < maxMsb) {
      newHi = range.hi + 1;
    } else if (range.hi > range.lo) {
      newHi = range.hi - 1;
    }
  } else {
    const minLsb = findResizeBoundary(fieldIndex, 'lsb', fields, registerSize);
    if (range.lo > minLsb) {
      newLo = range.lo - 1;
    } else if (range.hi > range.lo) {
      newLo = range.lo + 1;
    }
  }

  if (newHi === range.hi && newLo === range.lo) {
    return null;
  }

  return [newHi, newLo];
}
