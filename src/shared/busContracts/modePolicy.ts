import type { BusContract } from '../../domain/busDefinition.types';
import type { NormalizedModePolicy } from './types';

export function normalizeModePolicy(
  contract: BusContract | undefined
): NormalizedModePolicy | null {
  if (!contract) {
    return { producer: 'master', consumer: 'slave', aliases: {} };
  }
  const producer = contract.modePolicy?.producer?.trim().toLowerCase();
  const consumer = contract.modePolicy?.consumer?.trim().toLowerCase();
  if (!producer || !consumer || producer === consumer) {
    return null;
  }
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(contract.modePolicy.aliases ?? {})) {
    const normalizedAlias = alias.trim().toLowerCase();
    const normalizedTarget = target.trim().toLowerCase();
    if (!normalizedAlias || (normalizedTarget !== producer && normalizedTarget !== consumer)) {
      return null;
    }
    aliases[normalizedAlias] = normalizedTarget;
  }
  return { producer, consumer, aliases };
}
