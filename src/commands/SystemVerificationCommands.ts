import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseMemoryMap } from '../domain/parse';
import type {
  DiscoveredAxiRoute,
  DiscoveredSystem,
  SystemVerificationConfig,
  SystemVerificationPlan,
} from '../domain/systemVerification.types';
import type { NormalizedMemoryMap } from '../domain/internal.types';
import type { ResourceRoots } from '../services/ResourceRoots';
import { getToolchain } from '../services/toolchains/registry';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import {
  VivadoSystemDiscovery,
  type VivadoSystemDiscoveryRequest,
} from '../services/systemVerification/VivadoSystemDiscovery';
import { buildSystemVerificationPlan } from '../services/systemVerification/SystemVerificationPlanner';
import {
  scaffoldSystemVerification,
  type SystemVerificationScaffoldInput,
} from '../services/systemVerification/SystemVerificationScaffolder';
import {
  stageSystemVerificationFiles,
  type SystemVerificationStagingResult,
} from '../services/systemVerification/SystemVerificationStaging';
export {
  runSystemTestbench,
  type RunSystemTestbenchDependencies,
} from './RunSystemTestbenchCommand';

interface MemoryMapPickItem extends vscode.QuickPickItem {
  readonly uri: vscode.Uri;
}

export interface GenerateSystemTestbenchDependencies {
  readonly discoverSystem: (request: VivadoSystemDiscoveryRequest) => Promise<DiscoveredSystem>;
  readonly buildPlan: (
    config: SystemVerificationConfig,
    discovered: DiscoveredSystem,
    memoryMap: NormalizedMemoryMap
  ) => SystemVerificationPlan;
  readonly scaffoldSystem: (input: SystemVerificationScaffoldInput) => Record<string, string>;
  readonly stageSystem: (
    contents: Record<string, string>,
    outputDir: string
  ) => Promise<SystemVerificationStagingResult>;
}

