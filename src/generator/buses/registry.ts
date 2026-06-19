import type { BusRuleProvider } from './types';
import type { BusTypeInfo } from '../types';

export class BusRuleRegistry {
  private readonly byVlnv = new Map<string, BusRuleProvider>();
  private readonly byAlias = new Map<string, BusRuleProvider>();

  register(provider: BusRuleProvider): this {
    for (const name of provider.vlnvNames) {
      this.byVlnv.set(name.toLowerCase(), provider);
    }
    for (const alias of provider.aliases) {
      this.byAlias.set(alias.toUpperCase().replace(/[\s_.-]/g, ''), provider);
    }
    return this;
  }

  matchVlnv(name: string): BusRuleProvider | undefined {
    return this.byVlnv.get(name.toLowerCase());
  }

  matchAlias(normalized: string): BusRuleProvider | undefined {
    return this.byAlias.get(normalized.toUpperCase().replace(/[\s_.-]/g, ''));
  }

  /** Resolve a bus type string (VLNV or alias) to BusTypeInfo for template use. */
  normalize(typeName: string): BusTypeInfo {
    const vlnvMatch = /^ipcraft:busif:(.+?):\d/.exec(typeName);
    if (vlnvMatch) {
      const provider = this.matchVlnv(vlnvMatch[1]);
      if (provider) {
        return { libraryKey: provider.libraryKey, templateType: provider.id };
      }
      return { libraryKey: '', templateType: 'custom' };
    }
    const provider = this.matchAlias(typeName);
    if (provider) {
      return { libraryKey: provider.libraryKey, templateType: provider.id };
    }
    return { libraryKey: '', templateType: 'custom' };
  }

  isMemoryMapped(templateType: string): boolean {
    for (const provider of this.byVlnv.values()) {
      if (provider.id === templateType) {
        return provider.isMemoryMapped;
      }
    }
    return false;
  }
}
