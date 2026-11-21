/**
 * Runs Vivado to extract the resource reports of checkpoints, with progress and cancel: the
 * toolchain is resolved like a build mode's, the output goes to the build output channel, and the
 * reports are written to the extension's storage. The caller checks that the workspace is trusted.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  ExtractionError,
  extractToCache,
  vivadoVersionNear,
  type ExtractedReports,
  type RunVivado,
} from '../../services/resources/extractVivadoReports';
import type { ExtractTarget } from '../../services/resources/reportCandidates';
import { getBuildOutputChannel } from '../../services/BuildOutputChannel';
import { runProcess } from '../../services/BuildRunner';
import { resolveExecutionLauncher } from '../../services/toolchains/LaunchableTool';
import { getToolchain } from '../../services/toolchains/registry';
import { CONFIG_KEY_IPCRAFT } from '../../utils/configKeys';
import { Logger } from '../../utils/Logger';

const logger = new Logger('resourceExtraction');
const TAIL_LINES = 8;
const SHOW_OUTPUT = 'Show Output';

export type ExtractionOutcome =
  /** `reports` has one entry per target, in order. */
  { status: 'done'; reports: ExtractedReports[] } | { status: 'failed' | 'cancelled' };

/** Keeps the last lines of what a tool printed while passing everything on to the channel. */
function teeChannel(channel: Pick<vscode.OutputChannel, 'appendLine'>) {
  const lines: string[] = [];
  return {
    channel: {
      appendLine: (line: string) => {
        channel.appendLine(line);
        lines.push(...line.split(/\r?\n/).filter((l) => l.trim() !== ''));
        lines.splice(0, Math.max(0, lines.length - TAIL_LINES));
      },
    },
    tail: () => lines.join('\n'),
  };
}

function showFailure(message: string, tail: string): void {
  const output = getBuildOutputChannel();
  void Promise.resolve(
    vscode.window.showErrorMessage(tail ? `${message}\n${tail}` : message, SHOW_OUTPUT)
  ).then((choice) => {
    if (choice === SHOW_OUTPUT) {
      output.show(true);
    }
  });
}

/**
 * Extracts the report of each target into `storage`, one Vivado run after the other. Reports an
 * error to the user and returns `failed` when the tool is missing or a run fails; `cancelled`
 * (silently) when the user cancels the progress or `signal` aborts.
 */
export async function extractWithVivado(
  targets: ExtractTarget[],
  storage: string,
  signal?: AbortSignal
): Promise<ExtractionOutcome> {
  const toolchain = getToolchain('vivado');
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const preferredVersion = await vivadoVersionNear(targets[0].dcp);
  const docker = toolchain?.getDocker(cfg, storage, preferredVersion);
  const launcher = toolchain
    ? resolveExecutionLauncher(docker, 'vivado', () =>
        toolchain.resolve('vivado', cfg, preferredVersion)
      )
    : null;
  if (!toolchain || !launcher) {
    showFailure(
      'Vivado was not found. Set the Vivado install folder or Docker image in the IPCraft settings.',
      ''
    );
    return { status: 'failed' };
  }
  const launchEnv = toolchain.getLaunchEnv(cfg);
  const output = getBuildOutputChannel();
  const title = `Extracting the resource report from ${
    targets.length === 1 ? path.basename(targets[0].dcp) : `${targets.length} IP checkpoints`
  }`;

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (progress, token): Promise<ExtractionOutcome> => {
      const stop = new AbortController();
      const cancel = () => stop.abort();
      token.onCancellationRequested(cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        cancel();
      }
      const tee = teeChannel(output);
      // The folder the reports go to is the folder the container mounts as /work.
      const run: RunVivado = async ({ args, cwd, extraMounts }) => {
        const result = await runProcess(launcher.exe, [...launcher.prefixArgs, ...args], {
          cwd,
          outputChannel: tee.channel,
          docker: toolchain.getDocker(cfg, cwd, preferredVersion),
          env: launchEnv.env,
          extraMounts: [...launchEnv.extraMounts, ...extraMounts],
          signal: stop.signal,
        });
        return { ...result, output: tee.tail() };
      };
      const reports: ExtractedReports[] = [];
      try {
        for (const [index, target] of targets.entries()) {
          if (stop.signal.aborted) {
            return { status: 'cancelled' };
          }
          progress.report({
            message: target.xciName ?? `${index + 1} of ${targets.length}`,
          });
          reports.push(
            await extractToCache({
              dcp: target.dcp,
              storage,
              run,
              docker: docker !== undefined,
              ...(target.xciName !== undefined && { ooc: { xciName: target.xciName } }),
            })
          );
        }
        return { status: 'done', reports };
      } catch (error) {
        if (stop.signal.aborted) {
          return { status: 'cancelled' };
        }
        logger.error('Checkpoint extraction failed', error as Error);
        showFailure(
          error instanceof Error ? error.message : String(error),
          error instanceof ExtractionError ? error.outputTail : ''
        );
        return { status: 'failed' };
      }
    }
  );
}
