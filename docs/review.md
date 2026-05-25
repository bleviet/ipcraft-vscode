# Codebase Architecture Review: Multi-Tool & Vendor Readiness

- **Date of Writing:** 2026-05-25 17:00 (Europe/Berlin)
- **Target Git Hash:** `008812d7b058d83310e4e97cdbfefbe70f794a02`
- **Reviewer:** Architecture review (Claude / Sonnet 4.6, commissioned by Bach Le Viet)
- **Post-refactor Rating:** 2026-05-25 20:30 (Europe/Berlin) -- reviewed at `2b2cbde` by Opus 4.6

---

## 0. Post-Refactor Rating

**Current score: 8.5 / 10 -- Good, with specific opportunities for polish.**

Three commits (`218a3e4`, `8f89b99`, `2b2cbde`) landed since the original review and
address **all four** primary recommendations (SS 4.1--4.4). The implementation is clean,
well-tested (726 unit tests pass, zero lint warnings, zero type errors), and faithfully
follows the Strategy + Registry patterns proposed. The acceptance-test criterion from
SS 4.1 ("adding Questasim is a single new file") is achievable now.

The remaining issues are small and mechanical -- they were flagged as "out-of-scope
follow-ups" in the original review but are worth completing to prevent them from
silently re-accumulating. A new issue (duplicated `fileExists` utility) was introduced
during the refactoring.

### Score breakdown

| Area | Score | Notes |
|------|-------|-------|
| **Toolchain abstraction** (SS 4.1) | 9/10 | Clean `LaunchableTool` -> `SynthesisToolchain` hierarchy. Registry is simple. One deduction: `projectCreator.ts` still branch-dispatches on `toolchainId === 'vivado'` / `'quartus'` instead of delegating to the strategy. |
| **BuildRunner env/mounts** (SS 4.2) | 10/10 | `env`, `extraMounts`, `timeoutMs` all wired. `spawnGui()` extracted cleanly with X11 centralized. |
| **Testbench Framework x Engine** (SS 4.3) | 9/10 | Clean decomposition. VUnit templates are in place. `CocotbFramework` injects `engine_*` context vars. One deduction: `compileArgs` / `simArgs` / `env` from `SimulationConfig` are not forwarded through to the Engine or Makefile context yet (the schema fields exist but the generator ignores them). |
| **Schema + validation** (SS 4.4) | 9/10 | `simulation` block added to schema. AJV validation wired into `loadIpCore()`. Test coverage present. One deduction: `targets` field in schema/data exists but the canonical source of truth for which vendors to target is still `ipcraft.generate.vendor` (an `altera|xilinx|both|none` enum) in `package.json`, not the schema's `targets: string[]` field. |
| **Code hygiene** | 7/10 | Three instances of duplicated `fileExists`. `TEMPLATE_TYPE_TO_ALTERA` still embedded in scaffolder. `targetVendor` toolbar still uses the old three-value enum. |
| **Test coverage** | 9/10 | Comprehensive new tests for toolchains, frameworks, engines, and validator. |

---

## 1. Executive Summary (Original)

**Verdict: Requires moderate, targeted refactoring -- not a rewrite.**

The core engine (`IpCoreScaffolder` -> Nunjucks templates -> `BuildRunner.runProcess`) is
small, layered, and reasonably clean. The data model is permissive (`[key: string]: unknown`
escape hatches), and `BuildRunner` already separates `executable + args + cwd + docker` from
the callers. That foundation will absorb new vendors and simulators **if** three concrete
gaps are addressed first:

1. **No `Toolchain` abstraction.** Each call site re-reads VS Code config, re-resolves the
   executable, re-derives the Docker options, and hard-codes the per-tool flag set
   (`-mode batch -source ...`, `-t ...`, `--flow compile ...`). Adding Questasim or a third
   vendor means another N copy/paste blocks across `BuildCommands.ts`, `projectCreator.ts`,
   `editInIpPackager.ts`, `editInPlatformDesigner.ts`, `openInVivado.ts`, `openInQuartus.ts`.
   **--> RESOLVED in `218a3e4`.**
