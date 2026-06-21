import {
  applyPathEdits,
  applyPathDeletes,
  detectIndentSeq,
  collectHexSpellings,
  restoreHexSpellings,
} from '../../../yamledit';
import { parseDocument } from 'yaml';

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

    it('defaults to true when no sequences are present', () => {
      const text = `
name: foo
value: 42
`;
      expect(detectIndentSeq(text)).toBe(true);
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

    it('applies multiple simultaneous edits', () => {
      const text = `
vlnv:
  vendor: user
  library: ip
  name: my_core
  version: 1.0.0
`;
      const edits = [
        { path: ['vlnv', 'vendor'], value: 'acme' },
        { path: ['vlnv', 'version'], value: '2.0.0' },
      ];
      const result = applyPathEdits(text, edits);
      expect(result).toContain('vendor: acme');
      expect(result).toContain('version: 2.0.0');
      expect(result).toContain('library: ip');
      expect(result).toContain('name: my_core');
    });

    it('edits boolean values', () => {
      const text = `
config:
  enabled: true
  debug: false
`;
      const result = applyPathEdits(text, [
        { path: ['config', 'enabled'], value: false },
        { path: ['config', 'debug'], value: true },
      ]);
      expect(result).toContain('enabled: false');
      expect(result).toContain('debug: true');
    });

    it('edits numeric values including zero', () => {
      const text = `
register:
  address: 0x10
  width: 32
`;
      const result = applyPathEdits(text, [
        { path: ['register', 'address'], value: 0 },
        { path: ['register', 'width'], value: 64 },
      ]);
      expect(result).toContain('address: 0');
      expect(result).toContain('width: 64');
    });

    it('preserves uppercase hex spelling when editing unrelated field', () => {
      const text = `
register:
  address: 0xFF
  mask: 0xABCD
`;
      const result = applyPathEdits(text, [{ path: ['register', 'address'], value: 0x10 }]);
      expect(result).toContain('mask: 0xABCD');
    });

    it('preserves zero-padded hex spelling when editing unrelated field', () => {
      const text = `
register:
  address: 0x0004
  mask: 0x00FF
`;
      const result = applyPathEdits(text, [{ path: ['register', 'address'], value: 0x08 }]);
      expect(result).toContain('mask: 0x00FF');
    });

    it('writes hex format when value is a hex string', () => {
      const text = `
register:
  address: 4
`;
      const result = applyPathEdits(text, [{ path: ['register', 'address'], value: '0x10' }]);
      expect(result).toContain('address: 0x10');
    });

    it('edits nested array element by index', () => {
      const text = `
fields:
  - name: ENABLE
    bitOffset: 0
  - name: STATUS
    bitOffset: 4
  - name: MODE
    bitOffset: 8
`;
      const result = applyPathEdits(text, [{ path: ['fields', 1, 'name'], value: 'FLAG' }]);
      expect(result).toContain('name: ENABLE');
      expect(result).toContain('name: FLAG');
      expect(result).toContain('name: MODE');
    });

    it('preserves trailing inline comments on untouched lines', () => {
      const text = `
registers:
  - name: CTRL # control register
    address: 0x00 # base address
    width: 32
`;
      const result = applyPathEdits(text, [{ path: ['registers', 0, 'width'], value: 64 }]);
      expect(result).toContain('# control register');
      expect(result).toContain('# base address');
      expect(result).toContain('width: 64');
    });

    it('preserves block comments above sequence items', () => {
      const text = `
# First block
blocks:
  # Primary address block
  - name: REGS
    baseAddress: 0x0000
  # Secondary block
  - name: FIFO
    baseAddress: 0x1000
`;
      const result = applyPathEdits(text, [{ path: ['blocks', 0, 'name'], value: 'CONTROL' }]);
      expect(result).toContain('# First block');
      expect(result).toContain('# Primary address block');
      expect(result).toContain('# Secondary block');
      expect(result).toContain('baseAddress: 0x1000');
    });

    it('returns original text when YAML is invalid', () => {
      const text = `
name: foo
  bad indent: bar
`;
      const result = applyPathEdits(text, [{ path: ['name'], value: 'baz' }]);
      expect(result).toBe(text);
    });

    it('handles edit to deeply nested path', () => {
      const text = `
a:
  b:
    c:
      d: deep_value
`;
      const result = applyPathEdits(text, [{ path: ['a', 'b', 'c', 'd'], value: 'new_value' }]);
      expect(result).toContain('d: new_value');
    });

    it('skips no-op edits among real edits', () => {
      const text = `
x: 1
y: 2
z: 3
`;
      const result = applyPathEdits(text, [
        { path: ['x'], value: 10 },
        { path: ['y'], value: 2 },
        { path: ['z'], value: 30 },
      ]);
      expect(result).toContain('x: 10');
      expect(result).toContain('y: 2');
      expect(result).toContain('z: 30');
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

    it('returns original text when deleting non-existent path', () => {
      const text = `
name: foo
value: 42
`;
      const result = applyPathDeletes(text, [['nonexistent']]);
      expect(result).toBe(text);
    });

    it('deletes multiple paths in one call', () => {
      const text = `
vlnv:
  vendor: user
  library: ip
  name: my_core
  version: 1.0.0
`;
      const result = applyPathDeletes(text, [
        ['vlnv', 'library'],
        ['vlnv', 'version'],
      ]);
      expect(result).toContain('vendor: user');
      expect(result).toContain('name: my_core');
      expect(result).not.toContain('library');
      expect(result).not.toContain('version');
    });

    it('deletes array element by index', () => {
      const text = `
clocks:
  - name: clk_a
  - name: clk_b
  - name: clk_c
`;
      const result = applyPathDeletes(text, [['clocks', 1]]);
      expect(result).toContain('clk_a');
      expect(result).not.toContain('clk_b');
      expect(result).toContain('clk_c');
    });

    it('preserves hex spellings on untouched lines after delete', () => {
      const text = `
registers:
  - name: CTRL
    address: 0x00FF
    description: control register
`;
      const result = applyPathDeletes(text, [['registers', 0, 'description']]);
      expect(result).toContain('address: 0x00FF');
      expect(result).not.toContain('description');
    });

    it('returns original text when YAML is invalid', () => {
      const text = `
name: foo
  bad: indent
`;
      const result = applyPathDeletes(text, [['name']]);
      expect(result).toBe(text);
    });

    it('deletes top-level key', () => {
      const text = `
name: my_core
description: a core
version: 1.0.0
`;
      const result = applyPathDeletes(text, [['description']]);
      expect(result).toContain('name: my_core');
      expect(result).toContain('version: 1.0.0');
      expect(result).not.toContain('description');
    });
  });

  describe('collectHexSpellings / restoreHexSpellings', () => {
    it('collects hex spellings from AST scalars', () => {
      const doc = parseDocument(`
address: 0x00FF
mask: 0xABCD
`);
      const hexFix = collectHexSpellings(doc);
      expect(hexFix.size).toBeGreaterThan(0);
      expect(hexFix.get('0xff')).toBe('0x00FF');
      expect(hexFix.get('0xabcd')).toBe('0xABCD');
    });

    it('restores original hex spelling in serialized text', () => {
      const hexFix = new Map<string, string>();
      hexFix.set('0xff', '0x00FF');
      const result = restoreHexSpellings('address: 0xff\n', hexFix);
      expect(result).toContain('0x00FF');
    });

    it('does not alter text when rendered matches source', () => {
      const hexFix = new Map<string, string>();
      hexFix.set('0x10', '0x10');
      const text = 'address: 0x10\n';
      const result = restoreHexSpellings(text, hexFix);
      expect(result).toBe(text);
    });
  });
});
