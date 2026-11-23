import { validateVhdlIdentifier } from '../../../webview/shared/utils/validation';

describe('validation utilities', () => {
  it('validates VHDL identifiers', () => {
    expect(validateVhdlIdentifier('my_signal')).toBeNull();
    expect(validateVhdlIdentifier('3invalid')).toBeTruthy();
  });
});
