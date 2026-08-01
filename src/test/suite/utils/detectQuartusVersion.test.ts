import { execFileSync } from 'child_process';
import { detectQuartusVersionAt } from '../../../utils/detectQuartusVersion';

jest.mock('child_process');
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('detectQuartusVersionAt', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('parses the version from quartus_sh --version output', () => {
    mockExecFileSync.mockReturnValue(
      'Quartus Prime Shell\nVersion 23.1.0 Build 115 05/12/2023 SC Lite Edition'
    );
    expect(detectQuartusVersionAt('/opt/intelFPGA_pro/23.1/quartus/bin/quartus_sh')).toBe('23.1');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/opt/intelFPGA_pro/23.1/quartus/bin/quartus_sh',
      ['--version'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('returns undefined when the probe throws', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(detectQuartusVersionAt('/no/such/quartus_sh')).toBeUndefined();
  });

  it('returns undefined when output does not match the expected pattern', () => {
    mockExecFileSync.mockReturnValue('unexpected output');
    expect(detectQuartusVersionAt('/opt/quartus_sh')).toBeUndefined();
  });
});
