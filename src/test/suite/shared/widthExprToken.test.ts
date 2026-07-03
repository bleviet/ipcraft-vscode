import { getIdentifierTokenAtCursor } from '../../../webview/shared/utils/widthExprToken';

describe('getIdentifierTokenAtCursor', () => {
  it('returns the identifier when the cursor is mid-identifier', () => {
    // "clo|g2(x)" — cursor between "clo" and "g2"
    expect(getIdentifierTokenAtCursor('clog2(x)', 3)).toEqual({ start: 0, end: 3, text: 'clo' });
  });

  it('returns the identifier when the cursor is right after a complete identifier', () => {
    // "clog2|" — cursor right after the full identifier
    expect(getIdentifierTokenAtCursor('clog2', 5)).toEqual({ start: 0, end: 5, text: 'clog2' });
  });

  it('returns null when the cursor is right after a non-identifier character', () => {
    // "clog2(|" — cursor right after "("
    expect(getIdentifierTokenAtCursor('clog2(', 6)).toBeNull();
  });

  it('returns null when the token is purely numeric', () => {
    // "8|" — cursor right after a digit-only token
    expect(getIdentifierTokenAtCursor('8', 1)).toBeNull();
    expect(getIdentifierTokenAtCursor('WIDTH+8', 7)).toBeNull();
  });

  it('returns null when the cursor is at the start of the string', () => {
    expect(getIdentifierTokenAtCursor('clog2', 0)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getIdentifierTokenAtCursor('', 0)).toBeNull();
  });

  it('finds the identifier token starting after an operator, not the whole expression', () => {
    // "WIDTH+FIF|" — cursor after "FIF", preceded by "WIDTH+"
    expect(getIdentifierTokenAtCursor('WIDTH+FIF', 9)).toEqual({
      start: 6,
      end: 9,
      text: 'FIF',
    });
  });

  it('does not include characters after the cursor', () => {
    // "clo|g2" — cursor mid-identifier; token must stop at cursor, not extend to "g2"
    expect(getIdentifierTokenAtCursor('clog2', 3)).toEqual({ start: 0, end: 3, text: 'clo' });
  });
});
