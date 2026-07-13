/**
 * Programs a board's .sof over JTAG without the user hand-setting a device index or cable
 * name (issue #79) — runs `jtagconfig`, matches the board's device part number against the
 * detected JTAG chain, and derives the `quartus_pgm -o "p;file.sof@N"` device index from that
 * match instead of a hard-coded `@2`.
 */

import { execFile } from 'child_process';
import type * as vscode from 'vscode';
import {
  describeDeviceFamily,
  findFpgaNode,
  parseJtagConfigOutput,
  type JtagNodeMatch,
} from './JtagChainScanner';
import { runProcess, type DockerOptions } from './BuildRunner';
import type { ExtraMountSpec } from './toolchains/LaunchableTool';

export interface ProgramBoardOptions {
  jtagconfigExe: string;
  quartusPgmExe: string;
  /** Path to the .sof, relative to cwd or absolute. */
  sofPath: string;
  /** The board's full device part number, e.g. "5CSEBA6U23I7". */
  boardDevicePart: string;
  cwd: string;
  outputChannel: vscode.OutputChannel;
  docker?: DockerOptions;
  env?: Record<string, string>;
  extraMounts?: ExtraMountSpec[];
}

export interface ProgramBoardResult {
  success: boolean;
  error?: string;
  match?: JtagNodeMatch;
}

function execCapture(
  exe: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || err.message || '').trim();
        resolve({ stdout: stdout ?? '', error: detail || 'unknown error' });
        return;
      }
      resolve({ stdout });
    });
  });
}

export async function programBoard(options: ProgramBoardOptions): Promise<ProgramBoardResult> {
  const {
    jtagconfigExe,
    quartusPgmExe,
    sofPath,
    boardDevicePart,
    cwd,
    outputChannel,
    docker,
    env,
    extraMounts,
  } = options;

  outputChannel.appendLine(`\n> ${jtagconfigExe}`);
  const scan = await execCapture(jtagconfigExe, [], cwd);
  if (scan.error) {
    return {
      success: false,
      error: `Failed to run jtagconfig: ${scan.error}. Is the Quartus programmer installed and in PATH?`,
    };
  }
  outputChannel.appendLine(scan.stdout);

  const cables = parseJtagConfigOutput(scan.stdout);
  if (cables.length === 0 || cables.every((c) => c.devices.length === 0)) {
    return {
      success: false,
      error:
        'No JTAG cable detected. Is the board connected, powered on, and the USB cable plugged in?',
    };
  }

  const match = findFpgaNode(cables, boardDevicePart);
  if (!match) {
    const family = describeDeviceFamily(boardDevicePart);
    const detected = cables.flatMap((c) => c.devices.map((d) => d.namePattern)).join(', ');
    return {
      success: false,
      error: `No ${family} node found in the JTAG chain (detected: ${detected || 'none'}).`,
    };
  }

  outputChannel.appendLine(
    `Found ${match.device.namePattern} on cable ${match.cable.index} (${match.cable.name}) ` +
      `at chain position ${match.device.position}`
  );

  const result = await runProcess(
    quartusPgmExe,
    ['-c', String(match.cable.index), '-m', 'JTAG', '-o', `p;${sofPath}@${match.device.position}`],
    { cwd, outputChannel, docker, env, extraMounts }
  );

  return {
    success: result.success,
    match,
    error: result.success ? undefined : 'quartus_pgm failed — see the output above.',
  };
}
