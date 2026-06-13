import { applyPathEdits, applyPathDeletes, detectIndentSeq } from '../../../yamledit';

describe('yamledit', () => {
  describe('detectIndentSeq', () => {
    it('detects indented sequence format', () => {
      const text = `
clocks:
  - name: clk
    logicalName: CLK
`;
      expect(detectIndentSeq(text)).toBe(true);
    });

    it('detects compact sequence format', () => {
      const text = `
clocks:
- name: clk
  logicalName: CLK
`;
      expect(detectIndentSeq(text)).toBe(false);
    });
  });

  describe('applyPathEdits', () => {
    it('applies edits at path and preserves comments', () => {
      const text = `
# System clocks
clocks:
  # Main clock
  - name: clk
    logicalName: CLK # standard CLK
`;
      const edits = [{ path: ['clocks', 0, 'logicalName'], value: 'SYS_CLK' }];
      const result = applyPathEdits(text, edits);
      expect(result).toContain('# System clocks');
      expect(result).toContain('# Main clock');
      expect(result).toContain('logicalName: SYS_CLK # standard CLK');
    });

    it('preserves case and zero-padding of untouched hex scalars', () => {
      const text = `
registers:
  - name: CTRL
    address: 0x04
    value: 0x00FF
`;
      const edits = [{ path: ['registers', 0, 'name'], value: 'CONTROL' }];
      const result = applyPathEdits(text, edits);
      expect(result).toContain('address: 0x04');
      expect(result).toContain('value: 0x00FF');
      expect(result).toContain('name: CONTROL');
    });

    it('returns original text unchanged if edit is no-op', () => {
      const text = `
name: foo
value: 42
`;
      const edits = [{ path: ['value'], value: 42 }];
      const result = applyPathEdits(text, edits);
      expect(result).toBe(text);
    });

    it('does not reflow a long untouched line when editing an unrelated field', () => {
      // Longer than the 80-column serialization lineWidth: an untouched scalar must
      // keep its original single-line source, so only the edited line changes.
      const longDesc =
        'This is a deliberately long description that comfortably exceeds the eighty column serialization width to prove untouched lines are not reflowed';
      const text = `
clocks:
  - name: clk
    logicalName: CLK
    description: ${longDesc}
`;
      const result = applyPathEdits(text, [
        { path: ['clocks', 0, 'logicalName'], value: 'SYS_CLK' },
      ]);
      expect(result).toContain('logicalName: SYS_CLK');
      expect(result).toContain(`description: ${longDesc}`);
    });
  });

  describe('applyPathDeletes', () => {
    it('deletes paths and preserves comments', () => {
      const text = `
# Metadata
info:
  version: 1.0.0
  author: bleviet # creator
`;
      const result = applyPathDeletes(text, [['info', 'author']]);
      expect(result).toContain('# Metadata');
      expect(result).toContain('version: 1.0.0');
      expect(result).not.toContain('author');
      expect(result).not.toContain('bleviet');
    });
  });
});
