import jsyaml from 'js-yaml';
import { normalizeMemoryMap, parseMemoryMap } from '../../../../domain/parse';
import type { NormalizedAddressBlock } from '../../../../domain/internal.types';
import {
  blocksHaveVersionRef,
  registerHasVersionRef,
  validateVersionRefs,
  type VersionRefIssue,
} from '../../../../shared/versioning/validateVersionRefs';
import type { VersionHistory } from '../../../../shared/versioning/versionHistoryTypes';

const HASH_A = 'rs1-aaaaaaaaaaaaaaaa';

const blocksOf = (yaml: string): NormalizedAddressBlock[] => parseMemoryMap(yaml).map.addressBlocks;

const parseSnapshot = (blocks: unknown[]): NormalizedAddressBlock[] =>
  normalizeMemoryMap({ addressBlocks: blocks }).addressBlocks;

/** A single block `REGS` at 0 holding the given register YAML (indented list items). */
const mapWith = (registers: string): string => `
- name: CSR
  addressBlocks:
    - name: REGS
      baseAddress: 0
      registers:
${registers}`;

const VERSION_REGISTER = `
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[23:16]", resetValue: $version.major }
            - { name: MINOR, bits: "[15:8]", resetValue: $version.minor }
            - { name: PATCH, bits: "[7:0]", resetValue: $version.patch }
        - name: CTRL
          offset: 4
`;

const errors = (issues: VersionRefIssue[]) => issues.filter((issue) => issue.severity === 'error');
const warnings = (issues: VersionRefIssue[]) =>
  issues.filter((issue) => issue.severity === 'warning');

const FIELD_PATH = (field: number, register = 0) => [
  'addressBlocks',
  0,
  'registers',
  register,
  'fields',
  field,
];

describe('registerHasVersionRef / blocksHaveVersionRef', () => {
  const register = (body: string): NormalizedAddressBlock['registers'][number] =>
    blocksOf(mapWith(body))[0].registers[0];

  it('finds a ref on the register, on a field, and in nested register arrays at any depth', () => {
    expect(
      registerHasVersionRef(register('        - name: R\n          resetValue: $version\n'))
    ).toBe(true);
    expect(registerHasVersionRef(register(VERSION_REGISTER))).toBe(true);
    const nested = `
        - name: ARR
          count: 2
          stride: 4
          registers:
            - name: INNER
              count: 2
              stride: 4
              registers:
                - name: LEAF
                  fields:
                    - { name: F, bits: "[7:0]", resetValue: $version.major }
`;
    expect(registerHasVersionRef(register(nested))).toBe(true);
    expect(blocksHaveVersionRef(blocksOf(mapWith(nested)))).toBe(true);
  });

  it('is false for registers and maps without a ref', () => {
    const plain = '        - name: R\n          offset: 0\n          resetValue: 5\n';
    expect(registerHasVersionRef(register(plain))).toBe(false);
    expect(blocksHaveVersionRef(blocksOf(mapWith(plain)))).toBe(false);
  });
});

