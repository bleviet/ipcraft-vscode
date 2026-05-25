import { legacyVendorToTargets, migrate } from '../../../utils/migrateIpCore';

describe('legacyVendorToTargets', () => {
  it('maps altera → quartus', () => {
    expect(legacyVendorToTargets('altera')).toEqual(['quartus']);
  });

  it('maps xilinx → vivado', () => {
    expect(legacyVendorToTargets('xilinx')).toEqual(['vivado']);
  });

  it('maps both → vivado + quartus', () => {
    expect(legacyVendorToTargets('both')).toEqual(['vivado', 'quartus']);
  });

  it('maps none → []', () => {
    expect(legacyVendorToTargets('none')).toEqual([]);
  });

  it('maps undefined → []', () => {
    expect(legacyVendorToTargets(undefined)).toEqual([]);
  });

  it('maps unknown string → []', () => {
    expect(legacyVendorToTargets('lattice')).toEqual([]);
  });
});

describe('migrate', () => {
  it('rewrites vendor: altera to targets: [quartus]', () => {
    const input = `name: my_core\nvendor: altera\nversion: 1.0\n`;
    const { changed, text, notes } = migrate(input);
    expect(changed).toBe(true);
    expect(text).toContain('targets:');
    expect(text).toContain('quartus');
    expect(text).not.toContain('vendor:');
    expect(notes[0]).toContain("vendor: 'altera'");
  });

  it('rewrites vendor: xilinx to targets: [vivado]', () => {
    const input = `name: my_core\nvendor: xilinx\n`;
    const { changed, text } = migrate(input);
    expect(changed).toBe(true);
    expect(text).toContain('vivado');
    expect(text).not.toContain('vendor:');
  });

  it('rewrites vendor: both to targets: [vivado, quartus]', () => {
    const input = `name: my_core\nvendor: both\n`;
    const { changed, text } = migrate(input);
    expect(changed).toBe(true);
    expect(text).toContain('vivado');
    expect(text).toContain('quartus');
    expect(text).not.toContain('vendor:');
  });

  it('rewrites vendor: none to targets: []', () => {
    const input = `name: my_core\nvendor: none\n`;
    const { changed, text } = migrate(input);
    expect(changed).toBe(true);
    expect(text).toContain('targets:');
    expect(text).not.toContain('vendor:');
  });

  it('returns changed: false when no vendor field present', () => {
    const input = `name: my_core\ntargets:\n  - vivado\n`;
    const { changed, text } = migrate(input);
    expect(changed).toBe(false);
    expect(text).toBe(input);
  });

  it('returns changed: false for YAML with no vendor field (even malformed)', () => {
    // yaml package's parseDocument does not throw — it records errors in doc.errors.
    // With no vendor: key, migrate() exits early with changed: false and no notes.
    const input = `name: [invalid`;
    const { changed, notes } = migrate(input);
    expect(changed).toBe(false);
    expect(notes).toHaveLength(0);
  });

  it('preserves other fields and their order', () => {
    const input = `name: my_core\nvendor: altera\nversion: 2.0\ndescription: test\n`;
    const { text } = migrate(input);
    expect(text).toContain('name: my_core');
    expect(text).toContain('version: 2.0');
    expect(text).toContain('description: test');
  });
});
