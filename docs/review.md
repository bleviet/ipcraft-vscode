# Codebase Architecture Review: Multi-Tool & Vendor Readiness

- **Date of Writing:** 2026-05-25 17:00 (Europe/Berlin)
- **Target Git Hash:** `008812d7b058d83310e4e97cdbfefbe70f794a02`
- **Reviewer:** Architecture review (Claude / Sonnet 4.6, commissioned by Bach Le Viet)

## 1. Executive Summary

**Verdict: Requires moderate, targeted refactoring — not a rewrite.**

The core engine (`IpCoreScaffolder` → Nunjucks templates → `BuildRunner.runProcess`) is
small, layered, and reasonably clean. The data model is permissive (`[key: string]: unknown`
escape hatches), and `BuildRunner` already separates `executable + args + cwd + docker` from
the callers. That foundation will absorb new vendors and simulators **if** three concrete
gaps are addressed first:

1. **No `Toolchain` abstraction.** Each call site re-reads VS Code config, re-resolves the
   executable, re-derives the Docker options, and hard-codes the per-tool flag set
   (`-mode batch -source …`, `-t …`, `--flow compile …`). Adding Questasim or a third
   vendor means another N copy/paste blocks across `BuildCommands.ts`, `projectCreator.ts`,
   `editInIpPackager.ts`, `editInPlatformDesigner.ts`, `openInVivado.ts`, `openInQuartus.ts`.
2. **No `Framework` / `SimulatorEngine` decomposition.** Testbench generation is
   *unconditionally* CocoTB and the simulator is baked into the Makefile template
   (`SIM ?= ghdl`, `SIM ?= icarus`). VUnit is a different orchestration model (VUnit
   *owns* the compile/run flow; Makefile.sim is bypassed), so it cannot be added by
   tweaking the existing template — a real Strategy split is required.
3. **No env / license / mount injection.** `BuildRunner.runProcess` does not forward
   environment variables and Docker support handles a single mount + no env flags.
   Questasim needs `LM_LICENSE_FILE` / `MGLS_LICENSE_FILE` / `MODEL_TECH` paths and often
   a license-server mount; the current API has nowhere to thread them.

None of these are buried in deep cross-cutting concerns. The refactoring surface is roughly
**~1,000 LOC across ~10 files** (mostly `src/commands/*`, `src/services/BuildRunner.ts`,
`src/generator/IpCoreScaffolder.ts`, and ~5 testbench templates). I recommend doing it
before VUnit/Questasim land, because their differences expose every existing assumption
at once — adding them on top of the current shape will balloon the duplication.

The Pydantic / JSON schema (`ipcraft-spec/schemas/ip_core.schema.json`) is permissive
enough at the TypeScript runtime layer (`additionalProperties` is *not* enforced by
`js-yaml`), but the upstream schema declares `additionalProperties: false` on most
types — that is a future trap (see §3.3).

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
if (vendor === 'altera' || vendor === 'both') { … files['altera/...']  ... }
if (vendor === 'xilinx' || vendor === 'both') { … files['xilinx/...'] ... }
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

### 2.2 Vendor-specific data tables inside generator code

`src/generator/IpCoreScaffolder.ts:739-778` carries a hard-coded `quartusDeviceFamily()`
mapping of ~10 device prefixes to Quartus family strings. This is reference data, not
behavior — it should live in `src/data/` alongside `xilinxCatalog.ts` (currently 22
lines) and `boardCatalog.ts` (85 lines). If we add Versal / Spartan-7 / Cyclone 10 GX
support, that function will grow inside the scaffolder rather than in a vendor catalog.

The same shape exists in `IpCoreScaffolder.ts:333-339`:

```ts
const TEMPLATE_TYPE_TO_ALTERA: Record<string, string> = {
  axil: 'axi4lite', axi4: 'axi4', axis: 'axi4stream',
  avmm: 'avalon',   avst: 'avalon_streaming',
};
```

— bus-type translation tables sitting inside a 600-line method (`buildTemplateContext`).
A Lattice/Microchip target would add a parallel `TEMPLATE_TYPE_TO_<vendor>` map.

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
yet — when they're needed, they'll need to be pasted into all six.

### 2.4 The "Pydantic schema" is not actually enforced at runtime

