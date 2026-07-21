import { execSync } from 'child_process';
import { detectVivadoVersion } from '../../../utils/detectVivadoVersion';

jest.unmock('../../../utils/detectVivadoVersion');
jest.mock('child_process');
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('detectVivadoVersion', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('detects version from typical Vivado output', () => {
    mockExecSync.mockReturnValue('vivado v2024.2 (64-bit)');
    expect(detectVivadoVersion()).toBe('2024.2');
  });

  it('detects older version from typical Vivado output', () => {
    mockExecSync.mockReturnValue(
      'Vivado v2020.1 (64-bit)\nSW Build 2902540 on Wed May 27 19:54:35 MDT 2020'
    );
    expect(detectVivadoVersion()).toBe('2020.1');
  });

  it('defaults to 2024.2 if regex does not match', () => {
    mockExecSync.mockReturnValue('some strange output without version');
    expect(detectVivadoVersion()).toBe('2024.2');
  });

  it('defaults to 2024.2 if execSync throws an error', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(detectVivadoVersion()).toBe('2024.2');
  });
});
