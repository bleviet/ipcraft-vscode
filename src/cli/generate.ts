import * as path from 'path';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';
import type { ResourceRoots } from '../services/ResourceRoots';
import type { GenerateOptions, HdlLanguage } from '../generator/types';

export const DEFAULT_QUARTUS_DEVICE = '5CSEBA6U23I7';
export const DEFAULT_VIVADO_PART = 'xc7z020clg484-1';

export interface CliGenerateArgs {
  ipYamlPath: string;
  outDir?: string;
  /** Vendor targets to scaffold a project for, e.g. ['quartus']. Empty = RTL + testbench only. */
  targets: string[];
  hdlLanguage: HdlLanguage;
  scaffoldPack?: string;
  quartusDevice?: string;
  targetPart?: string;
}

export interface CliGenerateResult {
  success: boolean;
  outputDir?: string;
  files?: string[];
  error?: string;
}

/** Builds a fresh IpCoreScaffolder wired to resourceRoots — shared by `generate` and `verify`. */
export function buildCliScaffolder(resourceRoots: ResourceRoots): IpCoreScaffolder {
  const logger = new Logger('ipcraft-cli');
  const templates = new TemplateLoader(logger, resourceRoots.templatesDir);
  return new IpCoreScaffolder(logger, templates, resourceRoots);
}

/**
 * Translates parsed CLI args into IpCoreScaffolder.generateAll options, applying the same
 * device/part defaults the VS Code commands fall back to. Shared by `generate` and `verify` so
 * both regenerate with identical options for the same flags.
 */
export function buildGenerateOptions(
  args: Pick<
    CliGenerateArgs,
    'targets' | 'hdlLanguage' | 'scaffoldPack' | 'quartusDevice' | 'targetPart'
  >
): GenerateOptions {
  const includeQuartusProject = args.targets.includes('quartus');
  const includeVivadoProject = args.targets.includes('vivado');

  return {
    targets: args.targets,
    includeRegs: true,
    includeTestbench: true,
    hdlLanguage: args.hdlLanguage,
    scaffoldPack: args.scaffoldPack,
    includeQuartusProject,
    includeVivadoProject,
    ...(includeQuartusProject
      ? { quartusDevice: args.quartusDevice ?? DEFAULT_QUARTUS_DEVICE }
      : {}),
    ...(includeVivadoProject ? { targetPart: args.targetPart ?? DEFAULT_VIVADO_PART } : {}),
  };
}

/**
 * Core logic behind `ipcraft generate` (issue #72) — drives the exact same
 * IpCoreScaffolder.generateAll used by the VS Code "Scaffold Project" / "Generate Quartus
 * Project" commands, so a headless run and an in-editor run produce identical output for the
 * same inputs. Kept independent of resourceRoots resolution so it's directly unit-testable
 * against devResourceRoots without a prior webpack build.
 */
export async function runCliGenerate(
  args: CliGenerateArgs,
  resourceRoots: ResourceRoots
): Promise<CliGenerateResult> {
  const scaffolder = buildCliScaffolder(resourceRoots);

  const resolvedIpYaml = path.resolve(args.ipYamlPath);
  const outputDir = path.resolve(args.outDir ?? path.dirname(resolvedIpYaml));

  const result = await scaffolder.generateAll(
    resolvedIpYaml,
    outputDir,
    buildGenerateOptions(args)
  );
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    outputDir,
    files: Object.keys(result.files ?? {}).sort(),
  };
}
