import {
  decideRegisterToken,
  parseRegisterValueDraft,
} from '../../../webview/components/bitfield/registerValueToken';

describe('parseRegisterValueDraft', () => {
  it('recognises the trimmed text $version as the token', () => {
    expect(parseRegisterValueDraft('$version', 'hex', 32)).toEqual({
      vector: null,
      error: null,
      token: '$version',
    });
    expect(parseRegisterValueDraft('  $version  ', 'dec', 32).token).toBe('$version');
  });

  it.each(['$', '$v', '$ver', '$versio'])('treats the prefix %s as still being typed', (text) => {
    expect(parseRegisterValueDraft(text, 'hex', 32)).toEqual({
      vector: null,
      error: null,
      pending: true,
    });
  });

  it.each([
    '$version.major',
    '$version.feature',
    '$version.minor',
    '$version.patch',
    '$version.crc8',
    '$version.crc16',
  ])('recognises the complete reference %s as the token', (text) => {
    expect(parseRegisterValueDraft(text, 'hex', 32)).toEqual({
      vector: null,
      error: null,
      token: text,
    });
    expect(parseRegisterValueDraft(`  ${text} `, 'dec', 32).token).toBe(text);
  });

  it.each([
    '$version.',
    '$version.m',
    '$version.ma',
    '$version.cr',
    '$version.crc',
    '$version.crc1',
  ])('treats the prefix %s of a reference as still being typed', (text) => {
    expect(parseRegisterValueDraft(text, 'hex', 32)).toEqual({
      vector: null,
      error: null,
      pending: true,
    });
  });

  it.each(['$version.foo', '$versions', '$foo', 'version', '$version.major.', '$version.CRC8'])(
    'keeps %s malformed',
    (text) => {
      expect(parseRegisterValueDraft(text, 'hex', 32)).toEqual({
        vector: null,
        error: 'malformed',
      });
    }
  );

  it('parses numbers and empty text as before', () => {
    expect(parseRegisterValueDraft('FF', 'hex', 32).vector?.toBigInt()).toBe(BigInt(255));
    expect(parseRegisterValueDraft('', 'hex', 32)).toEqual({ vector: null, error: null });
  });
});

describe('decideRegisterToken', () => {
  it.each(['$version', '$version.minor', '$version.crc16'] as const)(
    'commits %s on a register without bit fields',
    (token) => {
      expect(decideRegisterToken({ token, hasFields: false, debugMode: false })).toEqual({
        kind: 'commit',
        token,
      });
    }
  );

  it('keeps pointing to the fields for $version when the register has some', () => {
    expect(decideRegisterToken({ token: '$version', hasFields: true, debugMode: false })).toEqual({
      kind: 'error',
      message: 'Use $version.* on the bit fields',
    });
  });

  it('names the Reset cell for a component or CRC reference when the register has fields', () => {
    expect(
      decideRegisterToken({ token: '$version.major', hasFields: true, debugMode: false })
    ).toEqual({
      kind: 'error',
      message: "Enter $version.major in a bit field's Reset cell",
    });
    expect(
      decideRegisterToken({ token: '$version.crc8', hasFields: true, debugMode: true })
    ).toEqual({
      kind: 'error',
      message: "Enter $version.crc8 in a bit field's Reset cell",
    });
  });

  it('refuses in Debug Mode', () => {
    expect(decideRegisterToken({ token: '$version', hasFields: false, debugMode: true })).toEqual({
      kind: 'error',
      message: 'Version references cannot be set in Debug Mode',
    });
  });
});
