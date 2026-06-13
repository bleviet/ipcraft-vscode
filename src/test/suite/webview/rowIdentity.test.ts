import { reconcileRowIds, resetRowIdCounter } from '../../../webview/utils/rowIdentity';

interface MockItem {
  name: string;
  value?: number;
}

describe('rowIdentity — reconcileRowIds', () => {
  beforeEach(() => {
    resetRowIdCounter();
  });

  it('assigns new ids to initial rows', () => {
    const next: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const result = reconcileRowIds(undefined, next);

    expect(result).toHaveLength(2);
    expect(result[0].rowId).toBe('row-1');
    expect(result[0].model).toEqual({ name: 'A' });
    expect(result[1].rowId).toBe('row-2');
    expect(result[1].model).toEqual({ name: 'B' });
  });

  it('keeps ids for exact content matches', () => {
    const initial: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const firstResult = reconcileRowIds(undefined, initial);

    const next: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const secondResult = reconcileRowIds(firstResult, next);

    expect(secondResult[0].rowId).toBe('row-1');
    expect(secondResult[1].rowId).toBe('row-2');
  });

  it('keeps ids for index + name match on value edit', () => {
    const initial: MockItem[] = [{ name: 'A', value: 10 }, { name: 'B' }];
    const firstResult = reconcileRowIds(undefined, initial);

    const next: MockItem[] = [{ name: 'A', value: 20 }, { name: 'B' }];
    const secondResult = reconcileRowIds(firstResult, next);

    expect(secondResult[0].rowId).toBe('row-1');
    expect(secondResult[0].model.value).toBe(20);
    expect(secondResult[1].rowId).toBe('row-2');
  });

  it('keeps ids for moves (same name elsewhere)', () => {
    const initial: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const firstResult = reconcileRowIds(undefined, initial);

    const next: MockItem[] = [{ name: 'B' }, { name: 'A' }];
    const secondResult = reconcileRowIds(firstResult, next);

    expect(secondResult[0].rowId).toBe('row-2');
    expect(secondResult[1].rowId).toBe('row-1');
  });

  it('assigns new ids for inserted rows and retires deleted row ids', () => {
    const initial: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const firstResult = reconcileRowIds(undefined, initial);

    // Delete B: [{ name: 'A' }]
    const deletedResult = reconcileRowIds(firstResult, [{ name: 'A' }]);
    expect(deletedResult).toHaveLength(1);
    expect(deletedResult[0].rowId).toBe('row-1');

    // Insert C at index 1: [{ name: 'A' }, { name: 'C' }]
    const insertedResult = reconcileRowIds(deletedResult, [{ name: 'A' }, { name: 'C' }]);
    expect(insertedResult).toHaveLength(2);
    expect(insertedResult[0].rowId).toBe('row-1');
    expect(insertedResult[1].rowId).toBe('row-3'); // row-3 is new, row-2 is retired
  });

  it('keeps id on rename/in-place edit via index fallback', () => {
    const initial: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const firstResult = reconcileRowIds(undefined, initial);

    const next: MockItem[] = [{ name: 'A' }, { name: 'C' }];
    const secondResult = reconcileRowIds(firstResult, next);

    expect(secondResult[0].rowId).toBe('row-1');
    expect(secondResult[1].rowId).toBe('row-2'); // keeps row-2
  });

  it('handles duplicate names correctly without cross-talk', () => {
    const initial: MockItem[] = [
      { name: 'A', value: 1 },
      { name: 'A', value: 2 },
    ];
    const firstResult = reconcileRowIds(undefined, initial);

    expect(firstResult[0].rowId).toBe('row-1');
    expect(firstResult[1].rowId).toBe('row-2');

    // Rename second A to B
    const next: MockItem[] = [
      { name: 'A', value: 1 },
      { name: 'B', value: 2 },
    ];
    const secondResult = reconcileRowIds(firstResult, next);

    expect(secondResult[0].rowId).toBe('row-1');
    expect(secondResult[1].rowId).toBe('row-2');
  });

  it('returns the same array reference when nothing changed (loop guard)', () => {
    const models: MockItem[] = [{ name: 'A' }, { name: 'B' }];
    const first = reconcileRowIds(undefined, models);
    // Same model object references, fresh outer array — must short-circuit to `first`
    // so `setState(reconcileRowIds(prev, next))` bails instead of looping.
    const second = reconcileRowIds(first, [...models]);
    expect(second).toBe(first);

    // Empty-collection case: a fresh `[]` each call must also short-circuit.
    const emptyA = reconcileRowIds(undefined, []);
    const emptyB = reconcileRowIds(emptyA, []);
    expect(emptyB).toBe(emptyA);
  });

  it('pass 4: an insert at the same index as a delete inherits the removed row id', () => {
    // Documented same-index trade-off: keeping draft state stable across renames is
    // favoured over insert detection, so a delete-at-N + insert-at-N in one reconcile
    // makes the new row reuse the removed row's id rather than get a fresh one.
    const initial: MockItem[] = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const first = reconcileRowIds(undefined, initial); // row-1, row-2, row-3

    const next: MockItem[] = [{ name: 'A' }, { name: 'X' }, { name: 'C' }];
    const result = reconcileRowIds(first, next);

    expect(result[0].rowId).toBe('row-1'); // A unchanged (exact match)
    expect(result[2].rowId).toBe('row-3'); // C unchanged (exact match)
    expect(result[1].rowId).toBe('row-2'); // X reuses B's id via the same-index pass
  });
});
