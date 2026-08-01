import { execSync, execFileSync } from 'child_process';
import { detectVivadoVersion, detectVivadoVersionAt } from '../../../utils/detectVivadoVersion';

jest.unmock('../../../utils/detectVivadoVersion');
jest.mock('child_process');
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

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

describe('detectVivadoVersionAt', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('parses the version from a specific launcher exe', () => {
    mockExecFileSync.mockReturnValue('vivado v2025.1 (64-bit)');
    expect(detectVivadoVersionAt('/opt/vivado/2025.1/bin/vivado')).toBe('2025.1');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/opt/vivado/2025.1/bin/vivado',
      ['-version'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('forwards prefixArgs (Windows vvgl.exe wrapper) before -version', () => {
    mockExecFileSync.mockReturnValue('vivado v2024.2');
    detectVivadoVersionAt('C:\\Xilinx\\vvgl.exe', ['C:\\Xilinx\\vivado.bat']);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'C:\\Xilinx\\vvgl.exe',
      ['C:\\Xilinx\\vivado.bat', '-version'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('returns undefined when the probe throws', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(detectVivadoVersionAt('/no/such/vivado')).toBeUndefined();
  });

  it('returns undefined when output does not match the expected pattern', () => {
    mockExecFileSync.mockReturnValue('unexpected output');
    expect(detectVivadoVersionAt('/opt/vivado/bin/vivado')).toBeUndefined();
  });
});