2. **No `Framework` / `SimulatorEngine` decomposition.** Testbench generation is
   *unconditionally* CocoTB and the simulator is baked into the Makefile template
   (`SIM ?= ghdl`, `SIM ?= icarus`). VUnit is a different orchestration model (VUnit
   *owns* the compile/run flow; Makefile.sim is bypassed), so it cannot be added by
   tweaking the existing template -- a real Strategy split is required.
   **--> RESOLVED in `8f89b99`.**
3. **No env / license / mount injection.** `BuildRunner.runProcess` does not forward
   environment variables and Docker support handles a single mount + no env flags.
   Questasim needs `LM_LICENSE_FILE` / `MGLS_LICENSE_FILE` / `MODEL_TECH` paths and often
   a license-server mount; the current API has nowhere to thread them.
   **--> RESOLVED in `218a3e4`.**

None of these are buried in deep cross-cutting concerns. The refactoring surface is roughly
**~1,000 LOC across ~10 files** (mostly `src/commands/*`, `src/services/BuildRunner.ts`,
`src/generator/IpCoreScaffolder.ts`, and ~5 testbench templates). I recommend doing it
before VUnit/Questasim land, because their differences expose every existing assumption
at once -- adding them on top of the current shape will balloon the duplication.

The Pydantic / JSON schema (`ipcraft-spec/schemas/ip_core.schema.json`) is permissive
enough at the TypeScript runtime layer (`additionalProperties` is *not* enforced by
`js-yaml`), but the upstream schema declares `additionalProperties: false` on most
types -- that is a future trap (see SS 3.3). **--> RESOLVED in `2b2cbde`.**

---

## 2. Technical Debt & Coupling Bottlenecks

### 2.1 Vendor-name string discriminants leak into the generator

`src/generator/types.ts:1` defines:

```ts
export type VendorOption = 'none' | 'altera' | 'xilinx' | 'both';
```

This enum is consumed via direct string comparison at
`src/generator/IpCoreScaffolder.ts:135` and `:139`:

```ts
if (vendor === 'altera' || vendor === 'both') { ... files['altera/...']  ... }
if (vendor === 'xilinx' || vendor === 'both') { ... files['xilinx/...'] ... }
```

The directory names `xilinx/` and `altera/` are also hard-coded paths inside the
generator output and re-discovered later as build-target probes in
`src/commands/BuildCommands.ts:99-100`:

```ts
const xilinxDir = path.join(ipDir, 'xilinx');
const alteraDir = path.join(ipDir, 'altera');
```

Adding a third vendor (e.g. Lattice, Microchip, or even just renaming AMD to its
current branding) means touching at least:
- `types.ts` (enum widening)
- `IpCoreScaffolder.ts` (new branch + new templates)
- `BuildCommands.ts` (new dir probe + new target run block)
- `projectCreator.ts` (new `createXProject` function)
- `package.json` (new `ipcraft.<vendor>.{runner,installDir,dockerImage,defaultPart}` block)
- `ToolDetector.ts` (new context key + binary probe)
- A new resolver in `src/utils/<vendor>Resolver.ts`

That is a 7-file change pattern repeated **per vendor**, which is the textbook
symptom of a missing abstraction.

**Status: MOSTLY RESOLVED.**

- `VendorOption` type has been removed from `types.ts`.
- `IpCoreScaffolder.generateAll` now iterates `options.targets` and delegates to
  `toolchain.scaffold()` -- no vendor-name branching in the scaffolder.
- `BuildCommands.detectTargets()` iterates the toolchain registry -- no hard-coded
  dir probes.
- **Remaining:** `projectCreator.ts` still uses an `if (toolchainId === 'vivado') ... else if (toolchainId === 'quartus')` dispatch (see SS 5.1).
- **Remaining:** `IpCoreScaffolder.buildTemplateContext()` still embeds `TEMPLATE_TYPE_TO_ALTERA` (see SS 5.2).
- **Remaining:** `package.json` setting `ipcraft.generate.vendor` still uses the old
  `none|altera|xilinx|both` enum rather than the `targets: string[]` model (see SS 5.3).

### 2.2 Vendor-specific data tables inside generator code

`src/generator/IpCoreScaffolder.ts:739-778` carries a hard-coded `quartusDeviceFamily()`
mapping of ~10 device prefixes to Quartus family strings. This is reference data, not
behavior -- it should live in `src/data/` alongside `xilinxCatalog.ts` (currently 22
lines) and `boardCatalog.ts` (85 lines). If we add Versal / Spartan-7 / Cyclone 10 GX
support, that function will grow inside the scaffolder rather than in a vendor catalog.

