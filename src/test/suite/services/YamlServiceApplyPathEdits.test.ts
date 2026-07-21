import { YamlService } from '../../../webview/services/YamlService';

const SRC = `# header comment
- name: MAP
  addressBlocks:
    - name: A
      baseAddress: 0
      registers:
        - name: ID
          offset: 0
          resetValue: 0xC0FFEE01 # keep me
        - name: CTRL
          offset: 4
`;

describe('YamlService.applyPathEdits', () => {
  it('returns the identical string for no-op edits', () => {
    const out = YamlService.applyPathEdits(SRC, [
      { path: [0, 'name'], value: 'MAP' },
      { path: [0, 'addressBlocks', 0, 'baseAddress'], value: 0 },
    ]);
    expect(out).toBe(SRC);
  });

  it('edits a scalar without reformatting the rest', () => {
    const out = YamlService.applyPathEdits(SRC, [
      { path: [0, 'addressBlocks', 0, 'registers', 1, 'name'], value: 'CTRL2' },
    ]);
    expect(out).toContain('# header comment');
    expect(out).toContain('resetValue: 0xC0FFEE01 # keep me');
    expect(out).toContain('- name: CTRL2');
    // Indented-sequence style of the source preserved.
    expect(out).toContain('    - name: A');
  });

  it('keeps untouched sibling nodes when replacing an array', () => {
    const regs = [
      { name: 'ID', offset: 0, resetValue: 0xc0ffee01 },
      { name: 'CTRL', offset: 4 },
      { name: 'reg1', offset: 8 },
    ];
    const out = YamlService.applyPathEdits(SRC, [
      { path: [0, 'addressBlocks', 0, 'registers'], value: regs },
    ]);
    // The ID register node is reused: hex spelling and comment survive.
    expect(out).toContain('resetValue: 0xC0FFEE01 # keep me');
    expect(out).toContain('- name: reg1');
    expect(out).toContain('# header comment');
  });

  it('merges changed keys into a reused node matched by name', () => {
    const regs = [
      { name: 'ID', offset: 0, resetValue: 0xc0ffee01 },
      { name: 'CTRL', offset: 8, access: 'read-write' },
    ];
    const out = YamlService.applyPathEdits(SRC, [
      { path: [0, 'addressBlocks', 0, 'registers'], value: regs },
    ]);
    expect(out).toContain('resetValue: 0xC0FFEE01 # keep me');
    expect(out).toMatch(/name: CTRL\n\s+offset: 8\n\s+access: read-write/);
  });

  it('drops keys removed from a merged mapping', () => {
    const out = YamlService.applyPathEdits(SRC, [
      { path: [0, 'addressBlocks', 0, 'registers', 1], value: { name: 'CTRL' } },
    ]);
    expect(out).not.toMatch(/name: CTRL\n\s+offset: 4/);
  });

  it('preserves non-indented sequence style', () => {
    const flat = '- name: MAP\n  addressBlocks:\n  - name: A\n    baseAddress: 0\n';
    const out = YamlService.applyPathEdits(flat, [
      { path: [0, 'addressBlocks', 0, 'baseAddress'], value: 16 },
    ]);
    expect(out).toContain('\n  - name: A');
    expect(out).toContain('baseAddress: 16');
  });

  it('returns original text when YAML is invalid', () => {
    const bad = 'a: [unclosed';
    const warn = console.warn as jest.Mock;
    expect(YamlService.applyPathEdits(bad, [{ path: ['a'], value: 1 }])).toBe(bad);
    expect(warn).toHaveBeenCalledWith(
      'Cannot apply edit: YAML parse failed',
      expect.stringContaining('Flow sequence')
    );
    warn.mockClear();
  });
});
