export interface TableRowWrapper<T> {
  rowId: string;
  model: T;
}

let nextId = 1;

export function resetRowIdCounter(): void {
  nextId = 1;
}

export function generateRowId(): string {
  return `row-${nextId++}`;
}

export function reconcileRowIds<T extends { name?: unknown }>(
  prev: Array<TableRowWrapper<T>> | undefined,
  next: T[]
): Array<TableRowWrapper<T>> {
  prev ??= [];

  const result: Array<{ rowId: string; model: T | null }> = next.map((model) => ({
    rowId: '',
    model,
  }));

  const consumedPrevIndices = new Set<number>();
  const matchedNextIndices = new Set<number>();

  // Pass 1: Exact content match against an unconsumed previous row -> keep its id.
  for (let nextIdx = 0; nextIdx < next.length; nextIdx++) {
    const nextItem = next[nextIdx];
    const nextJson = JSON.stringify(nextItem);
    for (let prevIdx = 0; prevIdx < prev.length; prevIdx++) {
      if (consumedPrevIndices.has(prevIdx)) {
        continue;
      }
      if (JSON.stringify(prev[prevIdx].model) === nextJson) {
        result[nextIdx].rowId = prev[prevIdx].rowId;
        consumedPrevIndices.add(prevIdx);
        matchedNextIndices.add(nextIdx);
        break;
      }
    }
  }

  // Pass 2: Same index + same name -> keep id (covers value edits).
  for (let nextIdx = 0; nextIdx < next.length; nextIdx++) {
    if (matchedNextIndices.has(nextIdx)) {
      continue;
    }
    const nextItem = next[nextIdx];
    const prevAtIndex = prev[nextIdx];
    if (prevAtIndex && !consumedPrevIndices.has(nextIdx)) {
      if (prevAtIndex.model.name === nextItem.name) {
        result[nextIdx].rowId = prevAtIndex.rowId;
        consumedPrevIndices.add(nextIdx);
        matchedNextIndices.add(nextIdx);
      }
    }
  }

  // Pass 3: Same name elsewhere (unconsumed) -> keep id (covers moves).
  for (let nextIdx = 0; nextIdx < next.length; nextIdx++) {
    if (matchedNextIndices.has(nextIdx)) {
      continue;
    }
    const nextItem = next[nextIdx];
    if (nextItem.name !== undefined && nextItem.name !== null) {
      for (let prevIdx = 0; prevIdx < prev.length; prevIdx++) {
        if (consumedPrevIndices.has(prevIdx)) {
          continue;
        }
        if (prev[prevIdx].model.name === nextItem.name) {
          result[nextIdx].rowId = prev[prevIdx].rowId;
          consumedPrevIndices.add(prevIdx);
          matchedNextIndices.add(nextIdx);
          break;
        }
      }
    }
  }

  // Pass 4: Same index (unconsumed) -> keep id (covers renames/in-place edits).
  for (let nextIdx = 0; nextIdx < next.length; nextIdx++) {
    if (matchedNextIndices.has(nextIdx)) {
      continue;
    }
    const prevAtIndex = prev[nextIdx];
    if (prevAtIndex && !consumedPrevIndices.has(nextIdx)) {
      result[nextIdx].rowId = prevAtIndex.rowId;
      consumedPrevIndices.add(nextIdx);
      matchedNextIndices.add(nextIdx);
    }
  }

  // Pass 5: Otherwise -> new id (covers inserts).
  for (let nextIdx = 0; nextIdx < next.length; nextIdx++) {
    if (matchedNextIndices.has(nextIdx)) {
      continue;
    }
    result[nextIdx].rowId = generateRowId();
  }

  if (prev.length === result.length) {
    let identical = true;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].rowId !== result[i].rowId || prev[i].model !== result[i].model) {
        identical = false;
        break;
      }
    }
    if (identical) {
      return prev;
    }
  }

  return result as Array<{ rowId: string; model: T }>;
}
