import type { TemplateLoader } from '../TemplateLoader';
import type { Engine } from './Engine';

export interface FileSetFileEntry {
  path: string;
  type: string;
  isIncludeFile?: boolean;
}

export interface FileSetEntry {
  name: string;
  files?: FileSetFileEntry[];
}

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
  /** Extra compile-time flags from simulation.compileArgs. */
  extraCompileArgs?: string[];
  /** Extra simulation-time flags from simulation.simArgs. */
  extraSimArgs?: string[];
  /** Extra environment variables from simulation.env. */
  extraEnv?: Record<string, string>;
  /** File sets from the .ip.yml. Only consulted for include-file directories
   *  (isIncludeFile entries) — RTL sources to compile come from rtlSourceFiles. */
  fileSets?: FileSetEntry[];
  /** Final, compile-ordered RTL source paths (relative to the IP core root, e.g.
   *  "rtl/foo_pkg.vhd") — the union of scaffold-pack-generated files and any
   *  hand-authored ones declared in fileSets. Falls back to the framework's own
   *  entity-name convention when empty/omitted. */
  rtlSourceFiles?: string[];
}

/** Testbench framework abstraction — decides which files to emit. */
export interface Framework {
  readonly id: string;
  readonly displayName: string;
  /** Produce the set of testbench files for the given context + engine. */
  generate(ctx: TestbenchContext, engine: Engine): Record<string, string>;
}