**Status: RESOLVED.** `quartusDeviceFamily()` now lives in
`src/services/toolchains/QuartusToolchain.ts` and is co-located with the Quartus
strategy. Tests exist in `QuartusToolchain.test.ts`.

The same shape exists in `IpCoreScaffolder.ts:333-339`:

```ts
const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
  axil: 'axi4lite', axi4: 'axi4', axis: 'axi4stream',
  avmm: 'avalon',   avst: 'avalon_streaming',
};
```

-- bus-type translation tables sitting inside a 600-line method (`buildTemplateContext`).
A Lattice/Microchip target would add a parallel `TEMPLATE_TYPE_TO_<vendor>` map.

**Status: UNRESOLVED.** This table is still embedded in `IpCoreScaffolder.ts:316-322`.
See SS 5.2 for the recommendation.

### 2.3 Tool launching is duplicated across six command files

Each command file independently constructs the launch sequence:

| File | LOC | Re-reads config | Builds DockerOptions | Owns X11 args |
|---|---|---|---|---|
| `src/commands/BuildCommands.ts:102-118` | 17 | yes | yes | no |
| `src/commands/projectCreator.ts:43-90` | 47 | yes | yes | no |
| `src/commands/editInIpPackager.ts:22-80` | 58 | yes | yes | **yes** |
| `src/commands/editInPlatformDesigner.ts` | similar | yes | yes | **yes** |
| `src/commands/openInVivado.ts` | similar | yes | yes | **yes** |
| `src/commands/openInQuartus.ts` | similar | yes | yes | **yes** |

X11 forwarding logic (`process.env.DISPLAY` check + bind-mount `/tmp/.X11-unix`) is
literally pasted into four files. License-path handling and ENV injection don't exist
yet -- when they're needed, they'll need to be pasted into all six.

**Status: RESOLVED.** All six command files now use the `toolchain.resolve()` /
`toolchain.getDocker()` / `toolchain.getLaunchEnv()` pattern. X11 forwarding is
centralized in `BuildRunner.spawnGui()`. The commands are now 44--81 lines each with
zero copy/paste duplication.

### 2.4 The "Pydantic schema" is not actually enforced at runtime

The JSON schema at `ipcraft-spec/schemas/ip_core.schema.json` is rendered with
`"additionalProperties": false` on `ArrayConfig`, `BusInterface`, `ConduitPort`, `File`,
`Clock`, `Parameter`, `Port`, `Reset`, `Interrupt`, `SubcoreRef`. The runtime
loader in `src/generator/IpCoreScaffolder.ts:288-295` uses `js-yaml` and *doesn't* call
the JSON schema validator (`src/services/YamlValidator.ts`) on the generation path.

**Status: RESOLVED.** `IpCoreScaffolder.loadIpCore()` now calls
`this.validator.validateAgainstSchema(parsed, IP_CORE_SCHEMA_PATH)` and throws on
validation failure. AJV is configured with `allErrors: true, strict: false`.
Test coverage exists for both valid and invalid schemas.

The schema itself has been updated: leaf types that need extensibility (`BusInterface`,
`Port`, `Parameter`, `File`, `ConduitPort`) use `additionalProperties: true`, while
structural types (`IpCore` root, `simulation`, `Reset`, `Clock`, `Interrupt`,
`SubcoreRef`) are closed with `additionalProperties: false`.

### 2.5 Tight binding between testbench and simulator engine

The unit boundary you want -- *Framework (CocoTB | VUnit) _|_ Engine (GHDL | Icarus |
Questasim | Verilator)* -- does not exist.

**Status: RESOLVED.** `src/generator/testbench/` implements the exact
`Framework x Engine` strategy pattern:

- `Framework` interface: `CocotbFramework` and `VUnitFramework`
- `Engine` interface: `GhdlEngine`, `IcarusEngine`, `VerilatorEngine`, `QuestaEngine`
- Factory: `generateTestbenchFiles(frameworkId, engineId, ctx)`
- VS Code settings: `ipcraft.testbench.framework` and `ipcraft.testbench.engine`
- Template files: `vunit_run.py.j2` and `vunit_tb.vhd.j2` added

---

