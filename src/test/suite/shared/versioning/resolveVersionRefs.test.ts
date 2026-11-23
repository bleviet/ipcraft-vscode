import { parseMemoryMap } from '../../../../domain/parse';
import type { NormalizedMemoryMap } from '../../../../domain/internal.types';
import { resolveVersionRefsInMap } from '../../../../shared/versioning/resolveVersionRefs';

const mapOf = (registers: string, extra = ''): NormalizedMemoryMap =>
  parseMemoryMap(`
- name: CSR
  addressBlocks:
    - name: REGS
      baseAddress: 0
      registers:
${registers}${extra}`).map;

const FIELD_REFS = `
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[23:16]", resetValue: $version.major, access: read-write }
            - { name: MINOR, bits: "[15:8]", resetValue: $version.minor }
            - { name: PATCH, bits: "[7:0]", resetValue: 9 }
        - name: CTRL
          offset: 4
          fields:
            - { name: EN, bits: "[0]", resetValue: 1, access: read-write }
`;

const regs = (map: NormalizedMemoryMap) => map.addressBlocks[0].registers;

describe('resolveVersionRefsInMap', () => {
  it('resolves component refs on fields and forces them read-only', () => {
    const resolved = resolveVersionRefsInMap(mapOf(FIELD_REFS), 'major.minor.patch', '1.4.2');
    const [major, minor, patch] = regs(resolved)[0].fields;
    expect(major).toMatchObject({
      resetValue: 1,
      access: 'read-only',
      versionRef: '$version.major',
    });
    expect(minor).toMatchObject({
      resetValue: 4,
      access: 'read-only',
      versionRef: '$version.minor',
    });
    expect(patch.resetValue).toBe(9);
    expect(patch.versionRef).toBeUndefined();
  });

  it('resolves a field-level $version to the packed value', () => {
    const map = mapOf(`
        - name: VERSION
          offset: 0
          fields:
            - { name: ALL, bits: "[23:0]", resetValue: $version }
`);
    const resolved = resolveVersionRefsInMap(map, 'major.minor.patch', '1.4.2');
    expect(regs(resolved)[0].fields[0]).toMatchObject({
      resetValue: 0x010402,
      access: 'read-only',
      versionRef: '$version',
    });
  });

  it('resolves a register-level $version to the packed value', () => {
    const map = mapOf(`
        - { name: VERSION, offset: 0, resetValue: $version, access: read-write }
`);
    const resolved = resolveVersionRefsInMap(map, 'major.feature.minor.patch', '1.2.3.4');
    expect(regs(resolved)[0]).toMatchObject({
      resetValue: 0x01020304,
      access: 'read-only',
      versionRef: '$version',
    });
  });

  it('leaves registers and fields without refs untouched', () => {
    const map = mapOf(FIELD_REFS);
    const resolved = resolveVersionRefsInMap(map, 'major.minor.patch', '1.4.2');
    expect(regs(resolved)[1]).toEqual(regs(map)[1]);
  });

  it('keeps nested register arrays as they are when they hold no refs', () => {
    const map = mapOf(`
        - { name: VERSION, offset: 0, resetValue: $version }
        - name: CH
          offset: 0x10
          count: 2
          stride: 8
          registers:
            - { name: DATA, offset: 0, resetValue: 5 }
`);
    const resolved = resolveVersionRefsInMap(map, 'major.minor', '3.7');
    expect(regs(resolved)[0].resetValue).toBe(0x0307);
    expect(regs(resolved)[1]).toEqual(regs(map)[1]);
  });

  it('also resolves refs nested in an array (the generation gate rejects them separately)', () => {
    const map = mapOf(`
        - name: CH
          offset: 0x10
          count: 2
          stride: 8
          registers:
            - { name: VER, offset: 0, resetValue: $version }
`);
    const resolved = resolveVersionRefsInMap(map, 'major.minor', '3.7');
    expect(regs(resolved)[0].registers?.[0]).toMatchObject({
      resetValue: 0x0307,
      access: 'read-only',
    });
  });

  it('does not mutate its input', () => {
    const map = mapOf(FIELD_REFS);
    const snapshot = JSON.parse(JSON.stringify(map)) as NormalizedMemoryMap;
    const resolved = resolveVersionRefsInMap(map, 'major.minor.patch', '1.4.2');
    expect(map).toEqual(snapshot);
    expect(resolved).not.toBe(map);
    expect(regs(resolved)[0]).not.toBe(regs(map)[0]);
  });

  it('keeps versionHistory on the result', () => {
    const map: NormalizedMemoryMap = {
      ...mapOf(FIELD_REFS),
      versionHistory: { registerSets: {}, versions: [] },
    };
    expect(resolveVersionRefsInMap(map, 'major.minor.patch', '1.0.0').versionHistory).toBe(
      map.versionHistory
    );
  });

  it.each([
    ['free scheme', 'free', '1.4.2'],
    ['unparsable version', 'major.minor.patch', 'rev A'],
    ['wrong component count', 'major.minor.patch', '1.4'],
  ] as const)('leaves refs unresolved and does not throw: %s', (_label, scheme, version) => {
    const resolved = resolveVersionRefsInMap(mapOf(FIELD_REFS), scheme, version);
    const major = regs(resolved)[0].fields[0];
    expect(major.resetValue).toBe(0);
    expect(major.versionRef).toBe('$version.major');
  });

  it('leaves a component missing from the scheme unresolved', () => {
    const map = mapOf(`
        - name: VERSION
          offset: 0
          fields:
            - { name: PATCH, bits: "[7:0]", resetValue: $version.patch }
`);
    const resolved = resolveVersionRefsInMap(map, 'major.minor', '1.4');
    expect(regs(resolved)[0].fields[0].resetValue).toBe(0);
  });

  describe('non-zero register-level reset word', () => {
    const locked = (resetValue: string) => `
        - name: LOCKED
          offset: 0
          resetValue: ${resetValue}
          fields:
            - { name: REV, bits: "[7:0]", resetValue: $version.minor }
            - { name: REST, bits: "[31:8]", access: read-write }
`;

    it('splices the resolved constant into the register word and leaves the other bits', () => {
      const resolved = resolveVersionRefsInMap(
        mapOf(locked('0xffffffff')),
        'major.minor.patch',
        '1.4.2'
      );
      expect(regs(resolved)[0].resetValue).toBe(0xffffff04);
      expect(regs(resolved)[0].fields[0].resetValue).toBe(4);
    });

    it('clears the constant bits first: the word never ORs into a stale value', () => {
      const resolved = resolveVersionRefsInMap(
        mapOf(locked('0x5a5a5a5a')),
        'major.minor.patch',
        '1.4.2'
      );
      expect(regs(resolved)[0].resetValue).toBe(0x5a5a5a04);
    });

    it('splices a constant in the upper half of the word', () => {
      const map = mapOf(`
        - name: IDENT
          offset: 0
          resetValue: 0x00ff00ff
          fields:
            - { name: REV, bits: "[31:24]", resetValue: $version.major }
            - { name: REST, bits: "[23:0]", access: read-write }
`);
      const resolved = resolveVersionRefsInMap(map, 'major.minor.patch', '1.4.2');
      expect(regs(resolved)[0].resetValue).toBe(0x01ff00ff);
    });

    it('does not touch a register without a reset word, nor the source map', () => {
      const map = mapOf(FIELD_REFS);
      const resolved = resolveVersionRefsInMap(map, 'major.minor.patch', '1.4.2');
      expect(regs(resolved)[0].resetValue).toBe(0);
      const source = mapOf(locked('0xffffffff'));
      resolveVersionRefsInMap(source, 'major.minor.patch', '1.4.2');
      expect(regs(source)[0].resetValue).toBe(0xffffffff);
    });
  });
});