describe('validateVersionRefs: valid setups', () => {
  it('yields nothing for a map without refs, for any scheme', () => {
    const blocks = blocksOf(mapWith('        - { name: CTRL, offset: 0 }\n'));
    for (const scheme of [null, 'free', 'major.minor.patch'] as const) {
      expect(validateVersionRefs(blocks, scheme)).toEqual([]);
    }
  });

  it('yields nothing for a valid version register', () => {
    expect(validateVersionRefs(blocksOf(mapWith(VERSION_REGISTER)), 'major.minor.patch')).toEqual(
      []
    );
  });

  it('yields nothing for a full $version field of the right width', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: V, bits: "[23:0]", resetValue: $version, access: read-only }
`)
    );
    expect(validateVersionRefs(blocks, 'major.minor.patch')).toEqual([]);
  });

  it('accepts a register-level ref on a fieldless register that is wide enough', () => {
    const blocks = blocksOf(
      mapWith('        - { name: VERSION, offset: 0, size: 32, resetValue: $version }\n')
    );
    expect(validateVersionRefs(blocks, 'major.minor.patch')).toEqual([]);
  });
});

describe('validateVersionRefs: E1 free scheme', () => {
  it('flags every ref under free, on the field', () => {
    const issues = validateVersionRefs(blocksOf(mapWith(VERSION_REGISTER)), 'free');
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.path)).toEqual([
      FIELD_PATH(0),
      FIELD_PATH(1),
      FIELD_PATH(2),
    ]);
    for (const issue of issues) {
      expect(issue.severity).toBe('error');
      expect(issue.message).toBe(
        'Version references need a numeric version scheme (set vlnv.versionScheme in the owning .ip.yml); only $version.crc8 and $version.crc16 work with a free version'
      );
    }
  });

  it('flags a register-level ref under free, on the register', () => {
    const blocks = blocksOf(
      mapWith('        - { name: VERSION, offset: 0, resetValue: $version }\n')
    );
    expect(validateVersionRefs(blocks, 'free')).toEqual([
      expect.objectContaining({
        severity: 'error',
        path: ['addressBlocks', 0, 'registers', 0],
      }),
    ]);
  });
});

describe('validateVersionRefs: E2 component not in scheme', () => {
  const featureField = (token: string) =>
    blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: F, bits: "[7:0]", resetValue: ${token} }
`)
    );

  it('flags $version.feature under major.minor.patch and lists the valid refs', () => {
    const issues = validateVersionRefs(featureField('$version.feature'), 'major.minor.patch');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].path).toEqual(FIELD_PATH(0));
    expect(issues[0].message).toContain('$version.feature');
    expect(issues[0].message).toContain('$version, $version.major, $version.minor, $version.patch');
  });

  it('flags $version.patch under major.minor', () => {
    const issues = validateVersionRefs(featureField('$version.patch'), 'major.minor');
    expect(issues[0].message).toContain('$version, $version.major, $version.minor');
    expect(issues[0].message).not.toContain('$version.feature');
  });

  it('accepts $version.feature under major.feature.minor.patch', () => {
    expect(
      validateVersionRefs(featureField('$version.feature'), 'major.feature.minor.patch')
    ).toEqual([]);
  });
});

describe('validateVersionRefs: E3 field width', () => {
  it('flags a component field that is not 8 bits', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[11:8]", resetValue: $version.major }
            - { name: MINOR, bits: "[23:16]", resetValue: $version.minor }
`)
    );
    const issues = validateVersionRefs(blocks, 'major.minor');
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'versionRef.width',
        path: FIELD_PATH(0),
        message: '$version.major needs 8 bits, field is 4',
      },
    ]);
  });

  it.each([
    ['major.minor', 16],
    ['major.minor.patch', 24],
    ['major.feature.minor.patch', 32],
  ] as const)('requires %s `$version` fields to be %i bits', (scheme, width) => {
    const bits = (w: number) => `[${w - 1}:0]`;
    const make = (w: number) =>
      blocksOf(
        mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: V, bits: "${bits(w)}", resetValue: $version }
`)
      );
    expect(validateVersionRefs(make(width), scheme)).toEqual([]);
    const issues = validateVersionRefs(make(width - 1), scheme);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe(`$version needs ${width} bits, field is ${width - 1}`);
  });
});