## 3. Toolchain & Simulator Abstraction Evaluation

### 3.1 Current state -- synthesis side

**Status: RESOLVED.** The `src/services/toolchains/` directory implements the full
toolchain abstraction:

- `LaunchableTool` interface: `resolve()`, `getDocker()`, `getLaunchEnv()`, `isAvailable()`
- `SynthesisToolchain` extends `LaunchableTool` with: `outputSubdir`, `contextKey`,
  `scaffold()`, `detectBuildModes()`
- `VivadoToolchain` (178 LOC) and `QuartusToolchain` (184 LOC) -- full implementations
- `registry.ts` with `getToolchain(id)`, `listAvailable(cfg)`, `listAll()`
- `ToolDetector` now iterates the registry generically

### 3.2 Current state -- verification / simulation side

**Status: RESOLVED.** See SS 2.5 above.

### 3.3 Extensibility gaps -- what breaks when VUnit / Questasim are added

| Scenario | Original Status | Post-Refactor Status |
|---|---|---|
| **VUnit + GHDL** | No template chain. | `VUnitFramework.generate()` + `GhdlEngine` produce `run.py` and `_tb.vhd`. |
| **VUnit + Questasim** | All of above + no env. | `QuestaEngine` wired. `BuildRunner` accepts `env`/`extraMounts`. `getLaunchEnv()` ready for `LM_LICENSE_FILE`. |
| **CocoTB + Questasim** | Needed Makefile branch. | `CocotbFramework` injects `engine_sim_var: 'questa'` into template context. |
| **Schema: Questa-specific fields** | `additionalProperties: false` rejects. | `simulation` block with `vendorOptions: { additionalProperties: true }` exists. |
| **Toolchain probe** | Hard-coded 3 tools. | `ToolDetector` iterates registry. Adding Questa = one new file + `registry.ts` entry. |
| **Settings UX** | Sibling groups. | `testbench.framework` + `testbench.engine` settings exist. No `ipcraft.questa.*` settings yet (not needed until Questa is a synthesis tool, not just a sim engine). |
| **License in Docker** | No env/mount support. | `applyDocker()` handles `env` (via `-e`) and `extraMounts` (via `-v`). |

---

## 4. Architectural Recommendations (Original -- Status Summary)

| # | Recommendation | Status |
|---|---|---|
| 4.1 | Introduce `Toolchain` interface (Strategy pattern) | RESOLVED |
| 4.2 | Extend `BuildRunner.runProcess` to accept `env` and multiple Docker mounts | RESOLVED |
| 4.3 | Decompose testbench generation into `Framework x Engine` | RESOLVED |
| 4.4 | Widen schema + reactivate validation | RESOLVED |

---

## 5. Remaining Issues and Recommendations

The items below are small, mechanical improvements. Each is a single-PR change. I
recommend shipping them in this order -- each is independent.

### 5.1 `projectCreator.ts` branch-dispatches on vendor string instead of using strategy

`src/commands/projectCreator.ts:45-88` (`createVendorProject`) has a two-branch
`if (toolchainId === 'vivado') ... else if (toolchainId === 'quartus')` that manually
assembles the launch for each vendor. This should be folded into the
`SynthesisToolchain` interface -- each toolchain knows its own sub-tool, TCL script
naming convention, and build directory layout.

**Recommendation:** Add a `createProject(name, ipDir, cfg, outputChannel)` method to
`SynthesisToolchain`. `VivadoToolchain` and `QuartusToolchain` each implement it,
and `projectCreator.ts` becomes:

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

**Effort:** ~60 LOC across 3 files. Tests: extend existing `VivadoToolchain.test.ts`
and `QuartusToolchain.test.ts`.

### 5.2 `TEMPLATE_TYPE_TO_ALTERA` embedded in scaffolder

`IpCoreScaffolder.ts:316-322` contains a bus-type translation table specific to the
Altera `_hw.tcl` generator:

```ts
const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
  axil: 'axi4lite', axi4: 'axi4', axis: 'axi4stream',
  avmm: 'avalon',   avst: 'avalon_streaming',
};
```

This table is only consumed by the `altera_hw_tcl.j2` template context. It should
be co-located with `QuartusToolchain` (e.g. as a static map or a
`mapBusTypeToAltera()` method), matching the pattern already established for
`quartusDeviceFamily()`.

