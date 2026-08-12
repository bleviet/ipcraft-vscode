import type {
  BusContract,
  BusContractPort,
  BusDefinitionFile,
} from '../../domain/busDefinition.types';
import type { BusInterface, Parameter } from '../../domain/ipcore.types';
import type { WidthExprNode } from '../widthExprAst';

export type DocumentPath = readonly (string | number)[];
export type InterfaceKind = 'memoryMapped' | 'streaming' | 'conduit';
export type CanonicalPortRole = 'clock' | 'reset' | 'data' | 'byteQualifier' | 'control';

export interface BusDefinitionSource {
  sourceFile: string;
  sourceKind: 'builtin' | 'workspace' | 'configured' | 'ipLocal';
  definitions: BusDefinitionFile;
}

export interface BusLibraryDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  sourceFile: string;
  path: DocumentPath;
  message: string;
}

export interface NormalizedBusLibrary {
  definitions: Readonly<Record<string, BusDefinitionContract>>;
  aliases: readonly NormalizedBusAlias[];
  diagnostics: readonly BusLibraryDiagnostic[];
}

type RawPropertyDeclarations = NonNullable<BusContract['interfaceProperties']>;
export type NormalizedDerivedWidth = NonNullable<BusContractPort['derivedWidth']>;
export type NormalizedPropertyDerivation = NonNullable<RawPropertyDeclarations[string]['derive']>;
interface NormalizedConstraintBase {
  ruleId: string;
  code: string;
  severity: 'error' | 'warning';
  message?: string;
}

type ConstraintSubject = { port?: string; property?: string };

export type NormalizedBusConstraint =
  | (NormalizedConstraintBase &
      ConstraintSubject & { kind: 'range'; minimum?: number; maximum?: number })
  | (NormalizedConstraintBase &
      ConstraintSubject & {
        kind: 'allowedValues';
        values: readonly (number | string | boolean)[];
      })
  | (NormalizedConstraintBase & ConstraintSubject & { kind: 'multipleOf'; value: number })
  | (NormalizedConstraintBase &
      ConstraintSubject & { kind: 'powerOfTwo'; minimum?: number; maximum?: number })
  | (NormalizedConstraintBase & { kind: 'portWidthsEqual'; ports: readonly string[] })
  | (NormalizedConstraintBase & {
      kind: 'portWidthQuotient';
      port: string;
      dividendPort: string;
      divisor: number;
    })
  | (NormalizedConstraintBase & {
      kind: 'productEqualsPort';
      port: string;
      properties: readonly string[];
    })
  | (NormalizedConstraintBase & {
      kind: 'portPresenceRequires';
      port: string;
      requires: readonly string[];
    })
  | (NormalizedConstraintBase & {
      kind: 'propertyRequiredWhenPortPresent';
      port: string;
      property: string;
    })
  | (NormalizedConstraintBase & {
      kind: 'propertyFitsPort';
      port: string;
      property: string;
    });

export interface BusDefinitionContract {
  /** Explicit declarative contract version, or null for a legacy structural-only definition. */
  version: 1 | null;
  key: string;
  canonicalVlnv: string;
  displayName: string;
  interfaceKind: InterfaceKind;
  modePolicy: NormalizedModePolicy;
  ports: readonly NormalizedBusPort[];
  interfaceProperties: Readonly<Record<string, NormalizedPropertyDeclaration>>;
  constraints: readonly NormalizedBusConstraint[];
  sourceFile: string;
  sourceKind: BusDefinitionSource['sourceKind'];
  artifactSource?: 'vivado' | 'workspace';
}

export interface NormalizedModePolicy {
  producer: string;
  consumer: string;
  aliases: Readonly<Record<string, string>>;
}

export interface NormalizedBusAlias {
  kind: 'short' | 'vlnv';
  canonicalVlnv: string;
  shortValue?: string;
  vendor?: string;
  library?: string;
  name?: string;
  version?: string;
}

export interface NormalizedBusPort {
  name: string;
  width?: number | string;
  direction?: 'in' | 'out';
  presence: 'required' | 'optional';
  role: CanonicalPortRole;
  widthPolicy: 'root' | 'derived' | 'fixed';
  derivedWidth?: NormalizedDerivedWidth;
  overrideConstraintRuleId?: string;
}

export interface NormalizedPropertyDeclaration {
  type: 'integer' | 'boolean' | 'string';
  default?: number | boolean | string;
  minimum?: number;
  maximum?: number;
  allowedValues?: readonly (number | boolean | string)[];
  derive?: NormalizedPropertyDerivation;
}

export interface CanonicalBusMatch {
  key: string;
  canonicalVlnv: string;
  contract: BusDefinitionContract;
  matchedBy: 'canonicalVlnv' | 'shortAlias' | 'structuredAlias';
}

export type ResolutionState = 'concrete' | 'symbolic' | 'unresolved' | 'invalid';

export interface ResolvedNumericValue {
  state: ResolutionState;
  value?: number;
  expression?: WidthExprNode;
  reason?: string;
}

export interface ResolveBusInterfaceInput {
  busInterface: BusInterface;
  busIndex: number;
  parameters: readonly Parameter[];
  library: NormalizedBusLibrary;
}

export interface ValidateBusInterfacesInput {
  busInterfaces: readonly BusInterface[];
  parameters: readonly Parameter[];
  library: NormalizedBusLibrary;
}

export interface BusConformanceDiagnostic {
  code: string;
  ruleId: string;
  severity: 'error' | 'warning';
  state: ResolutionState;
  interfaceName: string;
  path: DocumentPath;
  message: string;
  suggestedValue?: number;
}

export type ResolvedSemanticValue =
  | ResolvedNumericValue
  | {
      state: ResolutionState;
      value?: boolean | string;
      reason?: string;
    };

export interface ResolvedBusPort extends NormalizedBusPort {
  effectiveDirection?: 'in' | 'out';
  effectiveWidth: ResolvedNumericValue;
}

export interface BusInterfaceResolution {
  match: CanonicalBusMatch | null;
  normalizedMode: string | null;
  authoredPortWidths: Readonly<Record<string, number | string>>;
  authoredProperties: Readonly<Record<string, number | string | boolean>>;
  portWidths: Readonly<Record<string, ResolvedNumericValue>>;
  properties: Readonly<Record<string, ResolvedSemanticValue>>;
  activePorts: readonly ResolvedBusPort[];
  diagnostics: readonly BusConformanceDiagnostic[];
}
