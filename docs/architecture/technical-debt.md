# Known Technical Debt

Actionable items identified during the 2026-05-25 architecture review (post-refactor, at commit `2b2cbde`). Each item is independent and self-contained — any one can be shipped as a single PR.

---

## TD-1 — `projectCreator.ts` branch-dispatches on vendor string

`src/commands/projectCreator.ts` (`createVendorProject`) uses an `if (toolchainId === 'vivado') ... else if (toolchainId === 'quartus')` dispatch to manually assemble the project-creation launch for each vendor. This is the last callsite that bypasses the `SynthesisToolchain` strategy.

**Recommendation:** Add a `createProject(name, ipDir, cfg, outputChannel)` method to the `SynthesisToolchain` interface. Both `VivadoToolchain` and `QuartusToolchain` implement it, and `projectCreator.ts` becomes a thin delegation:

```ts
export async function createVendorProject(
  toolchainId: string, name: string, ipDir: string, outputChannel: OutputChannel
): Promise<boolean> {
  const toolchain = getToolchain(toolchainId);
  if (!toolchain) return false;
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  return toolchain.createProject(name, ipDir, cfg, outputChannel);
}
```

**Effort:** ~60 LOC across 3 files. Extend existing `VivadoToolchain.test.ts` and `QuartusToolchain.test.ts`.

---

## TD-2 — `TEMPLATE_TYPE_TO_ALTERA` embedded in the scaffolder

`src/generator/IpCoreScaffolder.ts` (~line 316) contains a bus-type translation table specific to the Altera `_hw.tcl` template:

```ts
const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
  axil: 'axi4lite', axi4: 'axi4', axis: 'axi4stream',
  avmm: 'avalon',   avst: 'avalon_streaming',
};
```

This table is only consumed by the `altera_hw_tcl.j2` template context. A future Lattice/Microchip target would need a parallel `TEMPLATE_TYPE_TO_<vendor>` map, growing the scaffolder further.

**Recommendation:** Move the map to `QuartusToolchain.ts` as a `mapBusType(busType: string): string` method (matching the pattern of `quartusDeviceFamily()`). Have `QuartusToolchain.scaffold()` inject `altera_type` into the template context rather than the scaffolder doing it for all interfaces unconditionally.

**Effort:** ~30 LOC across 2 files.

---

## TD-3 — `SimulationConfig.compileArgs` / `simArgs` / `env` silently ignored by generator

The `SimulationConfig` type and JSON schema define `compileArgs`, `simArgs`, and `env` fields. `IpCoreScaffolder.generateAll()` reads `simulation.framework` and `simulation.engine` but ignores the rest — the fields are validated by AJV but never forwarded to the template context.

**Recommendation:** Forward `simCfg.compileArgs` and `simCfg.simArgs` into `TestbenchContext` and have `CocotbFramework` / `VUnitFramework` append them to the engine's default flag lists. Forward `simCfg.env` so `conftest.py` / `run.py` can set those variables before launching the simulator.

**Effort:** ~40 LOC across `Framework.ts`, `CocotbFramework.ts`, `VUnitFramework.ts`, and their templates.

---

## TD-4 — `QuestaEngine.waveArgs` returns a flag+value as one string element

`src/generator/testbench/engines/QuestaEngine.ts` (~line 18):

```ts
waveArgs(entityName: string): string[] {
  return [`-wlf ${entityName}.wlf`];
}
```

This returns a single string element containing a space-separated flag+value pair. `spawn()` consumers expect each flag and its value as separate array elements. It should return `['-wlf', `${entityName}.wlf`]`. If the intent is template-string interpolation rather than process args, that contract must be documented explicitly.

**Effort:** 1 line + 1 test assertion.

---

## TD-5 — Duplicated `fileExists()` utility

Three copies of the same async `fileExists` helper exist:

- `src/commands/projectCreator.ts`
- `src/services/toolchains/QuartusToolchain.ts`
- `src/services/toolchains/VivadoToolchain.ts`

**Recommendation:** Extract to `src/utils/fsHelpers.ts` (which already exists) and replace all three inline definitions with an import.

**Effort:** ~15 LOC — one new export + 3 import changes.

---

## Out-of-scope follow-ups

These are lower-priority items that do not block current functionality:

- **`xilinx/` / `altera/` directory names** — `outputSubdir` on `SynthesisToolchain` is already the right home for configurable branding (e.g. `amd/` instead of `xilinx/`). No change needed until branding alignment is required.
- **`ipcraft.toolbar.targets` multi-select** — currently uses a three-value vendor enum. Needs to become a dynamic multi-select when vendor count exceeds two. Coupled with the `generate.targets` string[] setting already in use.
- **VUnit SystemVerilog testbench** — `VUnitFramework.generate()` only emits a VHDL testbench (`_tb.vhd`). An SV variant is deferred; VUnit's SV simulator support is limited.
- **`ToolDetector.ts` sub-tool detection** — `qsys-edit` detection is still special-cased outside the generic toolchain loop. Consider adding a `subTools` property to `LaunchableTool` / `SynthesisToolchain` so each toolchain declares its own sub-tools and their VS Code context keys.
