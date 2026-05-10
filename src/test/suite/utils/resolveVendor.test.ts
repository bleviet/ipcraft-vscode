import { execSync } from 'child_process';
import { resolveVendor } from '../../../utils/resolveVendor';

jest.mock('child_process');
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('resolveVendor', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns explicit setting when it is a non-empty, non-user value', () => {
    expect(resolveVendor('acme.com')).toBe('acme.com');
    expect(resolveVendor('my_vendor')).toBe('my_vendor');
  });

  it('falls through to git when setting is blank', () => {
    mockExecSync.mockReturnValue('alice@company.com\n');
    expect(resolveVendor('')).toBe('company.com');
  });

  it('falls through to git when setting is "user" (default placeholder)', () => {
    mockExecSync.mockReturnValue('bob@example.org\n');
    expect(resolveVendor('user')).toBe('example.org');
  });

  it('falls through to git when setting is undefined', () => {
    mockExecSync.mockReturnValue('carol@widgets.io\n');
    expect(resolveVendor(undefined)).toBe('widgets.io');
  });

  it('extracts domain correctly when email has multiple @ signs (uses last @)', () => {
    mockExecSync.mockReturnValue('weird@@domain.com\n');
    expect(resolveVendor(undefined)).toBe('domain.com');
  });

  it('falls back to "ipcraft" when git command throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(resolveVendor(undefined)).toBe('ipcraft');
  });

  it('falls back to "ipcraft" when email has no @ character', () => {
    mockExecSync.mockReturnValue('noemail\n');
    expect(resolveVendor(undefined)).toBe('ipcraft');
  });
});