describe('validateVersionRefs: CRC refs', () => {
  const crcFields = (bits8: string, bits16: string) =>
    blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: C8, bits: "${bits8}", resetValue: $version.crc8 }
            - { name: C16, bits: "${bits16}", resetValue: $version.crc16 }
`)
    );

  it.each(['free', 'major.minor', 'major.minor.patch', 'major.feature.minor.patch'] as const)(
    'accepts exact-width CRC fields under %s',
    (scheme) => {
      expect(validateVersionRefs(crcFields('[7:0]', '[31:16]'), scheme)).toEqual([]);
    }
  );

  it('requires CRC fields to be exactly 8 and 16 bits', () => {
    const issues = validateVersionRefs(crcFields('[11:0]', '[31:20]'), 'major.minor');
    expect(issues.map((issue) => [issue.code, issue.path, issue.message])).toEqual([
      ['versionRef.width', FIELD_PATH(0), '$version.crc8 needs 8 bits, field is 12'],
      ['versionRef.width', FIELD_PATH(1), '$version.crc16 needs 16 bits, field is 12'],
    ]);
  });

  it('still rejects the other refs under free, naming the CRC refs as the only ones that work', () => {
    const issues = validateVersionRefs(blocksOf(mapWith(VERSION_REGISTER)), 'free');
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.code === 'versionRef.scheme')).toBe(true);
    expect(issues[0].message).toContain('only $version.crc8 and $version.crc16 work');
  });

  it('lists the CRC refs among the valid references', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: F, bits: "[7:0]", resetValue: $version.feature }
`)
    );
    const [issue] = validateVersionRefs(blocks, 'major.minor');
    expect(issue.message).toContain('$version.crc8, $version.crc16');
  });

  it('applies the register-level size rule on a fieldless register', () => {
    const register = (size: number) =>
      blocksOf(
        mapWith(`        - { name: V, offset: 0, size: ${size}, resetValue: $version.crc16 }\n`)
      );
    expect(validateVersionRefs(register(32), 'free')).toEqual([]);
    expect(validateVersionRefs(register(16), 'major.minor')).toEqual([]);
    const [issue] = validateVersionRefs(register(8), 'major.minor');
    expect(issue.message).toBe('$version.crc16 needs 16 bits, register is 8');
  });

  it('counts a CRC field as the version register for the single-register rule', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[7:0]", resetValue: $version.major }
        - name: CHECK
          offset: 4
          fields:
            - { name: C, bits: "[7:0]", resetValue: $version.crc8 }
`)
    );
    const issues = validateVersionRefs(blocks, 'major.minor');
    expect(issues.map((issue) => issue.code)).toEqual([
      'versionRef.multiple',
      'versionRef.multiple',
    ]);
  });
});

describe('validateVersionRefs: E4 register-level refs', () => {
  it('rejects a register-level ref on a register that has fields', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          resetValue: $version
          fields:
            - { name: A, bits: "[7:0]", resetValue: 1 }
`)
    );
    const issues = validateVersionRefs(blocks, 'major.minor');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      path: ['addressBlocks', 0, 'registers', 0],
    });
    expect(issues[0].message).toContain('Use $version.* on the fields instead');
  });

  it('rejects it even when no scheme is known', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          resetValue: $version
          fields:
            - { name: A, bits: "[7:0]", resetValue: 1 }
`)
    );
    expect(errors(validateVersionRefs(blocks, null))).toHaveLength(1);
  });

  it('rejects a fieldless register narrower than the ref', () => {
    const blocks = blocksOf(
      mapWith('        - { name: VERSION, offset: 0, size: 16, resetValue: $version }\n')
    );
    const issues = validateVersionRefs(blocks, 'major.minor.patch');
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'versionRef.width',
        path: ['addressBlocks', 0, 'registers', 0],
        message: '$version needs 24 bits, register is 16',
      },
    ]);
  });

  it('accepts a wider fieldless register (zero-extended) and a narrow component ref', () => {
    const blocks = blocksOf(
      mapWith(`
        - { name: V1, offset: 0, size: 64, resetValue: $version }
`)
    );
    expect(validateVersionRefs(blocks, 'major.minor.patch')).toEqual([]);
    const component = blocksOf(
      mapWith('        - { name: V, offset: 0, size: 8, resetValue: $version.minor }\n')
    );
    expect(validateVersionRefs(component, 'major.minor')).toEqual([]);
  });

  it('skips the width check when no scheme is known', () => {
    const blocks = blocksOf(
      mapWith('        - { name: VERSION, offset: 0, size: 8, resetValue: $version }\n')
    );
    expect(validateVersionRefs(blocks, null)).toEqual([]);
  });
});

describe('validateVersionRefs: E5 register arrays', () => {
  it('flags refs in an array register, at any depth', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: GRP
          offset: 0
          count: 2
          stride: 16
          registers:
            - name: INNER
              offset: 0
              resetValue: $version
            - name: DEEP
              offset: 4
              count: 2
              stride: 4
              registers:
                - name: LEAF
                  offset: 0
                  fields:
                    - { name: F, bits: "[7:0]", resetValue: $version.major }
`)
    );
    const issues = validateVersionRefs(blocks, 'major.minor.patch');
    expect(issues.map((issue) => issue.message)).toEqual([
      'Version references are not supported in register arrays',
      'Version references are not supported in register arrays',
    ]);
    expect(issues.map((issue) => issue.path)).toEqual([
      ['addressBlocks', 0, 'registers', 0, 'registers', 0],
      ['addressBlocks', 0, 'registers', 0, 'registers', 1, 'registers', 0, 'fields', 0],
    ]);
    expect(errors(issues)).toHaveLength(2);
  });

  it('flags a flat array (count without nested registers) and reports with an unknown scheme', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: FLAT
          offset: 0
          count: 4
          fields:
            - { name: F, bits: "[7:0]", resetValue: $version.major }
`)
    );
    const issues = validateVersionRefs(blocks, null);
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'versionRef.array',
        path: ['addressBlocks', 0, 'registers', 0, 'fields', 0],
        message: 'Version references are not supported in register arrays',
      },
    ]);
  });

  it('does not count refs inside arrays as version registers (E6)', () => {
    const blocks = blocksOf(
      mapWith(`${VERSION_REGISTER}
        - name: GRP
          offset: 8
          count: 2
          stride: 4
          fields:
            - { name: F, bits: "[7:0]", resetValue: $version.major }
`)
    );
    const issues = validateVersionRefs(blocks, 'major.minor.patch');
    expect(issues.map((issue) => issue.message)).toEqual([
      'Version references are not supported in register arrays',
    ]);
  });
});

describe('validateVersionRefs: E6 one version register', () => {
  const twoRegisters = () =>
    blocksOf(`
- name: CSR
  addressBlocks:
    - name: A
      baseAddress: 0
      registers:
        - name: VER1
          offset: 0
          fields:
            - { name: MAJOR, bits: "[7:0]", resetValue: $version.major }
    - name: B
      baseAddress: 0x100
      registers:
        - { name: VER2, offset: 0, resetValue: $version.minor, size: 8 }
        - { name: OTHER, offset: 4 }
`);

  it('flags each version register and names the others', () => {
    const issues = validateVersionRefs(twoRegisters(), 'major.minor');
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'versionRef.multiple',
        path: ['addressBlocks', 0, 'registers', 0],
        message: 'Only one version register per memory map (also: B.VER2)',
      },
      {
        severity: 'error',
        code: 'versionRef.multiple',
        path: ['addressBlocks', 1, 'registers', 0],
        message: 'Only one version register per memory map (also: A.VER1)',
      },
    ]);
  });

  it('still reports it when no scheme is known', () => {
    expect(errors(validateVersionRefs(twoRegisters(), null))).toHaveLength(2);
  });

  it('lists every other register when there are three', () => {
    const blocks = blocksOf(
      mapWith(`
        - { name: A, offset: 0, size: 8, resetValue: $version.major }
        - { name: B, offset: 4, size: 8, resetValue: $version.minor }
        - { name: C, offset: 8, size: 8, resetValue: $version.minor }
`)
    );
    const issues = validateVersionRefs(blocks, 'major.minor');
    expect(issues.map((issue) => issue.message)).toEqual([
      'Only one version register per memory map (also: REGS.B, REGS.C)',
      'Only one version register per memory map (also: REGS.A, REGS.C)',
      'Only one version register per memory map (also: REGS.A, REGS.B)',
    ]);
  });
});

describe('validateVersionRefs: W1 access', () => {
  const withAccess = (access: string) =>
    blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[7:0]", access: ${access}, resetValue: $version.major }
`)
    );

  it.each(['read-write', 'write-only'])('warns for access %s', (access) => {
    const issues = validateVersionRefs(withAccess(access), 'major.minor');
    expect(issues).toEqual([
      {
        severity: 'warning',
        code: 'versionRef.access',
        path: FIELD_PATH(0),
        message: 'Access is ignored: $version fields are generated as read-only constants',
      },
    ]);
  });

  it('does not warn for read-only', () => {
    expect(validateVersionRefs(withAccess('read-only'), 'major.minor')).toEqual([]);
  });

  it('warns even with an unknown scheme, and alongside an error', () => {
    expect(warnings(validateVersionRefs(withAccess('read-write'), null))).toHaveLength(1);
    const wide = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[3:0]", access: read-write, resetValue: $version.major }
`)
    );
    const issues = validateVersionRefs(wide, 'major.minor');
    expect(errors(issues)).toHaveLength(1);
    expect(warnings(issues)).toHaveLength(1);
  });

  it('does not warn for a field without a ref', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: CTRL
          offset: 0
          fields:
            - { name: EN, bits: "[0]", access: read-write, resetValue: 1 }
`)
    );
    expect(validateVersionRefs(blocks, 'major.minor')).toEqual([]);
  });
});