The JSON schema at `ipcraft-spec/schemas/ip_core.schema.json` is rendered with
`"additionalProperties": false` on `ArrayConfig`, `BusInterface`, `ConduitPort`, `File`,
`FileSet`, `Clock`, `Parameter`, `Port`, `Reset`, `Interrupt`, `SubcoreRef`. The runtime
loader in `src/generator/IpCoreScaffolder.ts:288-295` uses `js-yaml` and *doesn't* call
the JSON schema validator (`src/services/YamlValidator.ts`) on the generation path.

This is a **latent contract bug**, not a working flexibility feature: today, simulator-
specific extension fields would silently load and silently be ignored. Tomorrow, when
someone wires the validator into the editor save path (which is the natural next step),
every existing escape hatch becomes a validation error.

### 2.5 Tight binding between testbench and simulator engine

The unit boundary you want — *Framework (CocoTB | VUnit) ⟂ Engine (GHDL | Icarus |
Questasim | Verilator)* — does not exist. There are seven testbench-related templates
in `src/generator/templates/`:

```
cocotb_conftest.py.j2   cocotb_dump.v.j2     cocotb_makefile.j2
cocotb_makefile.sv.j2   cocotb_pytest.py.j2  cocotb_test.py.j2
mm_loader.py.j2
```

All are prefixed `cocotb_*`. The generator branches `cocotb_makefile.j2` vs
`cocotb_makefile.sv.j2` purely on HDL language, with `SIM` chosen at *runtime* by an
environment variable inside the Makefile (`SIM ?= ghdl`). The TypeScript side never
knows which simulator will actually run. That is fine while everything is "CocoTB +
something that cocotb's `Makefile.sim` can drive" — it stops being fine the moment
VUnit (which drives its own compile/elab/run script in Python) enters, because:

- VUnit does **not** include `$(shell cocotb-config --makefiles)/Makefile.sim`.
- VUnit's simulator preference is set via a Python `VUnit.from_argv()` runner script,
  not a `SIM=` environment variable.
- For VUnit + Questasim, library mapping (`vmap`/`vlib`) lives in the Python runner,
  not the Makefile.

The current `cocotb_pytest.py.j2 → cocotb_conftest.py.j2 → cocotb_test.py.j2 → Makefile`
chain is itself a small Strategy implementation hard-wired to one strategy.

---

## 3. Toolchain & Simulator Abstraction Evaluation

### 3.1 Current state — synthesis side

- `src/services/BuildRunner.ts:64-135` (`runProcess`): the **only** subprocess wrapper.
  Reasonably clean — takes `(executable, args, { cwd, outputChannel, docker? })`.
  This is the foundation any future Toolchain abstraction should sit on.
- Vendor-specific knowledge currently lives in three places:
  1. **Resolvers** — `src/utils/vivadoResolver.ts` (90 LOC), `src/utils/quartusResolver.ts`
     (61 LOC). These already encapsulate platform/install-dir search.
  2. **Detector** — `src/services/ToolDetector.ts` (59 LOC) sets context keys for menu
     visibility. This is the closest thing to a registry today.
  3. **Command files** — every command re-wires its own launch (§2.3).
- Reports parsing is cleanly separated in `src/services/ReportParser.ts` and discriminated
  by `vendor: 'vivado' | 'quartus'`. Easiest place to widen.

### 3.2 Current state — verification / simulation side

- HDL generation chooses the testbench's *boilerplate* via the
  `hasMemoryMappedSlave + bus_type + hdlLanguage` triplet
  (`IpCoreScaffolder.ts:118-133`).
- The simulator engine is selected at *Makefile-evaluation time* by `$SIM` (GHDL for
  VHDL, Icarus or Verilator for SystemVerilog). The TypeScript layer has **zero
  awareness** of which engine will run.
- The conftest fixture (`cocotb_conftest.py.j2:38-72`) just shells out to `make`. It is
  not a runner — there is no programmatic compile/elab control surface.
- No central concept of a `Testbench` artifact, a `Framework`, or a `SimulatorEngine`
  exists in TypeScript code. The `generateTestbench` command name itself
  (`GenerateCommands.ts:316-335`) is "Generate CocoTB Testbench" — singular and
  framework-baked.

### 3.3 Extensibility gaps — what breaks when VUnit / Questasim are added

