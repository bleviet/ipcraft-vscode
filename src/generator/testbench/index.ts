import type { Engine } from './Engine';
import type { Framework, TestbenchContext } from './Framework';
import { GhdlEngine } from './engines/GhdlEngine';
import { IcarusEngine } from './engines/IcarusEngine';
import { VerilatorEngine } from './engines/VerilatorEngine';
import { QuestaEngine } from './engines/QuestaEngine';
import { CocotbFramework } from './frameworks/CocotbFramework';
import { VUnitFramework } from './frameworks/VUnitFramework';

const ENGINES: Engine[] = [
  new GhdlEngine(),
  new IcarusEngine(),
  new VerilatorEngine(),
  new QuestaEngine(),
];

const FRAMEWORKS: Framework[] = [new CocotbFramework(), new VUnitFramework()];

export const DEFAULT_FRAMEWORK = 'cocotb';
export const DEFAULT_ENGINE = 'ghdl';

export function getEngine(id: string): Engine {
  return ENGINES.find((e) => e.id === id) ?? new GhdlEngine();
}

export function getFramework(id: string): Framework {
  return FRAMEWORKS.find((f) => f.id === id) ?? new CocotbFramework();
}

/** Produce testbench files for the given framework + engine combination. */
export function generateTestbenchFiles(
  frameworkId: string,
  engineId: string,
  ctx: TestbenchContext
): Record<string, string> {
  const framework = getFramework(frameworkId);
  const engine = getEngine(engineId);
  return framework.generate(ctx, engine);
}

export type { Engine, Framework, TestbenchContext };
