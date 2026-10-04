import type { BusRuleProvider } from './types';
import type { BusTypeInfo } from '../types';
import { canonicalizeBusType, type NormalizedBusLibrary } from '../../shared/busContracts';

export class BusRuleRegistry {
  private readonly byVlnv = new Map<string, BusRuleProvider>();

  register(provider: BusRuleProvider): this {
    this.byVlnv.set(provider.canonicalVlnv, provider);
    return this;
  }

  matchVlnv(name: string): BusRuleProvider | undefined {
    return this.byVlnv.get(name);
  }

  /** Resolve a bus type string (VLNV or alias) to BusTypeInfo for template use. */
  normalize(typeName: string, library: NormalizedBusLibrary): BusTypeInfo {
    const match = canonicalizeBusType(typeName, library);
    const provider = match ? this.matchVlnv(match.canonicalVlnv) : undefined;
    if (provider) {
      return { libraryKey: provider.libraryKey, templateType: provider.id };
    }
    return { libraryKey: '', templateType: 'custom' };
  }
}
