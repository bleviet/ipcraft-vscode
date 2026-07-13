import { execFile } from 'child_process';
import { programBoard } from '../../../services/JtagProgrammer';
import { runProcess } from '../../../services/BuildRunner';

jest.mock('child_process');
jest.mock('../../../services/BuildRunner', () => ({
  runProcess: jest.fn(),
}));

const DE10_NANO_OUTPUT = [
  '1) USB-Blaster [1-6]',
  '  02D020DD   5CSEBA6(.|ES)/5CSEMA6/..',
  '  020F30DD   SOCVHPS',
].join('\n');

function mockOutputChannel() {
  return { appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };
}

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecFileResult(stdout: string, err?: Error, stderr = ''): void {
  (execFile as unknown as jest.Mock).mockImplementation(
    (_exe: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(err ?? null, stdout, stderr);
    }
  );
}

describe('programBoard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('auto-derives the cable and device index and programs without a hand-set index (issue #79 AC1, AC3)', async () => {
    mockExecFileResult(DE10_NANO_OUTPUT);
    (runProcess as jest.Mock).mockResolvedValue({ success: true, exitCode: 0 });

    const ch = mockOutputChannel();
    const result = await programBoard({
      jtagconfigExe: 'jtagconfig',
      quartusPgmExe: 'quartus_pgm',
      sofPath: 'output_files/led_blink_board_top.sof',
      boardDevicePart: '5CSEBA6U23I7',
      cwd: '/tmp/board',
      outputChannel: ch as never,
    });

    expect(result.success).toBe(true);
    expect(result.match?.device.position).toBe(1);
    expect(result.match?.cable.index).toBe(1);
    expect(runProcess).toHaveBeenCalledWith(
      'quartus_pgm',
      ['-c', '1', '-m', 'JTAG', '-o', 'p;output_files/led_blink_board_top.sof@1'],
      expect.objectContaining({ cwd: '/tmp/board' })
    );
  });

  it('fails with an actionable message when jtagconfig finds no matching node (issue #79 AC2)', async () => {
    mockExecFileResult(DE10_NANO_OUTPUT);

    const ch = mockOutputChannel();
    const result = await programBoard({
      jtagconfigExe: 'jtagconfig',
      quartusPgmExe: 'quartus_pgm',
      sofPath: 'output_files/design.sof',
      boardDevicePart: '5CSEA5U19I7',
      cwd: '/tmp/board',
      outputChannel: ch as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cyclone V');
    expect(result.error).toContain('JTAG chain');
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('fails with an actionable message when no JTAG hardware/board is detected at all (issue #79 AC2)', async () => {
    mockExecFileResult('No JTAG hardware available');

    const ch = mockOutputChannel();
    const result = await programBoard({
      jtagconfigExe: 'jtagconfig',
      quartusPgmExe: 'quartus_pgm',
      sofPath: 'output_files/design.sof',
      boardDevicePart: '5CSEBA6U23I7',
      cwd: '/tmp/board',
      outputChannel: ch as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no jtag cable detected/i);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('fails readably when jtagconfig itself cannot be run', async () => {
    mockExecFileResult('', new Error('spawn jtagconfig ENOENT'));

    const ch = mockOutputChannel();
    const result = await programBoard({
      jtagconfigExe: 'jtagconfig',
      quartusPgmExe: 'quartus_pgm',
      sofPath: 'output_files/design.sof',
      boardDevicePart: '5CSEBA6U23I7',
      cwd: '/tmp/board',
      outputChannel: ch as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('jtagconfig');
  });

  it('surfaces quartus_pgm failure', async () => {
    mockExecFileResult(DE10_NANO_OUTPUT);
    (runProcess as jest.Mock).mockResolvedValue({ success: false, exitCode: 1 });

    const ch = mockOutputChannel();
    const result = await programBoard({
      jtagconfigExe: 'jtagconfig',
      quartusPgmExe: 'quartus_pgm',
      sofPath: 'output_files/design.sof',
      boardDevicePart: '5CSEBA6U23I7',
      cwd: '/tmp/board',
      outputChannel: ch as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('quartus_pgm failed');
  });
});
