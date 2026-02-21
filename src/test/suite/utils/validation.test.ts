import { validateVhdlIdentifier, validateVersion } from '../../../webview/shared/utils/validation';

describe('validation utilities', () => {
  it('validates VHDL identifiers', () => {
    expect(validateVhdlIdentifier('my_signal')).toBeNull();
    expect(validateVhdlIdentifier('3invalid')).toBeTruthy();
  });

  it('validates semantic version format', () => {
    expect(validateVersion('1.0.0')).toBeNull();
    expect(validateVersion('1.0')).toBeTruthy();
  });
});