export async function generateSystemTestbench(
  dependencies: GenerateSystemTestbenchDependencies
): Promise<void>;
export async function generateSystemTestbench(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots
): Promise<void>;
export async function generateSystemTestbench(
  contextOrDependencies: vscode.ExtensionContext | GenerateSystemTestbenchDependencies,
  resourceRoots?: ResourceRoots
): Promise<void> {
  try {
    const dependencies = resourceRoots
      ? createProductionDependencies(resourceRoots)
      : (contextOrDependencies as GenerateSystemTestbenchDependencies);
    await runGenerateSystemTestbench(dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to generate system testbench: ${message}`);
  }
}

async function runGenerateSystemTestbench(
  dependencies: GenerateSystemTestbenchDependencies
): Promise<void> {
  const selectedTcl = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Tcl: ['tcl'] },
    title: 'Select Vivado Block Design Recreation Tcl',
  });
  const tclUri = selectedTcl?.[0];
  if (!tclUri) {
    return;
  }

  const workspaceRoot = findWorkspaceRoot(tclUri.fsPath);
  if (!workspaceRoot) {
    throw new Error('The recreation Tcl must be inside an open workspace folder.');
  }

  const recreateScript = normalizeRelativePath(path.relative(workspaceRoot, tclUri.fsPath));
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-system-verification-'));
  try {
    const discovered = await dependencies.discoverSystem({
      mode: 'preConfiguration',
      recreateScript,
      expectedDesignName: undefined,
      workspaceRoot,
      scratchDir,
      workspaceConfiguration: vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, tclUri),
      cancellationToken: noCancellationToken,
    });

    const designName = await vscode.window.showQuickPick([discovered.designName], {
      title: 'Select Block Design',
      placeHolder: 'Confirm the recreated Vivado block design',
    });
    if (!designName) {
      return;
    }

    const { selectableRoutes: compatibleRoutes, ambiguousPairs } =
      classifyAxi4LiteRoutes(discovered);
    if (ambiguousPairs.length > 0) {
      const pairList = ambiguousPairs
        .map((pair) => `${pair.driveInterfacePath} to ${pair.instancePath}`)
        .join(', ');
      void vscode.window.showWarningMessage(
        `Excluded ${pairList} because each has more than one AXI4-Lite route.`
      );
    }
    if (compatibleRoutes.length === 0) {
      void vscode.window.showErrorMessage(
        'Vivado discovery found no unambiguous external AXI4-Lite target routes.'
      );
      return;
    }
    const driveInterfacePath = await vscode.window.showQuickPick(
      unique(compatibleRoutes.map((route) => route.driveInterfacePath)),
      {
        title: 'Select External AXI4-Lite Interface',
        placeHolder: 'Select the boundary interface the testbench will drive',
      }
    );
    if (!driveInterfacePath) {
      return;
    }

    const instancePath = await vscode.window.showQuickPick(
      unique(
        compatibleRoutes
          .filter((route) => route.driveInterfacePath === driveInterfacePath)
          .map((route) => route.instancePath)
      ),
      {
        title: 'Select Target Instance',
        placeHolder: 'Select the AXI4-Lite target instance to verify',
      }
    );
    if (!instancePath) {
      return;
    }

    const memoryMapItem = await pickMemoryMap(workspaceRoot);
    if (!memoryMapItem) {
      return;
    }

    const clockPath = await pickBoundaryPath(
      'Select Clock Path',
      'Enter the absolute Vivado clock port path',
      discovered,
      'clock'
    );
    if (!clockPath) {
      return;
    }
    const resetPath = await pickBoundaryPath(
      'Select Reset Path',
      'Enter the absolute Vivado reset port path',
      discovered,
      'reset'
    );
    if (!resetPath) {
      return;
    }

    const part = await vscode.window.showInputBox({
      title: 'Vivado Part',
      prompt: 'Enter the exact part used by the recreation Tcl',
      placeHolder: 'e.g. xc7z020clg484-1',
      validateInput: requireNonEmpty('Part'),
    });
    if (!part) {
      return;
    }
    const clockPeriodText = await vscode.window.showInputBox({
      title: 'Clock Period',
      prompt: 'Clock period in nanoseconds',
      value: '10',
      validateInput: validatePositiveNumber,
    });
    if (!clockPeriodText) {
      return;
    }
    const resetPolarity = await vscode.window.showInputBox({
      title: 'Reset Polarity',
      prompt: 'Enter active-low or active-high',
      value: 'active-low',
      validateInput: validateResetPolarity,
    });
    if (!resetPolarity) {
      return;
    }
    const resetCyclesText = await vscode.window.showInputBox({
      title: 'Reset Cycles',
      prompt: 'Number of clock cycles to hold reset asserted',
      value: '5',
      validateInput: validatePositiveInteger,
    });
    if (!resetCyclesText) {
      return;
    }

    const tclDirectory = path.dirname(tclUri.fsPath);
    const outputDirectory = path.join(tclDirectory, 'verification');
    const memoryMapText = Buffer.from(
      await vscode.workspace.fs.readFile(memoryMapItem.uri)
    ).toString('utf8');
    const memoryMap = parseMemoryMap(memoryMapText).map;
    const config: SystemVerificationConfig = {
      recreateScript,
      part: part.trim(),
      designName,
      clockPath,
      clockPeriodNs: Number(clockPeriodText),
      resetPath,
      resetActiveLow: resetPolarity.trim().toLowerCase() === 'active-low',
      resetCycles: Number(resetCyclesText),
      target: {
        driveInterfacePath,
        instancePath,
        memoryMap: normalizeRelativePath(path.relative(outputDirectory, memoryMapItem.uri.fsPath)),
      },
    };
    const plan = dependencies.buildPlan(config, discovered, memoryMap);
    const scaffold = dependencies.scaffoldSystem({
      config,
      plan,
      memoryMapText,
      outputDirectory,
    });
    const stagingResult = await dependencies.stageSystem(scaffold, outputDirectory);
    if (stagingResult.accepted) {
      void vscode.window.showInformationMessage(
        `System testbench generated in ${outputDirectory}.`
      );
    }
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}

function createProductionDependencies(
  resourceRoots: ResourceRoots
): GenerateSystemTestbenchDependencies {
  const toolchain = getToolchain('vivado');
  if (!toolchain) {
    throw new Error('Vivado toolchain is not registered.');
  }
  const discovery = new VivadoSystemDiscovery(toolchain, resourceRoots.templatesDir);
  return {
    discoverSystem: (request) => discovery.discover(request),
    buildPlan: buildSystemVerificationPlan,
    scaffoldSystem: scaffoldSystemVerification,
    stageSystem: stageSystemVerificationFiles,
  };
}

async function pickMemoryMap(workspaceRoot: string): Promise<MemoryMapPickItem | undefined> {
  const memoryMapUris = await vscode.workspace.findFiles(
    '**/*.mm.yml',
    '**/{.git,node_modules}/**'
  );
  const items = memoryMapUris.map((uri) => ({
    label: path.basename(uri.fsPath),
    description: normalizeRelativePath(path.relative(workspaceRoot, uri.fsPath)),
    uri,
  }));
  return vscode.window.showQuickPick(items, {
    title: 'Select Linked Memory Map',
    placeHolder: 'Select the .mm.yml register contract for the target instance',
    matchOnDescription: true,
  });
}

async function pickBoundaryPath(
  title: string,
  prompt: string,
  discovered: DiscoveredSystem,
  type: 'clock' | 'reset'
): Promise<string | undefined> {
  const candidates = unique(
    discovered.boundaryPorts
      .filter((port) => port.type === type && port.direction === 'in' && port.width === 1)
      .map((port) => port.path)
  );
  if (candidates.length === 0) {
    void vscode.window.showErrorMessage(
      `Vivado discovery found no scalar input ${type} boundary ports.`
    );
    return undefined;
  }
  return vscode.window.showQuickPick(candidates, { title, placeHolder: prompt });
}

function findWorkspaceRoot(filePath: string): string | undefined {
  return vscode.workspace.workspaceFolders
    ?.map((folder) => folder.uri.fsPath)
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

function isAxi4Lite(protocol: string): boolean {
  return protocol.toLowerCase().replace(/[-_]/g, '') === 'axi4lite';
}

interface AxiRoutePair {
  readonly driveInterfacePath: string;
  readonly instancePath: string;
}

function classifyAxi4LiteRoutes(discovered: DiscoveredSystem): {
  selectableRoutes: DiscoveredAxiRoute[];
  ambiguousPairs: AxiRoutePair[];
} {
  const routesByInterface = new Map<string, Map<string, DiscoveredAxiRoute[]>>();
  for (const route of discovered.axiRoutes) {
    if (
      !isAxi4Lite(route.protocol) ||
      !discovered.boundaryInterfaces.some(({ path }) => path === route.driveInterfacePath) ||
      !discovered.instancePaths.includes(route.instancePath)
    ) {
      continue;
    }
    const routesByInstance =
      routesByInterface.get(route.driveInterfacePath) ?? new Map<string, DiscoveredAxiRoute[]>();
    const routes = [...(routesByInstance.get(route.instancePath) ?? []), route];
    routesByInstance.set(route.instancePath, routes);
    routesByInterface.set(route.driveInterfacePath, routesByInstance);
  }

  const selectableRoutes: DiscoveredAxiRoute[] = [];
  const ambiguousPairs: AxiRoutePair[] = [];
  for (const [driveInterfacePath, routesByInstance] of routesByInterface) {
    for (const [instancePath, routes] of routesByInstance) {
      if (routes.length === 1) {
        selectableRoutes.push(routes[0]);
      } else {
        ambiguousPairs.push({ driveInterfacePath, instancePath });
      }
    }
  }
  return { selectableRoutes, ambiguousPairs };
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function requireNonEmpty(label: string): (value: string) => string | undefined {
  return (value) => (value.trim().length > 0 ? undefined : `${label} cannot be empty`);
}

function validatePositiveNumber(value: string): string | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? undefined : 'Enter a number greater than zero';
}

function validatePositiveInteger(value: string): string | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? undefined : 'Enter a positive integer';
}

function validateResetPolarity(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return normalized === 'active-low' || normalized === 'active-high'
    ? undefined
    : 'Enter active-low or active-high';
}

const noCancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
} as vscode.CancellationToken;
