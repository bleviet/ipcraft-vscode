import type {
  BusContractPort,
  BusDefinitionEntry,
  PropertyDeclaration,
} from '../../domain/busDefinition.types';
import type {
  BusLibraryDiagnostic,
  CanonicalPortRole,
  DocumentPath,
  NormalizedBusPort,
  NormalizedPropertyDeclaration,
} from './types';

const CANONICAL_ROLES = new Set<CanonicalPortRole>([
  'clock',
  'reset',
  'data',
  'byteQualifier',
  'control',
]);

export function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return Object.freeze(items.map((item: unknown) => cloneAndFreeze(item))) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cloned = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)])
    );
    return Object.freeze(cloned) as T;
  }
  return value;
}

export function addLibraryDiagnostic(
  diagnostics: BusLibraryDiagnostic[],
  sourceFile: string,
  code: string,
  severity: 'error' | 'warning',
  path: DocumentPath,
  message: string
): void {
  diagnostics.push({ code, severity, sourceFile, path, message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function canonicalVlnv(entry: BusDefinitionEntry): string | null {
  const busType = entry.busType;
  if (
    !busType ||
    !isNonEmptyString(busType.vendor) ||
    !isNonEmptyString(busType.library) ||
    !isNonEmptyString(busType.name) ||
    !isNonEmptyString(busType.version)
  ) {
    return null;
  }
  return `${busType.vendor}:${busType.library}:${busType.name}:${busType.version}`;
}

export function busDisplayName(entry: BusDefinitionEntry): string {
  if (entry.busType.displayName) {
    return entry.busType.displayName;
  }
  return entry.busType.name
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

export function normalizePort(
  port: BusContractPort,
  key: string,
  index: number,
  sourceFile: string,
  diagnostics: BusLibraryDiagnostic[]
): NormalizedBusPort | null {
  if (!isNonEmptyString(port.name)) {
    addLibraryDiagnostic(
      diagnostics,
      sourceFile,
      'BUS_DEF_INVALID_PORT',
      'error',
      [key, 'ports', index, 'name'],
      'Bus port names must be non-empty strings.'
    );
    return null;
  }

  let role: CanonicalPortRole = 'control';
  if (port.role !== undefined) {
    if (CANONICAL_ROLES.has(port.role as CanonicalPortRole)) {
      role = port.role as CanonicalPortRole;
    } else {
      addLibraryDiagnostic(
        diagnostics,
        sourceFile,
        'BUS_DEF_UNKNOWN_PORT_ROLE',
        'warning',
        [key, 'ports', index, 'role'],
        `Unknown role '${port.role}' on port '${port.name}'; treating it as control.`
      );
    }
  }

  const widthPolicy = port.widthPolicy ?? (port.derivedWidth ? 'derived' : 'root');
  if (widthPolicy === 'derived' && !port.derivedWidth) {
    addLibraryDiagnostic(
      diagnostics,
      sourceFile,
      'BUS_DEF_INVALID_DERIVATION',
      'error',
      [key, 'ports', index, 'derivedWidth'],
      `Derived port '${port.name}' must declare derivedWidth.`
    );
    return null;
  }
  if (widthPolicy !== 'derived' && port.derivedWidth) {
    addLibraryDiagnostic(
      diagnostics,
      sourceFile,
      'BUS_DEF_INVALID_DERIVATION',
      'error',
      [key, 'ports', index, 'derivedWidth'],
      `Only a derived port may declare derivedWidth.`
    );
    return null;
  }

  return cloneAndFreeze({
    name: port.name,
    ...(port.width !== undefined ? { width: port.width } : {}),
    ...(port.direction !== undefined ? { direction: port.direction } : {}),
    presence: port.presence ?? 'required',
    role,
    widthPolicy,
    ...(port.derivedWidth ? { derivedWidth: port.derivedWidth } : {}),
    ...(port.overrideConstraintRuleId
      ? { overrideConstraintRuleId: port.overrideConstraintRuleId }
      : {}),
  });
}

export function normalizeProperty(
  declaration: PropertyDeclaration
): NormalizedPropertyDeclaration | null {
  if (!['integer', 'boolean', 'string'].includes(declaration.type)) {
    return null;
  }
  const matchesType = (value: unknown): boolean => {
    if (declaration.type === 'integer') {
      return typeof value === 'number' && Number.isSafeInteger(value);
    }
    return typeof value === declaration.type;
  };
  if (declaration.default !== undefined && !matchesType(declaration.default)) {
    return null;
  }
  if (declaration.allowedValues?.some((value) => !matchesType(value))) {
    return null;
  }
  if (
    declaration.type !== 'integer' &&
    (declaration.minimum !== undefined ||
      declaration.maximum !== undefined ||
      declaration.derive !== undefined)
  ) {
    return null;
  }
  if (
    declaration.type === 'integer' &&
    ((declaration.minimum !== undefined && !Number.isSafeInteger(declaration.minimum)) ||
      (declaration.maximum !== undefined && !Number.isSafeInteger(declaration.maximum)) ||
      (declaration.minimum !== undefined &&
        declaration.maximum !== undefined &&
        declaration.minimum > declaration.maximum) ||
      (typeof declaration.default === 'number' &&
        ((declaration.minimum !== undefined && declaration.default < declaration.minimum) ||
          (declaration.maximum !== undefined && declaration.default > declaration.maximum))))
  ) {
    return null;
  }
  if (
    declaration.default !== undefined &&
    declaration.allowedValues !== undefined &&
    !declaration.allowedValues.includes(declaration.default)
  ) {
    return null;
  }
  return cloneAndFreeze({
    type: declaration.type,
    ...(declaration.default !== undefined ? { default: declaration.default } : {}),
    ...(declaration.minimum !== undefined ? { minimum: declaration.minimum } : {}),
    ...(declaration.maximum !== undefined ? { maximum: declaration.maximum } : {}),
    ...(declaration.allowedValues !== undefined
      ? { allowedValues: declaration.allowedValues }
      : {}),
    ...(declaration.derive ? { derive: declaration.derive } : {}),
  });
}
