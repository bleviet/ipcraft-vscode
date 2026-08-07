import YAML from 'yaml';
import {
  SystemVerificationConfig,
  SystemVerificationTarget,
} from '../../domain/systemVerification.types';

const configKeys = [
  'recreateScript',
  'part',
  'designName',
  'clockPath',
  'clockPeriodNs',
  'resetPath',
  'resetActiveLow',
  'resetCycles',
  'target',
] as const;

const targetKeys = ['driveInterfacePath', 'instancePath', 'memoryMap'] as const;

type UnknownRecord = Record<string, unknown>;

export function parseSystemVerificationConfig(
  text: string,
  sourcePath: string
): SystemVerificationConfig {
  const document = YAML.parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`${sourcePath}: ${document.errors[0].message}`);
  }

  const value: unknown = document.toJS() as unknown;
  const config = requireRecord(value, sourcePath);
  validateKeys(config, configKeys, sourcePath);

  const target = requireRecord(config.target, 'target');
  validateKeys(target, targetKeys, 'target');

  return {
    recreateScript: requireString(config.recreateScript, 'recreateScript'),
    part: requireString(config.part, 'part'),
    designName: requireString(config.designName, 'designName'),
    clockPath: requireString(config.clockPath, 'clockPath'),
    clockPeriodNs: requirePositiveNumber(config.clockPeriodNs, 'clockPeriodNs'),
    resetPath: requireString(config.resetPath, 'resetPath'),
    resetActiveLow: requireBoolean(config.resetActiveLow, 'resetActiveLow'),
    resetCycles: requirePositiveInteger(config.resetCycles, 'resetCycles'),
    target: parseTarget(target),
  };
}

export function createSystemVerificationConfigText(config: SystemVerificationConfig): string {
  return YAML.stringify({
    recreateScript: config.recreateScript,
    part: config.part,
    designName: config.designName,
    clockPath: config.clockPath,
    clockPeriodNs: config.clockPeriodNs,
    resetPath: config.resetPath,
    resetActiveLow: config.resetActiveLow,
    resetCycles: config.resetCycles,
    target: {
      driveInterfacePath: config.target.driveInterfacePath,
      instancePath: config.target.instancePath,
      memoryMap: config.target.memoryMap,
    },
  });
}

function parseTarget(target: UnknownRecord): SystemVerificationTarget {
  return {
    driveInterfacePath: requireString(target.driveInterfacePath, 'target.driveInterfacePath'),
    instancePath: requireString(target.instancePath, 'target.instancePath'),
    memoryMap: requireString(target.memoryMap, 'target.memoryMap'),
  };
}

function requireRecord(value: unknown, field: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be a mapping`);
  }

  return value as UnknownRecord;
}

function validateKeys(value: UnknownRecord, allowedKeys: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${field}.${key} is not supported`);
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }

  return value;
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be greater than zero`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }

  return value;
}
