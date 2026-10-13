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

  it.each(['$version.major', '$versions', '$foo', 'version'])('keeps %s malformed', (text) => {
    expect(parseRegisterValueDraft(text, 'hex', 32)).toEqual({
      vector: null,
      error: 'malformed',
    });
  });

  it('parses numbers and empty text as before', () => {
    expect(parseRegisterValueDraft('FF', 'hex', 32).vector?.toBigInt()).toBe(BigInt(255));
    expect(parseRegisterValueDraft('', 'hex', 32)).toEqual({ vector: null, error: null });
  });
});

describe('decideRegisterToken', () => {
  it('commits the token on a register without bit fields', () => {
    expect(decideRegisterToken({ hasFields: false, debugMode: false })).toEqual({
      kind: 'commit',
      token: '$version',
    });
  });

  it('points to the fields when the register has some', () => {
    expect(decideRegisterToken({ hasFields: true, debugMode: false })).toEqual({
      kind: 'error',
      message: 'Use $version.* on the bit fields',
    });
  });

  it('refuses in Debug Mode', () => {
    expect(decideRegisterToken({ hasFields: false, debugMode: true })).toEqual({
      kind: 'error',
      message: 'Version references cannot be set in Debug Mode',
    });
  });
});
