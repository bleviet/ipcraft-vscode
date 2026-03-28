import { applyFieldOperation } from '../../../webview/services/FieldOperationService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoot(fields: Record<string, unknown>[]) {
  return {
    address_blocks: [
      {
        name: 'BLOCK',
        registers: [{ name: 'REG', fields }],
      },
    ],
  };
}

const selection = { path: ['address_blocks', 0, 'registers', 0] };
const selectionRootPath: (string | number)[] = [];

function apply(root: Record<string, unknown>, op: string, payload: Record<string, unknown> = {}) {
  return applyFieldOperation({
    path: ['__op', op],
    value: payload,
    root,
    selectionRootPath,
    selection: selection as never,
  });
}

function getFields(root: Record<string, unknown>): Record<string, unknown>[] {
  const blocks = root.address_blocks as Record<string, unknown>[];
  const regs = blocks[0].registers as Record<string, unknown>[];
  return regs[0].fields as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// field-add
// ---------------------------------------------------------------------------

describe('FieldOperationService -- field-add', () => {
  it('adds a field to an empty register', () => {
    const root = makeRoot([]);
    const result = apply(root, 'field-add', {});
    expect(result).toBe(true);

    const fields = getFields(root);
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('NEW_FIELD');
    expect(fields[0].bits).toBe('[0:0]');
    expect(fields[0].access).toBe('read-write');
  });

  it('adds a field after a specific index', () => {
    const root = makeRoot([
      { name: 'A', bits: '[0:0]', access: 'read-write' },
      { name: 'B', bits: '[1:1]', access: 'read-write' },
    ]);

    apply(root, 'field-add', { afterIndex: 0, name: 'C' });
    const fields = getFields(root);
    expect(fields).toHaveLength(3);
    expect(fields[1].name).toBe('C');
  });

  it('finds the first free bit', () => {
    const root = makeRoot([
      { name: 'A', bits: '[0:0]', access: 'read-write' },
      { name: 'B', bits: '[2:1]', access: 'read-write' },
    ]);

    apply(root, 'field-add', {});
    const fields = getFields(root);
    // No afterIndex -> inserts at index 0; bits 0,1,2 are taken; first free is 3
    expect(fields[0].bits).toBe('[3:3]');
  });

  it('uses provided name and access', () => {
    const root = makeRoot([]);
    apply(root, 'field-add', { name: 'STATUS', access: 'read-only' });
    const fields = getFields(root);
    expect(fields[0].name).toBe('STATUS');
    expect(fields[0].access).toBe('read-only');
  });

  it('creates fields array when it does not exist', () => {
    const root = {
      address_blocks: [{ name: 'BLOCK', registers: [{ name: 'REG' }] }],
    };

    apply(root as Record<string, unknown>, 'field-add', {});
    const fields = getFields(root as Record<string, unknown>);
    expect(fields).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// field-delete
// ---------------------------------------------------------------------------

describe('FieldOperationService -- field-delete', () => {
  it('deletes a field by index', () => {
    const root = makeRoot([
      { name: 'A', bits: '[0:0]' },
      { name: 'B', bits: '[1:1]' },
      { name: 'C', bits: '[2:2]' },
    ]);

    apply(root, 'field-delete', { index: 1 });
    const fields = getFields(root);
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('A');
    expect(fields[1].name).toBe('C');
  });

  it('does nothing for out-of-range index', () => {
    const root = makeRoot([{ name: 'A', bits: '[0:0]' }]);

    apply(root, 'field-delete', { index: 5 });
    expect(getFields(root)).toHaveLength(1);
  });

  it('does nothing for negative index', () => {
    const root = makeRoot([{ name: 'A', bits: '[0:0]' }]);

    apply(root, 'field-delete', { index: -1 });
    expect(getFields(root)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// field-move
// ---------------------------------------------------------------------------

describe('FieldOperationService -- field-move', () => {
  it('swaps two adjacent fields and repacks bits', () => {
    const root = makeRoot([
      { name: 'A', bits: '[0:0]' },
      { name: 'B', bits: '[2:1]' },
    ]);

    apply(root, 'field-move', { index: 0, delta: 1 });
    const fields = getFields(root);
    expect(fields[0].name).toBe('B');
    expect(fields[1].name).toBe('A');
    // After repack: B is 2 bits wide at [1:0], A is 1 bit wide at [2:2]
    expect(fields[0].bits).toBe('[1:0]');
    expect(fields[1].bits).toBe('[2:2]');
  });

  it('does not move when target is out of bounds', () => {
    const root = makeRoot([
      { name: 'A', bits: '[0:0]' },
      { name: 'B', bits: '[1:1]' },
    ]);

    apply(root, 'field-move', { index: 0, delta: -1 });
    const fields = getFields(root);
    expect(fields[0].name).toBe('A');
  });

  it('does not move beyond the last field', () => {
    const root = makeRoot([
      { name: 'A', bits: '[0:0]' },
      { name: 'B', bits: '[1:1]' },
    ]);

    apply(root, 'field-move', { index: 1, delta: 1 });
    const fields = getFields(root);
    expect(fields[1].name).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// applyFieldOperation routing
// ---------------------------------------------------------------------------

describe('FieldOperationService -- routing', () => {
  it('returns false for unknown operation type', () => {
    const root = makeRoot([]);
    const result = apply(root, 'field-unknown', {});
    expect(result).toBe(false);
  });

  it('returns true for successful operations', () => {
    const root = makeRoot([]);
    expect(apply(root, 'field-add', {})).toBe(true);
    expect(apply(root, 'field-delete', { index: 0 })).toBe(true);
  });
});