describe('validateVersionRefs: null scheme', () => {
  it('skips E1-E3 for scheme-dependent problems', () => {
    const blocks = blocksOf(
      mapWith(`
        - name: VERSION
          offset: 0
          fields:
            - { name: MAJOR, bits: "[3:0]", resetValue: $version.major }
            - { name: F, bits: "[15:8]", resetValue: $version.feature }
`)
    );
    expect(validateVersionRefs(blocks, null)).toEqual([]);
  });
});

describe('validateVersionRefs: W2 history', () => {
  const rawBlocksOf = (yaml: string): unknown[] =>
    (jsyaml.load(yaml) as Array<{ addressBlocks: unknown[] }>)[0].addressBlocks;

  const versionMap = (opts: { offset?: number; register?: string; majorBits?: string } = {}) =>
    mapWith(`
        - name: ${opts.register ?? 'VERSION'}
          offset: ${opts.offset ?? 0}
          fields:
            - { name: MAJOR, bits: "${opts.majorBits ?? '[15:8]'}", resetValue: $version.major }
            - { name: MINOR, bits: "[7:0]", resetValue: $version.minor }
        - { name: CTRL, offset: 8 }
`);
  const noVersionMap = mapWith('        - { name: CTRL, offset: 8 }\n');

  const historyOf = (recordedYaml: string) => ({
    value: {
      registerSets: { [HASH_A]: { addressBlocks: rawBlocksOf(recordedYaml) } },
      versions: [{ version: '1.4.1', registerSet: HASH_A }],
    } as VersionHistory,
    parseSnapshot,
  });

  it('is silent without history, and for an unchanged version register', () => {
    expect(validateVersionRefs(blocksOf(versionMap()), 'major.minor')).toEqual([]);
    expect(
      validateVersionRefs(blocksOf(versionMap()), 'major.minor', historyOf(versionMap()))
    ).toEqual([]);
  });

  it('warns when the version register moved, on the current register', () => {
    const issues = validateVersionRefs(
      blocksOf(versionMap({ offset: 4 })),
      'major.minor',
      historyOf(versionMap({ offset: 0 }))
    );
    expect(issues).toEqual([
      {
        severity: 'warning',
        code: 'versionRef.history.address:1.4.1',
        path: ['addressBlocks', 0, 'registers', 0],
        message:
          'Version register REGS.VERSION moved from 0x0 to 0x4 since version 1.4.1: drivers built for that version cannot read the version',
      },
    ]);
  });

  it('warns when the field layout changed', () => {
    const issues = validateVersionRefs(
      blocksOf(versionMap({ majorBits: '[23:16]' })),
      'major.minor',
      historyOf(versionMap())
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].path).toEqual(['addressBlocks', 0, 'registers', 0]);
    expect(issues[0].message).toContain('Version field layout changed since version 1.4.1');
    expect(issues[0].message).toContain('MAJOR');
  });

  it('warns on the map root when the version register is gone', () => {
    const issues = validateVersionRefs(
      blocksOf(noVersionMap),
      'major.minor',
      historyOf(versionMap())
    );
    expect(issues).toEqual([
      {
        severity: 'warning',
        code: 'versionRef.history.missing:1.4.1',
        path: [],
        message: 'No version register, but version 1.4.1 had one',
      },
    ]);
  });

  it('on rename, reports the old register as missing at the root and the new one as added', () => {
    const issues = validateVersionRefs(
      blocksOf(versionMap({ register: 'VER' })),
      'major.minor',
      historyOf(versionMap())
    );
    expect(issues.map((issue) => issue.path)).toEqual([[], ['addressBlocks', 0, 'registers', 0]]);
    expect(issues[0].message).toContain('REGS.VERSION');
    expect(issues[0].message).toContain('version 1.4.1');
    expect(issues[1].message).toBe(
      'Version 1.4.1 has no version register (and neither do versions sharing its register set); a driver cannot identify them'
    );
  });

  it('warns for an added version register, as a warning', () => {
    const issues = validateVersionRefs(
      blocksOf(versionMap()),
      'major.minor',
      historyOf(noVersionMap)
    );
    expect(issues).toEqual([
      {
        severity: 'warning',
        code: 'versionRef.history.added:1.4.1',
        path: ['addressBlocks', 0, 'registers', 0],
        message:
          'Version 1.4.1 has no version register (and neither do versions sharing its register set); a driver cannot identify them',
      },
    ]);
  });

  it('reports history warnings with an unknown scheme as well', () => {
    const issues = validateVersionRefs(
      blocksOf(versionMap({ offset: 4 })),
      null,
      historyOf(versionMap())
    );
    expect(warnings(issues)).toHaveLength(1);
  });
});

