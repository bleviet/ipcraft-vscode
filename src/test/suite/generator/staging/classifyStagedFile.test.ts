import { classifyModifiedFile } from '../../../../generator/staging/classifyStagedFile';

const entity = (ports: string, body: string): string =>
  `library ieee;\nentity foo_core is\n  port (\n    clk : in std_logic${ports}\n  );\nend entity foo_core;\narchitecture rtl of foo_core is\nbegin\n${body}\nend architecture rtl;\n`;

const base = entity('', '  -- body');
const incomingWithPort = entity(';\n    irq : out std_logic', '  -- body');
const userEdit = entity('', '  -- body\n  user <= clk;');

const classify = (over: Partial<Parameters<typeof classifyModifiedFile>[0]> = {}) =>
  classifyModifiedFile({
    relativePath: 'rtl/foo_core.vhd',
    isProtected: false,
    current: base,
    incoming: incomingWithPort,
    baseline: undefined,
    ...over,
  });

describe('classifyModifiedFile', () => {
  it('defaults an unedited unlocked file (no baseline) to overwrite', () => {
    const result = classify();
    expect(result.handEdited).toBe(false);
    expect(result.autoMergeContent).toBeUndefined();
    expect(result.defaultAction).toBe('overwrite');
    expect(result.actions).toEqual(expect.arrayContaining(['keep', 'overwrite']));
  });

  it('defaults an unedited unlocked file (current equals baseline) to overwrite', () => {
    const result = classify({ baseline: base });
    expect(result.handEdited).toBe(false);
    expect(result.defaultAction).toBe('overwrite');
  });

  it('defaults a locked file to keep even when a clean merge exists', () => {
    const result = classify({ isProtected: true, current: userEdit, baseline: base });
    expect(result.handEdited).toBe(true);
    expect(result.autoMergeContent).toContain('irq : out std_logic');
    expect(result.actions).toContain('auto-merge');
    expect(result.defaultAction).toBe('keep');
  });

  it('defaults a hand-edited file to keep when the generator output is unchanged', () => {
    const result = classify({ current: userEdit, incoming: base, baseline: base });
    expect(result.handEdited).toBe(true);
    expect(result.defaultAction).toBe('keep');
  });

  it('defaults a hand-edited file with a clean merge to auto-merge', () => {
    const result = classify({ current: userEdit, baseline: base });
    expect(result.autoMergeContent).toContain('user <= clk;');
    expect(result.autoMergeContent).toContain('irq : out std_logic');
    expect(result.defaultAction).toBe('auto-merge');
  });

  it('defaults a conflicting hand-edited file to keep and offers no auto-merge', () => {
    const current = entity('', '  -- user body');
    const incoming = entity('', '  -- generated body');
    const result = classify({ current, incoming, baseline: base });
    expect(result.autoMergeContent).toBeUndefined();
    expect(result.actions).not.toContain('auto-merge');
    expect(result.defaultAction).toBe('keep');
  });

  it('offers sync-interface with the drift for modified HDL files', () => {
    const result = classify({ current: userEdit });
    expect(result.interfaceDrift).toEqual({ added: ['irq'], removed: [], changed: [] });
    expect(result.syncedContent).toContain('irq : out std_logic');
    expect(result.syncedContent).toContain('user <= clk;');
    expect(result.actions).toContain('sync-interface');
  });

  it('computes no drift for non-HDL files', () => {
    const result = classify({ relativePath: 'altera/foo_hw.tcl', current: 'a\n', incoming: 'b\n' });
    expect(result.interfaceDrift).toBeUndefined();
    expect(result.syncedContent).toBeUndefined();
    expect(result.actions).toEqual(['keep', 'overwrite']);
  });
});
