export interface LaneRange {
  laneIndex: number;
  laneMsb: number;
  laneLsb: number;
}

export interface FieldSegment extends LaneRange {
  segmentMsb: number;
  segmentLsb: number;
  startFraction: number;
  widthFraction: number;
}

export function normalizeFieldRange(field: {
  bitRange?: [number, number];
  bit?: number;
}): { lo: number; hi: number } | null {
  if (field.bitRange?.length === 2) {
    const hi = Number(field.bitRange[0]);
    const lo = Number(field.bitRange[1]);
    return Number.isFinite(hi) && Number.isFinite(lo)
      ? { lo: Math.min(lo, hi), hi: Math.max(lo, hi) }
      : null;
  }
  if (field.bit !== undefined) {
    const bit = Number(field.bit);
    return Number.isFinite(bit) ? { lo: bit, hi: bit } : null;
  }
  return null;
}

export function rangeToLaneFractions(
  laneMsb: number,
  laneLsb: number,
  segmentMsb: number,
  segmentLsb: number
): { startFraction: number; widthFraction: number } {
  const visibleLaneWidth = laneMsb - laneLsb + 1;
  return {
    startFraction: (laneMsb - segmentMsb) / visibleLaneWidth,
    widthFraction: (segmentMsb - segmentLsb + 1) / visibleLaneWidth,
  };
}

export function getLaneRange(width: number, laneWidth: number, laneIndex: number): LaneRange {
  if (
    !Number.isInteger(laneWidth) ||
    laneWidth <= 0 ||
    !Number.isInteger(laneIndex) ||
    laneIndex < 0
  ) {
    throw new RangeError('Lane width must be positive and lane index must be non-negative');
  }
  const laneMsb = width - 1 - laneIndex * laneWidth;
  if (laneMsb < 0) {
    throw new RangeError(`Lane ${laneIndex} is outside the ${width}-bit vector`);
  }
  return { laneIndex, laneMsb, laneLsb: Math.max(0, laneMsb - laneWidth + 1) };
}

/** Splits one logical field into MSB-first lane segments without changing its bit range. */
export function segmentFieldAcrossLanes(
  width: number,
  laneWidth: number,
  fieldMsb: number,
  fieldLsb: number
): FieldSegment[] {
  if (fieldLsb < 0 || fieldMsb < fieldLsb || fieldMsb >= width) {
    throw new RangeError(`Field [${fieldMsb}:${fieldLsb}] is outside [${width - 1}:0]`);
  }
  const laneCount = Math.ceil(width / laneWidth);
  const segments: FieldSegment[] = [];
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
    const lane = getLaneRange(width, laneWidth, laneIndex);
    const segmentMsb = Math.min(fieldMsb, lane.laneMsb);
    const segmentLsb = Math.max(fieldLsb, lane.laneLsb);
    if (segmentMsb < segmentLsb) {
      continue;
    }
    const fractions = rangeToLaneFractions(lane.laneMsb, lane.laneLsb, segmentMsb, segmentLsb);
    segments.push({
      ...lane,
      segmentMsb,
      segmentLsb,
      ...fractions,
    });
  }
  return segments;
}
