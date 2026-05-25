import type * as vscode from 'vscode';
import type { SynthesisToolchain } from './SynthesisToolchain';
import { VivadoToolchain } from './VivadoToolchain';
import { QuartusToolchain } from './QuartusToolchain';

const TOOLCHAINS: SynthesisToolchain[] = [new VivadoToolchain(), new QuartusToolchain()];

/** Return the toolchain registered under `id`, or undefined. */
export function getToolchain(id: string): SynthesisToolchain | undefined {
  return TOOLCHAINS.find((t) => t.id === id);
}

/** Return all toolchains whose availability can be confirmed from the current config. */
export function listAvailable(cfg: vscode.WorkspaceConfiguration): SynthesisToolchain[] {
  return TOOLCHAINS.filter((t) => t.isAvailable(cfg));
}

/** Return all registered toolchains (available or not). */
export function listAll(): SynthesisToolchain[] {
  return [...TOOLCHAINS];
}
