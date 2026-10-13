import {
  VERSION_SCHEMES,
  packVersion,
  parseVersion,
  parseVersionRef,
  parseVersionScheme,
  resolveVersionRef,
  schemeComponents,
  validateVersion,
  versionRefWidth,
  type VersionRef,
  type VersionScheme,
} from '../../../../shared/versioning/versionScheme';

const NUMERIC_SCHEMES = VERSION_SCHEMES.filter((scheme) => scheme !== 'free');

describe('parseVersionScheme', () => {
  it.each(VERSION_SCHEMES)('accepts %s', (scheme) => {
    expect(parseVersionScheme(scheme)).toBe(scheme);
  });

  it.each([undefined, null, '', 'semver', 'Major.Minor', 3, {}])('maps %p to free', (raw) => {
    expect(parseVersionScheme(raw)).toBe('free');
  });
});

describe('schemeComponents', () => {
  it.each([
    ['free', []],
    ['major.minor', ['major', 'minor']],
    ['major.minor.patch', ['major', 'minor', 'patch']],
    ['major.feature.minor.patch', ['major', 'feature', 'minor', 'patch']],
  ] as const)('%s -> %p', (scheme, expected) => {
    expect(schemeComponents(scheme)).toEqual(expected);
  });

  it('returns a copy callers may mutate', () => {
    schemeComponents('major.minor').push('patch');
    expect(schemeComponents('major.minor')).toEqual(['major', 'minor']);
  });
});

describe('validateVersion', () => {
  describe('free', () => {
    it.each(['1.0', 'v2-beta', '2.0.0.0.1', ' x '])('accepts %p', (text) => {
      expect(validateVersion('free', text)).toBeNull();
    });

    it.each(['', '   ', '\t'])('requires a non-blank value: %p', (text) => {
      expect(validateVersion('free', text)).toBe('Required');
    });
  });

  describe.each([
    ['major.minor', '1.0', 'Format: MAJOR.MINOR, each 0-255 (e.g. "1.0")'],
    ['major.minor.patch', '1.0.0', 'Format: MAJOR.MINOR.PATCH, each 0-255 (e.g. "1.0.0")'],
    [
      'major.feature.minor.patch',
      '1.0.0.0',
      'Format: MAJOR.FEATURE.MINOR.PATCH, each 0-255 (e.g. "1.0.0.0")',
    ],
  ] as const)('%s', (scheme, example, hint) => {
    const count = schemeComponents(scheme).length;
    const withComponent = (index: number, value: string): string =>
      Array.from({ length: count }, (_, i) => (i === index ? value : '1')).join('.');

    it('accepts the example and 0 / 255 boundaries', () => {
      expect(validateVersion(scheme, example)).toBeNull();
      expect(validateVersion(scheme, Array(count).fill('0').join('.'))).toBeNull();
      expect(validateVersion(scheme, Array(count).fill('255').join('.'))).toBeNull();
    });

    it('rejects 256 naming the offending component', () => {
      const names = schemeComponents(scheme);
      for (let index = 0; index < count; index++) {
        expect(validateVersion(scheme, withComponent(index, '256'))).toBe(
          `Component '${names[index]}' must be 0-255`
        );
      }
    });

    it('rejects leading zeros', () => {
      expect(validateVersion(scheme, withComponent(count - 1, '01'))).toBe(hint);
      expect(validateVersion(scheme, withComponent(0, '00'))).toBe(hint);
    });

    it('rejects an empty component', () => {
      expect(validateVersion(scheme, withComponent(0, ''))).toBe(hint);
      expect(validateVersion(scheme, `${example}.`)).toBe(hint);
      expect(validateVersion(scheme, '')).toBe(hint);
    });

    it('rejects the wrong component count', () => {
      expect(
        validateVersion(
          scheme,
          Array(count - 1)
            .fill('1')
            .join('.')
        )
      ).toBe(hint);
      expect(
        validateVersion(
          scheme,
          Array(count + 1)
            .fill('1')
            .join('.')
        )
      ).toBe(hint);
    });

    it.each(['a.b.c.d', '1.x', '-1.0', '1.0 ', ' 1.0', '1.+2', '1e1.0', '0x1.0'])(
      'rejects non-decimal text %p',
      (text) => {
        expect(validateVersion(scheme, text)).not.toBeNull();
      }
    );
  });
});

describe('parseVersion', () => {
  it.each([
    ['major.minor', '1.4', [1, 4]],
    ['major.minor.patch', '1.4.2', [1, 4, 2]],
    ['major.feature.minor.patch', '1.2.3.4', [1, 2, 3, 4]],
    ['major.minor.patch', '0.0.0', [0, 0, 0]],
    ['major.minor', '255.255', [255, 255]],
  ] as const)('%s %s', (scheme, text, expected) => {
    expect(parseVersion(scheme, text)).toEqual(expected);
  });

  it.each([
    ['major.minor', '1.4.2'],
    ['major.minor.patch', '1.04.2'],
    ['major.minor.patch', '1.4.256'],
    ['major.feature.minor.patch', '1.2.3'],
  ] as const)('returns null for invalid %s %s', (scheme, text) => {
    expect(parseVersion(scheme, text)).toBeNull();
  });

  it('returns null for every free text', () => {
    expect(parseVersion('free', '1.0.0')).toBeNull();
  });
});

