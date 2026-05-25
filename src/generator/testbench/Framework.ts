import type { TemplateLoader } from '../TemplateLoader';
import type { Engine } from './Engine';

export interface TestbenchContext {
  /** Entity / module name (lowercase). */
  name: string;
  /** The full Nunjucks template context built by IpCoreScaffolder. */
  templateContext: Record<string, unknown>;
  /** Template renderer. */
  templates: TemplateLoader;
  /** True when the target HDL is SystemVerilog. */
  isSv: boolean;
  /** True when the IP core has a memory-mapped slave bus interface. */
  hasMmSlave: boolean;
}

/** Testbench framework abstraction — decides which files to emit. */
export interface Framework {
  readonly id: string;
  readonly displayName: string;
  /** Produce the set of testbench files for the given context + engine. */
  generate(ctx: TestbenchContext, engine: Engine): Record<string, string>;
}
