/**
 * Reader for the rows of a flat Vivado `report_utilization` table:
 * `| <label> | Used | Fixed | Prohibited | Available | Util% |`. Columns are found
 * by the text of the header row above the row, never by position, because the
 * column set differs between Vivado versions.
 */

export interface VivadoFlatRow {
  used: number;
  /** Absent when the row has no numeric Available cell (or no header above it). */
  available?: number;
  /** The Util% cell; a leading `<` (`<0.01`) is dropped. */
  utilPct?: number;
}

function splitRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return undefined;
  }
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function toNumber(cell: string | undefined): number | undefined {
  if (cell === undefined) {
    return undefined;
  }
  const value = Number(cell.replace(/,/g, '').replace(/^</, ''));
  return cell.trim() === '' || Number.isNaN(value) ? undefined : value;
}

/**
 * The first row, in report order, whose label is one of `labels` (a trailing `*`
 * is ignored) and whose Used cell is a number.
 */
export function readVivadoFlatRow(
  text: string,
  labels: readonly string[]
): VivadoFlatRow | undefined {
  let header: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells) {
      continue;
    }
    const names = cells.map((cell) => cell.toLowerCase());
    if (names.includes('used') && names.includes('available')) {
      header = names;
      continue;
    }
    if (!labels.includes(cells[0].replace(/\*$/, ''))) {
      continue;
    }
    const used = toNumber(cells[header ? header.indexOf('used') : 1]);
    if (used === undefined) {
      continue;
    }
    const available = header ? toNumber(cells[header.indexOf('available')]) : undefined;
    const utilPct = header ? toNumber(cells[header.indexOf('util%')]) : undefined;
    return {
      used,
      ...(available !== undefined && { available }),
      ...(utilPct !== undefined && { utilPct }),
    };
  }
  return undefined;
}