describe('packVersion', () => {
  it('packs most significant component first, 8 bit each', () => {
    expect(packVersion([1, 4, 2])).toBe(0x010402);
    expect(packVersion([1, 4])).toBe(0x0104);
    expect(packVersion([1, 2, 3, 4])).toBe(0x01020304);
    expect(packVersion([0, 0, 0])).toBe(0);
  });

  it('stays unsigned at 32 bit', () => {
    expect(packVersion([255, 255, 255, 255])).toBe(4294967295);
    expect(packVersion([128, 0, 0, 0])).toBe(0x80000000);
    expect(packVersion([128, 0, 0, 0])).toBeGreaterThan(0);
  });
});

describe('parseVersionRef', () => {
  it.each(['$version', '$version.major', '$version.feature', '$version.minor', '$version.patch'])(
    'accepts %s',
    (ref) => {
      expect(parseVersionRef(ref)).toBe(ref);
    }
  );

  it.each([
    '$version.foo',
    '$ver',
    '$version.',
    '$version.Major',
    '$versions',
    ' $version',
    '$version ',
    '$version\n',
    'version',
    '',
    0,
    null,
    undefined,
    {},
  ])('rejects %p', (value) => {
    expect(parseVersionRef(value)).toBeNull();
  });
});

describe('versionRefWidth', () => {
  it.each([
    '$version',
    '$version.major',
    '$version.minor',
    '$version.patch',
    '$version.feature',
  ] as const)('is null for free: %s', (ref) => {
    expect(versionRefWidth('free', ref)).toBeNull();
  });

  it.each([
    ['major.minor', '$version', 16],
    ['major.minor', '$version.major', 8],
    ['major.minor', '$version.minor', 8],
    ['major.minor', '$version.patch', null],
    ['major.minor', '$version.feature', null],
    ['major.minor.patch', '$version', 24],
    ['major.minor.patch', '$version.patch', 8],
    ['major.minor.patch', '$version.feature', null],
    ['major.feature.minor.patch', '$version', 32],
    ['major.feature.minor.patch', '$version.feature', 8],
    ['major.feature.minor.patch', '$version.patch', 8],
  ] as const)('%s %s -> %p', (scheme, ref, expected) => {
    expect(versionRefWidth(scheme, ref)).toBe(expected);
  });
});

describe('resolveVersionRef', () => {
  const resolve = (scheme: VersionScheme, version: string, ref: VersionRef) =>
    resolveVersionRef(scheme, version, ref);

  it('resolves the whole packed value and each component', () => {
    expect(resolve('major.minor.patch', '1.4.2', '$version')).toBe(0x010402);
    expect(resolve('major.minor.patch', '1.4.2', '$version.major')).toBe(1);
    expect(resolve('major.minor.patch', '1.4.2', '$version.minor')).toBe(4);
    expect(resolve('major.minor.patch', '1.4.2', '$version.patch')).toBe(2);
    expect(resolve('major.minor', '3.9', '$version')).toBe(0x0309);
    expect(resolve('major.feature.minor.patch', '1.2.3.4', '$version')).toBe(0x01020304);
    expect(resolve('major.feature.minor.patch', '1.2.3.4', '$version.feature')).toBe(2);
    expect(resolve('major.feature.minor.patch', '255.255.255.255', '$version')).toBe(4294967295);
  });

  it('resolves a zero component to 0, not null', () => {
    expect(resolve('major.minor.patch', '1.0.0', '$version.minor')).toBe(0);
  });

  it('is null when the scheme has no such component', () => {
    expect(resolve('major.minor.patch', '1.4.2', '$version.feature')).toBeNull();
    expect(resolve('major.minor', '1.4', '$version.patch')).toBeNull();
  });

  it('is null for the free scheme', () => {
    expect(resolve('free', '1.4.2', '$version')).toBeNull();
  });

  it('is null when the version does not parse under the scheme', () => {
    expect(resolve('major.minor.patch', '1.4', '$version')).toBeNull();
    expect(resolve('major.minor.patch', '1.4.256', '$version.major')).toBeNull();
    expect(resolve('major.minor', '', '$version.major')).toBeNull();
  });

  it.each(NUMERIC_SCHEMES)('resolves every component of a valid %s version', (scheme) => {
    const names = schemeComponents(scheme);
    const version = names.map((_, index) => String(index + 10)).join('.');
    names.forEach((name, index) => {
      expect(resolve(scheme, version, `$version.${name}`)).toBe(index + 10);
    });
  });
});
