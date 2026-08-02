import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  SystemVerificationConfig,
  SystemVerificationResult,
} from '../domain/systemVerification.types';
import {
  SystemVerificationRunPanel,
  type SystemVerificationRunPanelDetails,
} from '../providers/SystemVerificationRunPanel';
import { parseSystemVerificationConfig } from '../services/systemVerification/SystemVerificationConfig';
import {
  SystemVerificationRunner,
  type SystemVerificationRunEvent,
} from '../services/systemVerification/SystemVerificationRunner';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

interface SystemVerificationRunPanelController {
  update(event: SystemVerificationRunEvent): void;
  complete(result: SystemVerificationResult, event: SystemVerificationRunEvent): void;
}

export interface RunSystemTestbenchDependencies {
  readonly runner: Pick<SystemVerificationRunner, 'run'>;
  readonly readConfig: (configPath: string) => Promise<SystemVerificationConfig>;
  readonly resolveRealPath: (filePath: string) => Promise<string>;
  readonly runPanel: {
    show(
      details: SystemVerificationRunPanelDetails,
      initialEvent: SystemVerificationRunEvent
    ): SystemVerificationRunPanelController;
  };
}

export async function runSystemTestbench(
  dependencies: RunSystemTestbenchDependencies,
  resource: vscode.Uri
): Promise<void>;
export async function runSystemTestbench(resource?: vscode.Uri): Promise<void>;
export async function runSystemTestbench(
  resourceOrDependencies?: vscode.Uri | RunSystemTestbenchDependencies,
  resource?: vscode.Uri
): Promise<void> {
  const dependencies = resource
    ? (resourceOrDependencies as RunSystemTestbenchDependencies)
    : createProductionRunDependencies();
  const configUri = resource ?? (resourceOrDependencies as vscode.Uri | undefined);

  if (
    configUri?.scheme !== 'file' ||
    path.basename(configUri.fsPath) !== 'system-verification.yml'
  ) {
    void vscode.window.showErrorMessage('Select a tracked system-verification.yml configuration.');
    return;
  }

  try {
    const configPath = await dependencies.resolveRealPath(configUri.fsPath);
    const workspaceRoot = await findWorkspaceRoot(configPath, dependencies.resolveRealPath);
    if (!workspaceRoot) {
      void vscode.window.showErrorMessage(
        'The system-verification.yml file must be inside an open workspace folder.'
      );
      return;
    }

    await dependencies.readConfig(configPath);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Running system testbench…',
        cancellable: true,
      },
      async (_progress, cancellationToken) => {
        let panel: SystemVerificationRunPanelController | undefined;
        let latestEvent: SystemVerificationRunEvent | undefined;
        const onEvent = (event: SystemVerificationRunEvent): void => {
          latestEvent = event;
          if (!panel) {
            panel = dependencies.runPanel.show({}, event);
          } else {
            panel.update(event);
          }
        };
        const result = await dependencies.runner.run(
          {
            configPath,
            workspaceRoot,
            workspaceConfiguration: vscode.workspace.getConfiguration(
              CONFIG_KEY_IPCRAFT,
              configUri
            ),
          },
          onEvent,
          cancellationToken
        );
        if (panel && latestEvent) {
          panel.complete(result, { ...latestEvent, stage: 'complete' });
        }
        reportRunResult(result);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to run system testbench: ${message}`);
  }
}

function createProductionRunDependencies(): RunSystemTestbenchDependencies {
  return {
    runner: new SystemVerificationRunner(),
    readConfig: async (configPath) =>
      parseSystemVerificationConfig(await fs.readFile(configPath, 'utf8'), configPath),
    resolveRealPath: fs.realpath,
    runPanel: SystemVerificationRunPanel,
  };
}

function reportRunResult(result: SystemVerificationResult): void {
  if (result.outcome === 'passed') {
    void vscode.window.showInformationMessage('System testbench passed.');
    return;
  }
  if (result.outcome === 'failed') {
    void vscode.window.showErrorMessage(
      `System testbench failed: ${result.firstFailure ?? 'See the run log for details.'}`
    );
    return;
  }
  void vscode.window.showInformationMessage('System testbench cancelled.');
}

async function findWorkspaceRoot(
  filePath: string,
  resolveRealPath: (filePath: string) => Promise<string>
): Promise<string | undefined> {
  const workspaceRoots = await Promise.all(
    (vscode.workspace.workspaceFolders ?? []).map(
      async (folder) => await resolveRealPath(folder.uri.fsPath)
    )
  );
  return workspaceRoots
    .filter((root) => isPathWithin(root, filePath))
    .sort((left, right) => right.length - left.length)[0];
}

function isPathWithin(rootPath: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
