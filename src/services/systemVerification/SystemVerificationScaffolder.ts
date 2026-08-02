import * as fs from 'fs';
import * as path from 'path';
import type {
  SystemVerificationConfig,
  SystemVerificationPlan,
  VerificationVector,
} from '../../domain/systemVerification.types';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { toTclQuotedString } from '../../generator/resolvers/tclString';
import { Logger } from '../../utils/Logger';
import { createSystemVerificationConfigText } from './SystemVerificationConfig';

export interface SystemVerificationScaffoldInput {
  readonly config: SystemVerificationConfig;
  readonly plan: SystemVerificationPlan;
  readonly memoryMapText: string;
  readonly outputDirectory: string;
}

interface RenderedVector extends VerificationVector {
  readonly addressHex: string;
  readonly expectedValueHex: string;
  readonly compareMaskHex: string;
  readonly registerNameVhdl: string;
  readonly writeValueHex?: string;
}

const templateNames = {
  makefile: 'system_verification_makefile.j2',
  runner: 'system_verification_run_xsim.tcl.j2',
  testbench: 'system_verification_tb.vhd.j2',
  bfm: 'system_verification_axi4lite_bfm.vhd.j2',
} as const;

/** Renders the complete, reviewable system-verification source scaffold in memory. */
export function scaffoldSystemVerification(
  input: SystemVerificationScaffoldInput
): Record<string, string> {
  const { config, plan } = input;
  const configText = createSystemVerificationConfigText(config);
  const dataWidth = plan.route.busBytes * 8;
  const relativeProjectRoot = projectRootRelative(config.recreateScript, input.outputDirectory);
  const templates = new TemplateLoader(
    new Logger('SystemVerificationScaffolder'),
    resolveTemplatesDirectory()
  );
  const context = {
    config,
    plan,
    dataWidth,
    addressWidth: plan.route.addressWidth,
    clockPort: toVhdlIdentifier(config.clockPath),
    resetPort: toVhdlIdentifier(config.resetPath),
    interfacePort: toVhdlIdentifier(config.target.driveInterfacePath),
    expectedConfigBase64: Buffer.from(configText, 'utf8').toString('base64'),
    expectedMemoryMapBase64: Buffer.from(input.memoryMapText, 'utf8').toString('base64'),
    projectRootRelative: relativeProjectRoot,
    tclProjectRootRelative: toTclQuotedString(relativeProjectRoot),
    tclRecreateScript: toTclQuotedString(config.recreateScript),
    tclMemoryMap: toTclQuotedString(config.target.memoryMap),
    tclPart: toTclQuotedString(config.part),
    tclDesignName: toTclQuotedString(config.designName),
    tclWrapperLanguage: toTclQuotedString(plan.wrapperLanguage),
    tclBoundaryPath: toTclQuotedString(plan.boundaryInterface.path),
    tclBoundaryMode: toTclQuotedString(plan.boundaryInterface.mode),
    tclBoundaryProtocol: toTclQuotedString(plan.boundaryInterface.protocol),
    tclBoundarySignalShape: toTclQuotedString(
      plan.boundaryInterface.signals
        .map((signal) => `${signal.name}:${signal.direction}:${signal.width}`)
        .sort()
        .join(',')
    ),
    tclClockPath: toTclQuotedString(plan.clockPort.path),
    tclResetPath: toTclQuotedString(plan.resetPort.path),
    tclMappedSegmentPath: toTclQuotedString(plan.route.mappedSegmentPath),
    tclAddressSegmentPath: toTclQuotedString(plan.route.addressSegmentPath),
    tclInstancePath: toTclQuotedString(plan.route.instancePath),
    tclResultRouteJson: toTclQuotedString(
      JSON.stringify({
        driveInterfacePath: plan.route.driveInterfacePath,
        instancePath: plan.route.instancePath,
        baseAddress: plan.route.baseAddress,
      })
    ),
    routeBaseAddressHex: `0x${fixedWidthHex(plan.route.baseAddress, 32)}`,
    routeAddressRangeHex: `0x${fixedWidthHex(plan.route.addressRange, 32)}`,
    resetAsserted: config.resetActiveLow ? '0' : '1',
    resetDeasserted: config.resetActiveLow ? '1' : '0',
    transactions: plan.transactions.map((transaction) => ({
      ...transaction,
      addressHex: fixedWidthHex(transaction.address, 32),
      vectors: transaction.vectors.map((vector) => renderVector(vector, dataWidth)),
    })),
  };

  return {
    'system-verification.yml': configText,
    Makefile: templates.render(templateNames.makefile, context),
    'scripts/run_xsim.tcl': templates.render(templateNames.runner, context),
    'tb/system_verification_tb.vhd': templates.render(templateNames.testbench, context),
    'tb/axi4lite_master_bfm.vhd': templates.render(templateNames.bfm, context),
  };
}

function renderVector(vector: VerificationVector, dataWidth: number): RenderedVector {
  return {
    ...vector,
    addressHex: fixedWidthHex(vector.address, 32),
    expectedValueHex: fixedWidthHex(vector.expectedValue, dataWidth),
    compareMaskHex: fixedWidthHex(vector.compareMask, dataWidth),
    registerNameVhdl: toVhdlStringText(vector.registerName),
    writeValueHex:
      vector.writeValue === undefined ? undefined : fixedWidthHex(vector.writeValue, dataWidth),
  };
}

function toVhdlStringText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f"]/g, (character) => {
    if (character === '"') {
      return '""';
    }
    return `\\x${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  });
}

function fixedWidthHex(value: number, width: number): string {
  const digits = Math.ceil(width / 4);
  return Math.trunc(value >>> 0)
    .toString(16)
    .toUpperCase()
    .padStart(digits, '0')
    .slice(-digits);
}

function toVhdlIdentifier(objectPath: string): string {
  const leaf = objectPath.split('/').filter(Boolean).pop() ?? objectPath;
  const identifier = leaf.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z]/.test(identifier) ? identifier : `p_${identifier}`;
}

function projectRootRelative(recreateScript: string, outputDirectory: string): string {
  if (path.isAbsolute(recreateScript)) {
    return normalizeTemplatePath(path.relative(outputDirectory, path.dirname(recreateScript)));
  }

  const scriptDirectory = path.dirname(recreateScript);
  const directorySegments = scriptDirectory
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.');
  const outputParentSegments = path
    .normalize(path.dirname(outputDirectory))
    .split(path.sep)
    .filter(Boolean);
  const hasMatchingSuffix = directorySegments.every(
    (segment, index) =>
      outputParentSegments[outputParentSegments.length - directorySegments.length + index] ===
      segment
  );
  if (hasMatchingSuffix) {
    const projectRoot = path.resolve(
      path.dirname(outputDirectory),
      ...directorySegments.map(() => '..')
    );
    return normalizeTemplatePath(path.relative(outputDirectory, projectRoot));
  }

  throw new Error(
    `outputDirectory ${outputDirectory} cannot resolve recreateScript ${recreateScript}; ` +
      'place verification output beside the recreation script directory'
  );
}

function normalizeTemplatePath(relativePath: string): string {
  return relativePath === '' ? '.' : relativePath.split(path.sep).join('/');
}

function resolveTemplatesDirectory(): string {
  const candidates = [
    path.resolve(__dirname, '../../generator/templates'),
    path.resolve(__dirname, 'templates'),
    path.resolve(__dirname, '../templates'),
  ];
  const templatesDirectory = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, templateNames.makefile))
  );
  if (!templatesDirectory) {
    throw new Error('System verification templates could not be located.');
  }
  return templatesDirectory;
}
