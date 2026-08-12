import type { BusDefinitionContract } from './types';

export function isDeclarativeContract(
  contract: BusDefinitionContract | null | undefined
): contract is BusDefinitionContract & { version: 1 } {
  return contract?.version === 1;
}