**Recommendation:** Move the map to `QuartusToolchain.ts` and have the
`scaffold()` method inject `altera_type` into the template context rather than
the scaffolder doing it for all interfaces unconditionally.

**Effort:** ~30 LOC across 2 files.

### 5.3 `ipcraft.generate.vendor` setting uses stale `altera|xilinx|both|none` enum

`package.json:492` still declares:

```json
"ipcraft.generate.vendor": { "enum": ["none", "altera", "xilinx", "both"], "default": "none" }
```

Meanwhile `GenerateOptions.targets` is now `string[]` and the schema's `targets` field
is `string[]`. The old enum prevents adding vendors without a settings-schema change
and does not compose for >2 vendors.

The webview toolbar (`IpCoreApp.tsx`) also still uses `targetVendor` with the three-value
type `'altera' | 'xilinx' | 'both'`.

**Recommendation:** Replace `ipcraft.generate.vendor` with:

```json
"ipcraft.generate.targets": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "Synthesis vendor targets. Each entry must match a registered toolchain id."
}
```

Keep the toolbar picker functional by mapping the old enum to arrays internally during a
deprecation period, or convert the toolbar to a multi-select that dynamically lists
registered toolchains.

**Effort:** ~100 LOC across `package.json`, `GenerateCommands.ts`,
`IpCoreEditorProvider.ts`, `IpCoreApp.tsx`, and the `TargetVendorPicker` component.

### 5.4 Duplicated `fileExists()` utility

Three copies of the same async `fileExists` helper exist:

- `src/commands/projectCreator.ts:14-20`
- `src/services/toolchains/QuartusToolchain.ts:16-22`
- `src/services/toolchains/VivadoToolchain.ts:21-27`

**Recommendation:** Extract to `src/utils/fsHelpers.ts` and import from there.

**Effort:** ~15 LOC (new file + 3 import changes).

### 5.5 `SimulationConfig.compileArgs / simArgs / env` not consumed by the generator

The `SimulationConfig` type and JSON schema define `compileArgs`, `simArgs`, and `env`
fields, but `IpCoreScaffolder.generateAll()` only reads `simulation.framework` and
`simulation.engine`. The extra fields are validated by AJV but silently ignored during
generation.

**Recommendation:** Forward `simCfg.compileArgs` and `simCfg.simArgs` into the
`TestbenchContext` and have `CocotbFramework` / `VUnitFramework` append them to the
engine's default flags in the template context. Similarly, `simCfg.env` should be
available for the conftest/run.py to set as environment variables.

**Effort:** ~40 LOC across `Framework.ts`, `CocotbFramework.ts`, `VUnitFramework.ts`,
and the corresponding templates.

### 5.6 `QuestaEngine.waveArgs` concatenates flag and value

`src/generator/testbench/engines/QuestaEngine.ts:18`:

```ts
waveArgs(entityName: string): string[] {
  return [`-wlf ${entityName}.wlf`];
}
```

This returns a single string element containing a space-separated flag+value pair. It
should return two elements: `['-wlf', `${entityName}.wlf`]` to match how arguments are
consumed by `spawn()`. Alternatively, if the intent is for template interpolation (not
process args), document this contract explicitly.

**Effort:** 1 line fix + 1 line in test.

---

### Out-of-scope follow-ups (worth tracking but not blockers)

- The `xilinx/` / `altera/` literal directory names in `outputSubdir` could be made
  configurable per-toolchain instance once there is a need for branding alignment
  (e.g. `amd/` instead of `xilinx/`). The current `outputSubdir` property on
  `SynthesisToolchain` is the natural home for this.
- `ipcraft.toolbar.targetVendor` (currently `altera | xilinx | both`) needs to become
  a multi-select once vendor count > 2. This is coupled with SS 5.3.
- The VUnit `VUnitFramework.generate()` only emits VHDL testbench (`_tb.vhd`). A
  SystemVerilog VUnit testbench template is not yet available. Since VUnit's SV support
  is limited to certain simulators, this may intentionally be deferred.
- `ToolDetector.ts:24-38` still special-cases `qsys-edit` detection outside the
  generic toolchain loop. Consider adding a `subTools` property to `LaunchableTool`
  or `SynthesisToolchain` so each toolchain can declare its sub-tools and their
  context keys.
