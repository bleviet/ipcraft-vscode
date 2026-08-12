import type { IpCoreData, BusDefinitions } from '../types';
import type { BusRuleRegistry } from '../buses/registry';
import type { NormalizedBusLibrary } from '../../shared/busContracts';

export interface ResolverInput {
  readonly ipCore: IpCoreData;
  readonly registers: readonly Record<string, unknown>[];
  readonly busDefinitions: BusDefinitions;
  readonly busLibrary: NormalizedBusLibrary;
  readonly registry: BusRuleRegistry;
}

export interface ContextResolver {
  readonly name: string;
  resolve(input: ResolverInput): Record<string, unknown>;
}

export interface ContractDiagnostic {
  readonly field: string;
  readonly message: string;
}