| Scenario | What breaks today |
|---|---|
| **VUnit + GHDL** | No template chain exists (`run.py`, library mappings, VUnit test discovery). `conftest.py`'s `make` shell-out is the wrong control surface. `cocotb_pytest.py.j2` discovers tests at template-render time, not at runtime — VUnit's `vu.add_source_files` model is incompatible. |
| **VUnit + Questasim** | All of the above, **plus** license + path injection. `BuildRunner.runProcess` doesn't accept an `env` map, so `LM_LICENSE_FILE=2100@licsrv` cannot be set per-tool. |
| **CocoTB + Questasim** | The Makefile templates branch on `$SIM` for `ghdl|icarus|verilator`. Adding `questa` requires a new `ifeq ($(SIM),questa)` block in *both* `cocotb_makefile.j2` and `cocotb_makefile.sv.j2`. Survivable, but still — engine-specific compile flags live in the template, not in a strategy class. |
| **Schema:** Questa-specific compile flags in YAML | The upstream JSON schema's `additionalProperties: false` rejects a `simulation:` block. Today nothing validates against it (§2.4), so unknowns are silently dropped. |
| **Toolchain probe** | `ToolDetector.ts` hard-codes `vivado` / `quartus_sh` / `qsys-edit`. Adding `vsim` (Questa) means a new context key, a new `enablement` clause, and a fourth duplicated block in `package.json`. |
| **Settings UX** | `ipcraft.vivado.*` / `ipcraft.quartus.*` are sibling settings groups. Adding `ipcraft.questa.*` and `ipcraft.lattice.*` will copy the same six fields (runner / installDir / dockerImage / defaultPart / customBoards / build.jobs). No room today for cross-tool defaults (e.g. license server). |
| **License paths in Docker** | `applyDocker()` (`BuildRunner.ts:29-62`) mounts exactly one host directory and forwards no env vars. License files outside that mount (typical for shared `/opt/licenses/...`) can't be reached and `LM_LICENSE_FILE` can't be propagated. |

---

## 4. Architectural Recommendations

The four recommendations below are independent and incremental. Each is small enough to
ship as a single PR. I'd ship them in this order — each unblocks the next.

### 4.1 Introduce a `Toolchain` interface (Strategy pattern) — *unblocks Questasim & 3rd vendors*

Create `src/services/toolchains/` with one strategy per FPGA toolchain:

```ts
// src/services/toolchains/Toolchain.ts
export interface Toolchain {
  readonly id: 'vivado' | 'quartus' | 'questa' | string;   // open for extension
  readonly displayName: string;

  /** Resolve the executable + prefix args for a sub-tool (e.g. 'vivado', 'quartus_sh', 'vsim'). */
  resolve(tool: string, cfg: vscode.WorkspaceConfiguration): ResolvedExecutable | null;

  /** Build env, mounts, and license forwarding for a Docker or local launch. */
  launchEnvironment(cfg: vscode.WorkspaceConfiguration, ipDir: string): LaunchEnv;

  /** Probe whether this toolchain is available (PATH / installDir / docker image). */
  isAvailable(cfg: vscode.WorkspaceConfiguration): boolean;

  /** Pre-canned actions — keeps the per-tool flag set out of command code. */
  buildArgs(action: 'createProject' | 'syntheszize' | 'openGui', name: string): string[];
}

export interface LaunchEnv {
  env: Record<string, string>;          // LM_LICENSE_FILE, MODEL_TECH, ...
  dockerMounts: Array<{ host: string; container: string; ro?: boolean }>;
  docker?: DockerOptions;
}
```

Then collapse `editInIpPackager.ts`, `openInVivado.ts`, `BuildCommands.ts`,
`projectCreator.ts`, et al. onto a single `toolchain.launch(action, …)` call. The
existing `vivadoResolver.ts` and `quartusResolver.ts` become the bodies of the first
two `Toolchain` implementations. `ToolDetector.ts` becomes a loop over the registered
strategies.

**Acceptance test:** adding the Questasim toolchain is a single new file under
`src/services/toolchains/QuestaToolchain.ts` plus one new `ipcraft.questa.*` settings
block — no edits to command files.

### 4.2 Extend `BuildRunner.runProcess` to accept `env` and multiple Docker mounts

Today:

```ts
export interface BuildRunOptions { cwd: string; outputChannel; docker?: DockerOptions; }
```

Proposed (additive, backwards-compatible):

