import type { ResolvedCount, ResolvedField, ResolvedFormat } from './types';

/** One colored segment of a beat lane; `leftPct`/`widthPct` are relative to the lane width, MSB at the left. */
export interface LaneSegment {
  name: string;
  path: string;
  type: string;
  msb: number;
  lsb: number;
  leftPct: number;
  widthPct: number;
  /** Stable palette slot (0..PALETTE_SIZE-1) so neighbours differ. */
  colorIndex: number;
  label: string;
  /** Only part of the field lies in this lane (the field was split by `wrapLane`). */
  partial?: boolean;
}

export interface Lane {
  signal: string;
  /** Number of bits the lane spans (the scale of `leftPct`/`widthPct`). */
  width: number;
  /** Signal bit of the lane's right edge; non-zero for the upper rows of a wrapped lane. */
  lsb?: number;
  segments: LaneSegment[];
}

export interface BeatLanes {
  section: string;
  count: string;
  lanes: Lane[];
}

export const PALETTE_SIZE = 6;

export function countText(count: ResolvedCount): string {
  if (typeof count === 'number') {
    return `${count} beat${count === 1 ? '' : 's'}`;
  }
  if (count === 'untilLast') {
    return 'until TLAST';
  }
  const per = count.perBeat === 1 ? '' : ` x ${count.perBeat}/beat`;
  return `${count.field}${per}${count.add ? ` + ${count.add}` : ''}`;
}

/** Bit range label such as `[7:0]` or `[3]`. */
export function bitRange(msb: number, lsb: number): string {
  return msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`;
}

/** Geometry of one signal row. `data` spans the format's dataWidth; other signals span their highest used bit. */
export function laneOf(signal: string, fields: readonly ResolvedField[], dataWidth: number): Lane {
  const top = fields.reduce((m, f) => Math.max(m, f.lsb + f.width), 0);
  // The data signal (Avalon-ST `data`, AXI4-Stream `TDATA`) spans the full dataWidth, sidebands only their fields.
  const width = Math.max(/^t?data$/i.test(signal) ? dataWidth : top, top, 1);
  const segments = [...fields]
    .sort((a, b) => b.lsb - a.lsb)
    .map((f, i): LaneSegment => {
      const msb = f.lsb + f.width - 1;
      return {
        name: f.name,
        path: f.path,
        type: f.type,
        msb,
        lsb: f.lsb,
        leftPct: ((width - 1 - msb) / width) * 100,
        widthPct: (f.width / width) * 100,
        colorIndex: i % PALETTE_SIZE,
        label: `${f.path} ${bitRange(msb, f.lsb)}`,
      };
    });
  return { signal, width, segments };
}

/**
 * Splits a lane wider than `rowBits` into rows of `rowBits` bits, lowest row first, all on the same scale. A field that
 * crosses a row boundary becomes one `partial` segment per row with the same color.
 */
export function wrapLane(lane: Lane, rowBits: number): Lane[] {
  if (rowBits <= 0 || lane.width <= rowBits) {
    return [lane];
  }
  const rows: Lane[] = [];
  for (let lo = 0; lo < lane.width; lo += rowBits) {
    const hi = lo + rowBits - 1;
    const segments = lane.segments.flatMap((s): LaneSegment[] => {
      const msb = Math.min(s.msb, hi);
      const lsb = Math.max(s.lsb, lo);
      if (msb < lsb) {
        return [];
      }
      return [
        {
          ...s,
          msb,
          lsb,
          leftPct: ((hi - msb) / rowBits) * 100,
          widthPct: ((msb - lsb + 1) / rowBits) * 100,
          partial: msb !== s.msb || lsb !== s.lsb,
        },
      ];
    });
    rows.push({ signal: lane.signal, width: rowBits, lsb: lo, segments });
  }
  return rows;
}

/** Lane view model of every beat section of a resolved format; `wrapBits` splits wider lanes into rows. */
export function buildLanes(format: ResolvedFormat, wrapBits = 0): BeatLanes[] {
  return format.beats.map((section) => ({
    section: section.name,
    count: countText(section.count),
    lanes: Object.entries(section.signals).flatMap(([signal, fields]) =>
      wrapLane(laneOf(signal, fields, format.dataWidth), wrapBits)
    ),
  }));
}
