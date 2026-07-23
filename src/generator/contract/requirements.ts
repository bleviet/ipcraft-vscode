import type { HdlLanguage, ScaffoldPack } from '../types';

export interface PackRequirementsInput {
  hdlLanguage: HdlLanguage;
  /** Short bus type id of the IP core's primary slave interface (e.g. "avmm", "axil"). */
  busType: string;
  hasMemoryMappedSlave: boolean;
  /** Logical port names active on the primary bus interface (post useOptionalPorts/absentPorts). */
  activeBusPortNames: string[];
}

/**
 * Validates an IP core / generate options pairing against a scaffold pack's declared
 * `requirements` (issue #152) before any file is rendered or written. Throws a single Error
 * listing every unmet requirement so `generate`/`verify` fail fast with an actionable message
 * instead of silently producing a partial or invalid file tree.
 *
 * Passes silently when the pack declares no `requirements` — unversioned/legacy manifests
 * accept any input, matching pre-existing behavior.
 */
export function checkPackRequirements(pack: ScaffoldPack, input: PackRequirementsInput): void {
  const requirements = pack.requirements;
  if (!requirements) {
    return;
  }

  const reasons: string[] = [];
  const activeLower = new Set(input.activeBusPortNames.map((n) => n.toLowerCase()));

  if (requirements.hdlLanguages && !requirements.hdlLanguages.includes(input.hdlLanguage)) {
    reasons.push(
      `requires HDL language ${formatList(requirements.hdlLanguages)}, but generation targets '${input.hdlLanguage}'`
    );
  }

  if (requirements.busTypes && !requirements.busTypes.includes(input.busType)) {
    reasons.push(
      `requires bus type ${formatList(requirements.busTypes)}, but the IP core's primary slave interface is '${input.busType}'`
    );
  }

  if (requirements.memoryMappedSlave === 'required' && !input.hasMemoryMappedSlave) {
    reasons.push('requires a memory-mapped slave interface, but the IP core has none');
  }
  if (requirements.memoryMappedSlave === 'forbidden' && input.hasMemoryMappedSlave) {
    reasons.push('requires no memory-mapped slave interface, but the IP core has one');
  }

  if (requirements.minimumBusPorts && requirements.minimumBusPorts.length > 0) {
    const missing = requirements.minimumBusPorts.filter(
      (port) => !activeLower.has(port.toLowerCase())
    );
    if (missing.length > 0) {
      reasons.push(
        `requires bus ports ${formatList(requirements.minimumBusPorts)}, but the primary bus interface is missing: ${missing.join(', ')}`
      );
    }
  }

  if (reasons.length > 0) {
    throw new Error(
      `Scaffold pack '${pack.name}' is incompatible with this IP core:\n` +
        reasons.map((reason) => `  - ${reason}`).join('\n')
    );
  }
}

function formatList(values: string[]): string {
  return `[${values.join(', ')}]`;
}