```ts
export interface BuildRunOptions {
  cwd: string;
  outputChannel: vscode.OutputChannel;
  docker?: DockerOptions;
  env?: Record<string, string>;          // forwarded to child_process.spawn and to `docker run -e`
  extraMounts?: Array<{ host: string; container: string; ro?: boolean }>;
  timeoutMs?: number;
}
```

This is a ~30-LOC change in `BuildRunner.ts` and unblocks Questasim license env vars
without touching call sites that don't need them. The `Toolchain.launchEnvironment()`
contract from §4.1 funnels into these new fields.

### 4.3 Decompose testbench generation into `Framework` × `Engine` (Strategy + Factory)

Promote the testbench generator out of `IpCoreScaffolder.ts:118-133` into its own
module `src/generator/testbench/`:

```
src/generator/testbench/
  index.ts                — TestbenchGenerator(framework, engine).generate(ctx)
  frameworks/
    CocotbFramework.ts    — renders cocotb_*.j2 templates today
    VUnitFramework.ts     — renders vunit_run.py.j2 + vunit_<name>_tb.vhd.j2 (new)
  engines/
    GhdlEngine.ts         — compile flags, --std=08, -frelaxed
    IcarusEngine.ts       — -g2012, dump.v
    VerilatorEngine.ts    — --sv, --trace-fst
    QuestaEngine.ts       — vmap/vlib/vsim, license env (new)
```

The framework decides *what files exist* (Makefile vs `run.py`, `conftest.py` vs VUnit
`add_source_files`); the engine decides *what flags those files contain*. The two are
orthogonal: every (framework, engine) pair is a valid combination.

Settings exposure:

```jsonc
// package.json contribution
"ipcraft.testbench.framework": { "enum": ["cocotb", "vunit"], "default": "cocotb" },
"ipcraft.testbench.engine":    { "enum": ["ghdl", "icarus", "verilator", "questa"], "default": "ghdl" }
```

This is the single change that makes "VUnit alongside CocoTB" tractable — without it,
the framework is essentially welded to the file layout.

### 4.4 Widen the schema with a typed extension point + reactivate validation

Two coordinated changes:

(a) In `ipcraft-spec/schemas/ip_core.schema.json`, add an optional top-level block:

```jsonc
"simulation": {
  "type": "object",
  "description": "Simulator/framework-specific configuration",
  "properties": {
    "framework": { "enum": ["cocotb", "vunit"] },
    "engine":    { "enum": ["ghdl", "icarus", "verilator", "questa"] },
    "compileArgs": { "type": "array", "items": { "type": "string" } },
    "simArgs":     { "type": "array", "items": { "type": "string" } },
    "env":         { "type": "object", "additionalProperties": { "type": "string" } },
    "vendorOptions": {
      "type": "object",
      "description": "Per-engine free-form options. Keyed by engine id.",
      "additionalProperties": true
    }
  },
  "additionalProperties": false
}
```

The `vendorOptions` escape hatch lets `questa.optimize: false` or
`ghdl.workdir: build_ghdl` ride along without each option requiring a schema bump.

(b) Wire `src/services/YamlValidator.ts` into the generator entry point
(`IpCoreScaffolder.loadIpCore`) so that schema violations fail fast with a useful
message instead of being silently ignored. Today the validator exists but the generator
doesn't call it.

This is also a good moment to verify that the broader schema's `additionalProperties:
false` constraints are *intentional*. For a multi-tool platform, switching the leaf
types to `additionalProperties: true` (or adding a `metadata: { type: object }`
pass-through field on each) is the safer default — it lets imported components carry
vendor-specific annotations forward without round-trip data loss.

---

### Out-of-scope follow-ups (worth tracking but not blockers)

- The `xilinx/` / `altera/` literal directory names that leak into both the generator
  output and the build-target probes (§2.1) could be lifted into a `Toolchain.outputDir`
  property once §4.1 lands — pure mechanical move.
- The `quartusDeviceFamily()` table in `IpCoreScaffolder.ts:739-778` belongs in
  `src/data/quartusCatalog.ts` (new), mirroring the existing `xilinxCatalog.ts`.
- `ipcraft.toolbar.targetVendor` (currently `altera | xilinx | both`) needs to become
  a multi-select once vendor count > 2.
- Consider replacing the `vendor === 'altera' | 'xilinx' | 'both'` enum in
  `GenerateOptions` with `targets: string[]` — opens the door to non-exclusive
  multi-vendor generation without further enum widening.
