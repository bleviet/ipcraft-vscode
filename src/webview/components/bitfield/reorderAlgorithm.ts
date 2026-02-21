import type { FieldModel } from '../BitFieldVisualizer';
import type { ProSegment } from './types';
import { buildProLayoutSegments, repackSegments } from './utils';

export interface ReorderPreview {
  segments: ProSegment[];
  updates: { idx: number; range: [number, number] }[];
}

export function computeCtrlDragPreview(
  bit: number,
  draggedFieldIndex: number,
  fields: FieldModel[],
  registerSize: number
): ReorderPreview | null {
  const originalSegments = buildProLayoutSegments(fields, registerSize);
  const draggedSegIndex = originalSegments.findIndex(
    (segment) => segment.type === 'field' && segment.idx === draggedFieldIndex
  );
  if (draggedSegIndex === -1) {
    return null;
  }

  const draggedSegment = originalSegments[draggedSegIndex];
  if (draggedSegment.type !== 'field') {
    return null;
  }

  const cleanSegments = [...originalSegments];
  cleanSegments.splice(draggedSegIndex, 1);

  let currentBit = 0;
  const repackedClean = cleanSegments
    .slice()
    .reverse()
    .map((segment) => {
      const width = segment.end - segment.start + 1;
      const newLo = currentBit;
      const newHi = currentBit + width - 1;
      currentBit += width;
      return { ...segment, start: newLo, end: newHi, width };
    })
    .reverse();

  const effectiveCursor = Math.min(bit, currentBit);
  const targetIndex = repackedClean.findIndex(
    (segment) => effectiveCursor >= segment.start && effectiveCursor <= segment.end
  );

  const nextSegments: ProSegment[] = [];
  const insertDragged = () => {
    nextSegments.push(draggedSegment);
  };

  if (targetIndex === -1) {
    insertDragged();
    nextSegments.push(...cleanSegments);
  } else {
    const target = repackedClean[targetIndex];
    const originalTarget = cleanSegments[targetIndex];
    const offsetInTarget = effectiveCursor - target.start;

    if (target.type === 'field') {
      const targetWidth = target.end - target.start + 1;
      const insertOnMsbSide = offsetInTarget > targetWidth / 2;
      const before = cleanSegments.slice(0, targetIndex);
      const after = cleanSegments.slice(targetIndex + 1);

      nextSegments.push(...before);
      if (insertOnMsbSide) {
        insertDragged();
        nextSegments.push(originalTarget);
      } else {
        nextSegments.push(originalTarget);
        insertDragged();
      }
      nextSegments.push(...after);
    } else {
      const lowerWidth = offsetInTarget;
      const targetWidth = target.end - target.start + 1;
      const upperWidth = targetWidth - offsetInTarget;
      const before = cleanSegments.slice(0, targetIndex);
      const after = cleanSegments.slice(targetIndex + 1);

      nextSegments.push(...before);
      if (upperWidth > 0) {
        nextSegments.push({ type: 'gap', start: 0, end: upperWidth - 1 });
      }

      insertDragged();

      if (lowerWidth > 0) {
        nextSegments.push({ type: 'gap', start: 0, end: lowerWidth - 1 });
      }
      nextSegments.push(...after);
    }
  }

  const finalSegments = repackSegments(nextSegments);
  const updates = finalSegments
    .filter(
      (segment): segment is Extract<ProSegment, { type: 'field' }> => segment.type === 'field'
    )
    .map((segment) => ({
      idx: segment.idx,
      range: [segment.end, segment.start] as [number, number],
    }));

  return { segments: finalSegments, updates };
}
