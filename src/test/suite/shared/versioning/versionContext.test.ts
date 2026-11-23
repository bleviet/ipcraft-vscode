import { resolveVersionRefInContext } from '../../../../shared/versioning/versionContext';

describe('resolveVersionRefInContext', () => {
  const resolved = {
    status: 'resolved',
    versionScheme: 'major.minor.patch',
    version: '1.4.2',
    ipCorePath: 'ip/uart.ip.yml',
  } as const;

  it('resolves refs of a resolved context', () => {
    expect(resolveVersionRefInContext(resolved, '$version.major')).toBe(1);
    expect(resolveVersionRefInContext(resolved, '$version.minor')).toBe(4);
    expect(resolveVersionRefInContext(resolved, '$version.patch')).toBe(2);
    expect(resolveVersionRefInContext(resolved, '$version')).toBe((1 << 16) | (4 << 8) | 2);
  });

  it('is null for a component the scheme lacks', () => {
    expect(resolveVersionRefInContext(resolved, '$version.feature')).toBeNull();
  });

  it('is null for a version that is invalid under the scheme, and for free', () => {
    expect(
      resolveVersionRefInContext({ ...resolved, version: '1.4' }, '$version.major')
    ).toBeNull();
    expect(
      resolveVersionRefInContext({ ...resolved, versionScheme: 'free' }, '$version.major')
    ).toBeNull();
  });

  it('is null when the context is none or ambiguous', () => {
    expect(resolveVersionRefInContext({ status: 'none' }, '$version')).toBeNull();
    expect(
      resolveVersionRefInContext(
        { status: 'ambiguous', candidates: ['a.ip.yml', 'b.ip.yml'] },
        '$version'
      )
    ).toBeNull();
  });
});