describe('validateVersionRefs: issue codes', () => {
  const FEATURE_FIELD = `
        - name: VERSION
          offset: 0
          fields:
            - { name: F, bits: "[3:0]", access: read-write, resetValue: $version.feature }
`;

  it('gives each rule its own stable code, also for several rules on one path', () => {
    const issues = validateVersionRefs(blocksOf(mapWith(FEATURE_FIELD)), 'major.minor');
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['versionRef.component', 'error'],
      ['versionRef.access', 'warning'],
    ]);
    expect(new Set(issues.map((issue) => JSON.stringify([issue.code, issue.path]))).size).toBe(2);
  });

  it('names register-level and scheme rules', () => {
    const codeOf = (registers: string, scheme: 'free' | 'major.minor') =>
      validateVersionRefs(blocksOf(mapWith(registers)), scheme).map((issue) => issue.code);
    expect(codeOf('        - { name: V, offset: 0, resetValue: $version }\n', 'free')).toEqual([
      'versionRef.scheme',
    ]);
    expect(
      codeOf(
        `
        - name: V
          offset: 0
          resetValue: $version
          fields:
            - { name: A, bits: "[7:0]" }
`,
        'major.minor'
      )
    ).toEqual(['versionRef.registerFields']);
  });

  it('keeps several history warnings on the map root distinct', () => {
    const HASH_B = 'rs1-bbbbbbbbbbbbbbbb';
    const rawBlocks = (registers: string): unknown[] =>
      (jsyaml.load(mapWith(registers)) as Array<{ addressBlocks: unknown[] }>)[0].addressBlocks;
    const recorded = (name: string) => `
        - name: ${name}
          offset: 0
          fields:
            - { name: MAJOR, bits: "[15:8]", resetValue: $version.major }
            - { name: MINOR, bits: "[7:0]", resetValue: $version.minor }
`;
    const issues = validateVersionRefs(
      blocksOf(mapWith('        - { name: CTRL, offset: 8 }\n')),
      'major.minor',
      {
        value: {
          registerSets: {
            [HASH_A]: { addressBlocks: rawBlocks(recorded('VERSION')) },
            [HASH_B]: { addressBlocks: rawBlocks(recorded('VER')) },
          },
          versions: [
            { version: '1.0.0', registerSet: HASH_A },
            { version: '1.1.0', registerSet: HASH_B },
          ],
        },
        parseSnapshot,
      }
    );
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['versionRef.history.missing:1.0.0', []],
      ['versionRef.history.missing:1.1.0', []],
    ]);
  });
});
