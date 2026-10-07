import { diffArrays } from 'diff';
import { parseDocument, type Document } from 'yaml';
import { detectIndentSeq } from './detectIndentSeq';
import { collectHexSpellings, restoreHexSpellings } from './restoreHexSpellings';

interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** Line hunks turning `a` into `b`, as replacements of `a[start, end)`. */
function hunks(a: string[], b: string[]): Hunk[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const out: Hunk[] = [];
  let index = head;
  let current: Hunk | undefined;
  for (const change of diffArrays(a.slice(head, a.length - tail), b.slice(head, b.length - tail))) {
    if (!change.added && !change.removed) {
      index += change.value.length;
      current = undefined;
      continue;
    }
    if (!current) {
      current = { start: index, end: index, lines: [] };
      out.push(current);
    }
    if (change.removed) {
      index += change.value.length;
      current.end = index;
    } else {
      current.lines.push(...change.value);
    }
  }
  return out;
}

/** Max lines either side that a formatting-only region may span before we give up. */
const RESYNC_WINDOW = 64;

/**
 * Near-linear alignment of the baseline against the original text. Reformatting is local, so
 * after a mismatch we look for the nearest equal non-blank line (or pair of equal lines, for
 * blanks) within a bounded window. Without an anchor in the window, the rest of the input becomes one region.
 */
function reformatHunks(a: string[], b: string[]): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    let found: [number, number] | undefined;
    for (let k = 1; k <= 2 * RESYNC_WINDOW && !found; k++) {
      for (let di = Math.max(0, k - RESYNC_WINDOW); di <= Math.min(k, RESYNC_WINDOW); di++) {
        const dj = k - di;
        if (
          i + di < a.length &&
          j + dj < b.length &&
          a[i + di] === b[j + dj] &&
          (a[i + di].trim() !== '' || a[i + di + 1] === b[j + dj + 1])
        ) {
          found = [di, dj];
          break;
        }
      }
    }
    if (!found) {
      // No anchor within the window: treat the remainder as one formatting region.
      break;
    }
    out.push({ start: i, end: i + found[0], lines: b.slice(j, j + found[1]) });
    i += found[0];
    j += found[1];
  }
  if (i < a.length || j < b.length) {
    out.push({ start: i, end: a.length, lines: b.slice(j) });
  }
  return out;
}

function overlaps(reformat: Hunk, edit: Hunk): boolean {
  return edit.start < reformat.end && edit.end > reformat.start;
}

function hasData(merged: string, doc: Document): boolean {
  const parsed = parseDocument(merged);
  return parsed.errors.length === 0 && JSON.stringify(parsed.toJS()) === JSON.stringify(doc.toJS());
}

/**
 * Serialise an edited document back to text. `yaml` re-renders every node in its own style
 * (flow padding, folded scalars), so a plain `doc.toString()` also reformats untouched nodes.
 * We render the unedited document too (`baseline`) and three-way merge by lines: regions where
 * the original text differs from the baseline are formatting only, and keep the original lines
 * unless an edit hunk touches them; everything else is the edited output. If the merge does
 * not parse to the same data as the edited document, the plain output wins.
 */
export function serializeEdit(text: string, doc: Document, hexFix: Map<string, string>): string {
  // lineWidth: 0 disables line folding. The pre-V-2 serializer used the `yaml`
  // default (80), which silently re-wraps any scalar longer than 80 columns -
  // reflowing untouched long descriptions and breaking the "one edit, one changed
  // line" goal (pinned by the "long untouched line" test in yamledit.test.ts).
  const opts = { indentSeq: detectIndentSeq(text), lineWidth: 0 };
  const edited = restoreHexSpellings(doc.toString(opts), hexFix);
  const base = parseDocument(text);
  const baseline = restoreHexSpellings(base.toString(opts), collectHexSpellings(base));
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const original = text.replace(/\r\n/g, '\n');
  const withEol = (value: string): string => (eol === '\n' ? value : value.replace(/\n/g, eol));
  if (baseline === original) {
    return withEol(edited);
  }

  const baseLines = baseline.split('\n');
  const edits = hunks(baseLines, edited.split('\n'));
  const keptFormatting = reformatHunks(baseLines, original.split('\n')).filter(
    (reformat) => !edits.some((edit) => overlaps(reformat, edit))
  );
  const ops = [...keptFormatting, ...edits].sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: string[] = [];
  let pos = 0;
  for (const op of ops) {
    merged.push(...baseLines.slice(pos, op.start), ...op.lines);
    pos = Math.max(pos, op.end);
  }
  merged.push(...baseLines.slice(pos));

  let result = merged.join('\n');
  if (edited.endsWith('\n') && !result.endsWith('\n')) {
    result += '\n';
  }
  return withEol(hasData(result, doc) ? result : edited);
}
