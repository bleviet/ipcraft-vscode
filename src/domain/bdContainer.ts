/** Pure helpers for Vivado block design containers (see `SystemInstance.container`). */

import type { BdTclEvidence, SystemInstance } from './systemGraph';

const stripBd = (name: string) => name.replace(/\.bd$/, '');

/** Active synthesis BD and the other BDs of a container, `.bd` stripped. */
export function containerDesigns(
  instance: SystemInstance
): { active: string; alternatives: string[] } | undefined {
  if (!instance.container) {
    return undefined;
  }
  const activeName = instance.parameters['CONFIG.ACTIVE_SYNTH_BD'];
  const active = activeName ? stripBd(activeName) : instance.container.reference;
  const alternatives = (instance.parameters['CONFIG.LIST_SYNTH_BD'] ?? '')
    .split(':')
    .map((name) => stripBd(name.trim()))
    .filter((name) => name !== '' && name !== active);
  return { active, alternatives };
}

/** How the Tcl script of a container was found, for the user. */
export const BD_EVIDENCE_TEXT: Record<BdTclEvidence, string> = {
  link: 'linked in .ipcraft/bd-links.json',
  cmake: 'listed in the CMake project',
  design_name: 'design_name matches',
  file_name: 'file name matches',
};
