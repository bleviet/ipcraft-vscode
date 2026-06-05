import { useMemo } from 'react';
import type { IpCore } from '../../types/ipCore';
import { matchPorts, type ProtocolMatch } from '../utils/protocolMatcher';

export interface SuggestionChip extends ProtocolMatch {
  /** Unique key for React list rendering and dismissal */
  id: string;
}

const SUGGESTION_THRESHOLD = 0.75;

/**
 * Computes protocol suggestion chips for unassigned ports.
 *
 * A port is considered "claimed" if its name starts with any existing
 * busInterface's physicalPrefix. Only unclaimed ports are fed to the matcher.
 * Suggestions above SUGGESTION_THRESHOLD are returned as chips.
 */
export function useProtocolSuggestions(ipCore: IpCore): SuggestionChip[] {
  return useMemo(() => {
    const allPorts = ipCore.ports ?? [];
    if (allPorts.length === 0) {
      return [];
    }

    // Build set of port names already claimed by existing bus interfaces.
    const claimedNames = new Set<string>();
    for (const bus of ipCore.busInterfaces ?? []) {
      const prefix = bus.physicalPrefix ?? '';
      for (const p of allPorts) {
        if (prefix && p.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          claimedNames.add(p.name);
        }
      }
    }

    const unclaimed = allPorts.filter((p) => !claimedNames.has(p.name));
    if (unclaimed.length === 0) {
      return [];
    }

    const matches = matchPorts(unclaimed.map((p) => ({ name: p.name, direction: p.direction })));

    return matches
      .filter((m) => m.score >= SUGGESTION_THRESHOLD)
      .map((m, i) => ({
        ...m,
        id: `suggestion-${m.busType}-${m.detectedPrefix}-${i}`,
      }));
  }, [ipCore.ports, ipCore.busInterfaces]);
}
