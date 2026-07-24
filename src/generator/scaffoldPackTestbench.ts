import type { ScaffoldFileRule, ScaffoldPack } from './types';

const TESTBENCH_SOURCE_PATTERN =
  /(?:^|\/)(?:tb|testbench|sim|simulation)\/[^/]+\.(?:vhd|vhdl|sv|py|tcl)$|(?:^|\/)(?:tb_|test_).+\.(?:vhd|vhdl|sv|py|tcl)$|(?:^|\/).+_(?:tb|test)\.(?:vhd|vhdl|sv|py|tcl)$/;
const SIMULATION_RUNNER_PATTERN =
  /(?:^|\/)(?:makefile|[^/]+\.mk|(?:run|sim|compile)[^/]*\.(?:sh|py|tcl)|[^/]+\.(?:do|gtkw|wcfg)|conftest\.py)$/;

function normalizedTargets(files: ScaffoldFileRule[]): string[] {
  return files.map((file) => file.target.replace(/\\/g, '/').toLowerCase());
}

/**
 * A full-generation pack owns its simulation environment when its manifest
 * declares both testbench-like output and a build/run entry point. Requiring
 * both signals avoids changing existing packs that merely add a simulation
 * helper while still relying on IPCraft's framework testbench.
 */
export function packOwnsSimulationEnvironment(pack: ScaffoldPack): boolean {
  if (pack.fullGeneration !== true) {
    return false;
  }
  const targets = normalizedTargets(pack.files);
  const sourceTargets = targets.filter((target) => TESTBENCH_SOURCE_PATTERN.test(target));
  const runnerTargets = targets.filter((target) => SIMULATION_RUNNER_PATTERN.test(target));
  return sourceTargets.some((source) => runnerTargets.some((runner) => runner !== source));
}

/**
 * Explicit manifest choices always win. When the setting is omitted, preserve
 * the historical default except for full-generation packs that demonstrably
 * provide their own complete simulation environment.
 */
export function shouldGenerateFrameworkTestbench(pack: ScaffoldPack): boolean {
  if (pack.generateFrameworkTestbenchDeclared) {
    return pack.generateFrameworkTestbench !== false;
  }
  return !packOwnsSimulationEnvironment(pack);
}
