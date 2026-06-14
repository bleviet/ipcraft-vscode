export interface BusRuleProvider {
  readonly id: string;
  readonly vlnvNames: readonly string[];
  readonly aliases: readonly string[];
  readonly libraryKey: string;
  readonly isMemoryMapped: boolean;
}
