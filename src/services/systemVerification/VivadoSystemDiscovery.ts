import * as fs from 'fs/promises';
import * as path from 'path';
import Ajv from 'ajv';
import type * as vscode from 'vscode';
import { TemplateLoader } from '../../generator/TemplateLoader';
import type {
  DiscoveredSystem,
  SystemVerificationConfig,
} from '../../domain/systemVerification.types';
import { getBuildOutputChannel } from '../BuildOutputChannel';
import { runProcess } from '../BuildRunner';
import { resolveExecutionLauncher } from '../toolchains/LaunchableTool';
import type { LaunchableTool } from '../toolchains/LaunchableTool';
import { Logger } from '../../utils/Logger';

const discoveryTemplate = 'system_verification_discover.tcl.j2';
const discoveryTclName = 'discover.tcl';
const manifestName = 'discovery-manifest.json';
const workspaceMount = '/ipcraft-workspace';

const manifestSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'designName',
    'wrapperLanguage',
    'boundaryInterfaces',
    'boundaryPorts',
    'wrapperPorts',
    'instancePaths',
    'axiRoutes',
  ],
  properties: {
    designName: { type: 'string', minLength: 1 },
    wrapperLanguage: { type: 'string', minLength: 1 },
    boundaryInterfaces: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'mode', 'protocol', 'addressWidth', 'dataWidth', 'signals'],
        properties: {
          path: { type: 'string', minLength: 1 },
          mode: { type: 'string', minLength: 1 },
          protocol: { type: 'string', minLength: 1 },
          addressWidth: { type: 'integer', exclusiveMinimum: 0 },
          dataWidth: { type: 'integer', exclusiveMinimum: 0 },
          signals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'direction', 'width'],
              properties: {
                name: { type: 'string', minLength: 1 },
                direction: { enum: ['in', 'out', 'inout'] },
                width: { type: 'integer', exclusiveMinimum: 0 },
              },
            },
          },
        },
      },
    },
    boundaryPorts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'type', 'direction', 'width'],
        properties: {
          path: { type: 'string', minLength: 1 },
          type: { enum: ['clock', 'reset', 'data'] },
          direction: { enum: ['in', 'out', 'inout'] },
          width: { type: 'integer', exclusiveMinimum: 0 },
        },
      },
    },
    wrapperPorts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'direction', 'width', 'isVector'],
        properties: {
          name: { type: 'string', minLength: 1 },
          direction: { enum: ['in', 'out', 'inout'] },
          width: { type: 'integer', exclusiveMinimum: 0 },
          isVector: { type: 'boolean' },
        },
      },
    },
    instancePaths: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    axiRoutes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'driveInterfacePath',
          'instancePath',
          'protocol',
          'baseAddress',
          'addressRange',
          'busBytes',
          'addressWidth',
          'addressSegmentPath',
          'mappedSegmentPath',
        ],
        properties: {
          driveInterfacePath: { type: 'string', minLength: 1 },
          instancePath: { type: 'string', minLength: 1 },
          protocol: { type: 'string', minLength: 1 },
          baseAddress: { type: 'integer', minimum: 0 },
          addressRange: { type: 'integer', exclusiveMinimum: 0 },
          busBytes: { type: 'integer', exclusiveMinimum: 0 },
          addressWidth: { type: 'integer', exclusiveMinimum: 0 },
          addressSegmentPath: { type: 'string', minLength: 1 },
          mappedSegmentPath: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

const manifestValidator = new Ajv({ allErrors: true, strict: false }).compile(manifestSchema);

interface VivadoSystemDiscoveryRequestBase {
  readonly workspaceRoot: string;
  readonly scratchDir: string;
  readonly workspaceConfiguration: vscode.WorkspaceConfiguration;
  readonly cancellationToken: vscode.CancellationToken;
  readonly preferredVersion?: string;
}

interface ConfiguredVivadoSystemDiscoveryRequest {
  readonly mode?: 'configured';
  readonly config: SystemVerificationConfig;
}

interface PreConfigurationVivadoSystemDiscoveryRequest {
  readonly mode: 'preConfiguration';
  readonly recreateScript: string;
  readonly expectedDesignName?: string;
}

export type VivadoSystemDiscoveryRequest = VivadoSystemDiscoveryRequestBase &
  (ConfiguredVivadoSystemDiscoveryRequest | PreConfigurationVivadoSystemDiscoveryRequest);

/** Runs a checked-in recreation Tcl in an isolated work directory and reads its JSON result. */
export class VivadoSystemDiscovery {
  private readonly templates: TemplateLoader;

  constructor(
    private readonly toolchain: Pick<LaunchableTool, 'getDocker' | 'getLaunchEnv' | 'resolve'>,
    templatesDir: string
  ) {
    this.templates = new TemplateLoader(new Logger('VivadoSystemDiscovery'), templatesDir);
  }

  async discover(request: VivadoSystemDiscoveryRequest): Promise<DiscoveredSystem> {
    const { scratchDir } = request;
    const recreateScript =
      request.mode === 'preConfiguration' ? request.recreateScript : request.config.recreateScript;
    const expectedDesignName =
      request.mode === 'preConfiguration' ? request.expectedDesignName : request.config.designName;
    const manifestPath = path.join(scratchDir, manifestName);

    await fs.mkdir(scratchDir, { recursive: true });
    try {
      throwIfCancelled(request.cancellationToken);

      const recreationScript = resolveRecreationScript(request.workspaceRoot, recreateScript);
      const docker = this.toolchain.getDocker(
        request.workspaceConfiguration,
        scratchDir,
        request.preferredVersion
      );
      const launcher = resolveExecutionLauncher(docker, 'vivado', () =>
        this.toolchain.resolve('vivado', request.workspaceConfiguration, request.preferredVersion)
      );
      if (!launcher) {
        throw new Error('Could not resolve the configured Vivado launcher.');
      }
      const launchEnv = this.toolchain.getLaunchEnv(request.workspaceConfiguration);
      const recreationScriptForVivado = docker
        ? toMountedWorkspacePath(request.workspaceRoot, recreationScript)
        : recreationScript;
      const manifestPathForVivado = docker ? `/work/${manifestName}` : manifestPath;
      const workDirForVivado = docker ? '/work/vivado-work' : path.join(scratchDir, 'vivado-work');
      const tclPath = path.join(scratchDir, discoveryTclName);

      await fs.writeFile(
        tclPath,
        this.templates.render(discoveryTemplate, {
          recreateScript: escapeTclString(recreationScriptForVivado),
          designName: escapeTclString(expectedDesignName ?? ''),
          manifestPath: escapeTclString(manifestPathForVivado),
          workDir: escapeTclString(workDirForVivado),
        }),
        'utf8'
      );
      throwIfCancelled(request.cancellationToken);

      const result = await runProcess(
        launcher.exe,
        [...launcher.prefixArgs, '-mode', 'batch', '-source', tclPath, '-nojournal', '-nolog'],
        {
          cwd: scratchDir,
          outputChannel: getBuildOutputChannel(),
          docker,
          env: launchEnv.env,
          cancellationToken: request.cancellationToken,
          extraMounts: docker
            ? [
                ...launchEnv.extraMounts,
                { host: request.workspaceRoot, container: workspaceMount, ro: true },
              ]
            : launchEnv.extraMounts,
        }
      );
      throwIfCancelled(request.cancellationToken);
      if (!result.success) {
        throw new Error(`Vivado discovery failed with exit code ${result.exitCode}.`);
      }

      return await this.parseManifest(await fs.readFile(manifestPath, 'utf8'), manifestPath);
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }

  async parseManifest(text: string, sourcePath: string): Promise<DiscoveredSystem> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${sourcePath}: invalid discovery JSON: ${message}`);
    }

    if (!manifestValidator(parsed)) {
      const diagnostics = (manifestValidator.errors ?? [])
        .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
        .join('; ');
      throw new Error(`${sourcePath}: discovery manifest schema validation failed: ${diagnostics}`);
    }

    return parsed;
  }
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new Error('Vivado discovery cancelled.');
  }
}

function resolveRecreationScript(workspaceRoot: string, recreateScript: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, recreateScript);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`recreateScript ${recreateScript} must be a file inside workspaceRoot.`);
  }
  return resolved;
}

function toMountedWorkspacePath(workspaceRoot: string, filePath: string): string {
  return path.posix.join(
    workspaceMount,
    path.relative(workspaceRoot, filePath).split(path.sep).join('/')
  );
}

function escapeTclString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\[/g, '\\[');
}
