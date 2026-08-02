# Block Design System Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, review, run, and diagnose a VHDL AXI4-Lite register-contract testbench for a Vivado block design recreated from a checked-in Tcl script.

**Architecture:** Keep normalized configuration, Vivado-discovery data, route resolution, and deterministic register-vector construction as pure TypeScript. A Vivado-specific service runs the recreation/query Tcl in an isolated workspace, then generator templates produce a tracked `verification/` directory containing the configuration, mandatory Makefile, Tcl runner, VHDL testbench, and narrow AXI4-Lite BFM. The command stages every generated source file through the existing `StagingPanel`; a runner subsequently invokes `make run`, streams typed lifecycle events to a dedicated run panel, and retains only disposable execution output under `.ipcraft/system-verification/`.

**Tech Stack:** TypeScript, VS Code extension APIs, `yaml` v2, Node child processes, Vivado Tcl/XSim, VHDL-2008, Nunjucks templates, GNU Make, Jest, GHDL (optional BFM integration gate), Vivado/XSim (optional vendor integration gate).

## Global Constraints

- Version 1 supports Vivado only and drives an already-exposed AXI4-Lite block-design boundary; it must not alter the recreation Tcl, `.bd`, or in-memory block-design graph.
- V1 generates VHDL only; it uses XSim for mixed-language DUT elaboration and does not depend on Cocotb, Questa, or AXI VIP.
- The BFM supports exactly one ordered, single-word AXI4-Lite transaction at a time. Bursts, multiple outstanding transactions, randomization, and AXI VIP are out of scope.
- Register vectors are deterministic: reset checks plus zero, all writable bits set, and walking-one values only where the field access semantics permit them.
- `clockPath`, `clockPeriodNs`, `resetPath`, `resetActiveLow`, and `resetCycles` are explicit configuration values; never infer them from signal names.
- `Makefile` is a mandatory, tracked generated file; GNU Make and Vivado must be preflighted before runs.
- Generated reviewed sources live beside the Tcl at `verification/`; disposable Vivado/XSim output lives only in `.ipcraft/system-verification/<run-id>/`.
- Preserve the dependency direction: pure types/utilities → services/controllers → providers/components. Use camelCase TypeScript and YAML fields only.
- All generated source writes must use the existing staging review. Cancelling staging writes no user-workspace source files.
- Extension-side code uses `Logger`, never `console.log`; documentation contains no emojis.
- Do not auto-commit. Before a later developer commit, run `npm run lint`, `npm run type-check`, relevant Jest suites with `--config config/jest.config.js`, and the gated integration suite where the tools are available.

---

## File structure

| File                                                              | Responsibility                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/domain/systemVerification.types.ts`                          | Immutable normalized configuration, discovery manifest, route, test-plan, vector, lifecycle, and result types.  |
| `src/services/systemVerification/SystemVerificationConfig.ts`     | Parse/validate/configure the tracked YAML file and create its initial YAML text.                                |
| `src/services/systemVerification/SystemVerificationPlanner.ts`    | Pure validation, address resolution, and deterministic register-vector construction.                            |
| `src/services/systemVerification/VivadoSystemDiscovery.ts`        | Generate discovery Tcl, launch Vivado through the configured toolchain, and parse a JSON discovery manifest.    |
| `src/services/systemVerification/SystemVerificationScaffolder.ts` | Render the Makefile, Tcl, VHDL BFM/testbench, and configuration artifact map.                                   |
| `src/services/systemVerification/SystemVerificationStaging.ts`    | Categorize generated system-verification files, invoke `StagingPanel`, and apply only accepted writes.          |
| `src/services/systemVerification/SystemVerificationRunner.ts`     | Preflight Make/Vivado, allocate run output, invoke `make run`, decode `result.json`, and emit lifecycle events. |
| `src/commands/SystemVerificationCommands.ts`                      | Command composition: Tcl picker, discovery selections, staging, run, cancellation, and user notifications.      |
| `src/providers/SystemVerificationRunPanel.ts`                     | Minimal standalone webview for typed lifecycle stage, route summary, first failure, logs, and waveform links.   |
| `src/generator/templates/system_verification_*.j2`                | Generated Makefile, Tcl runner, VHDL BFM, VHDL testbench, and YAML starter templates.                           |
| `src/test/suite/services/systemVerification/*.test.ts`            | Fast configuration, planner, discovery, scaffold, staging, and runner tests.                                    |
| `src/test/suite/commands/SystemVerificationCommands.test.ts`      | Command picker, staging, selection, cancellation, and notification tests.                                       |
| `src/test/integration/system-verification.test.ts`                | Gated GHDL/Vivado integration coverage.                                                                         |
| `src/test/fixtures/system-verification/`                          | AXI4-Lite VHDL slave, mixed-language Vivado block-design recreation Tcl, and expected manifests.                |

### Task 1: Define the normalized system-verification contract

**Files:**

- Create: `src/domain/systemVerification.types.ts`
- Create: `src/services/systemVerification/SystemVerificationConfig.ts`
- Test: `src/test/suite/services/systemVerification/SystemVerificationConfig.test.ts`

**Interfaces:**

- Produces `SystemVerificationConfig`, `SystemVerificationTarget`, `DiscoveredSystem`, `DiscoveredAxiRoute`, `VerificationVector`, `SystemVerificationPlan`, `SystemVerificationStage`, and `SystemVerificationResult`.
- Produces `parseSystemVerificationConfig(text, sourcePath)` and `createSystemVerificationConfigText(config)` for all later services.

- [ ] **Step 1: Write failing configuration tests**

```ts
it('accepts an explicit V1 AXI4-Lite configuration', () => {
  expect(
    parseSystemVerificationConfig(validYaml, '/work/verification/system-verification.yml')
  ).toMatchObject({ clockPeriodNs: 10, resetActiveLow: true, resetCycles: 5 });
});

it.each([
  [
    validYaml.replace('clockPeriodNs: 10', 'clockPeriodNs: 0'),
    /clockPeriodNs must be greater than zero/,
  ],
  [validYaml.replace('resetCycles: 5', 'resetCycles: 0'), /resetCycles must be a positive integer/],
])('rejects invalid configuration', (yaml, message) => {
  expect(() => parseSystemVerificationConfig(yaml, 'x.yml')).toThrow(message);
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationConfig.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add explicit types and parser**

```ts
export interface SystemVerificationConfig {
  recreateScript: string;
  part: string;
  designName: string;
  clockPath: string;
  clockPeriodNs: number;
  resetPath: string;
  resetActiveLow: boolean;
  resetCycles: number;
  target: SystemVerificationTarget;
}

export function parseSystemVerificationConfig(
  text: string,
  sourcePath: string
): SystemVerificationConfig {
  // yaml.parseDocument, validate exact camelCase keys and return normalized paths relative to sourcePath.
}
```

Reject missing target paths and unsupported non-AXI4-Lite discovered routes with field-specific errors. Serialize only camelCase YAML fields in a deterministic field order.

- [ ] **Step 4: Run the configuration test again**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationConfig.test.ts`

Expected: PASS.

- [ ] **Step 5: Add contract boundary tests**

```ts
it('round-trips a newly generated configuration without changing relative paths', () => {
  const text = createSystemVerificationConfigText(config);
  expect(parseSystemVerificationConfig(text, configPath)).toEqual(config);
});
```

- [ ] **Step 6: Run formatting and type checks for the new contract**

Run: `npx prettier --check src/domain/systemVerification.types.ts src/services/systemVerification/SystemVerificationConfig.ts src/test/suite/services/systemVerification/SystemVerificationConfig.test.ts && npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationConfig.test.ts`

Expected: both commands exit 0.

### Task 2: Build the pure route planner and deterministic register oracle

**Files:**

- Create: `src/services/systemVerification/SystemVerificationPlanner.ts`
- Test: `src/test/suite/services/systemVerification/SystemVerificationPlanner.test.ts`
- Test fixture: `src/test/fixtures/system-verification/discovered-system.json`

**Interfaces:**

- Consumes `SystemVerificationConfig`, `DiscoveredSystem`, and `NormalizedMemoryMap`.
- Produces `buildSystemVerificationPlan(config, discovered, memoryMap): SystemVerificationPlan`.
- Produces `buildDeterministicVectors(register, busBytes): VerificationVector[]` for template rendering and unit tests.

- [ ] **Step 1: Write failing route-resolution tests**

```ts
it('uses the discovered system base plus register offset', () => {
  const plan = buildSystemVerificationPlan(config, discovered, memoryMap);
  expect(plan.transactions.find((item) => item.registerName === 'CONTROL')).toMatchObject({
    address: 0x44a00004,
  });
});

it('rejects an ambiguous compatible route', () => {
  expect(() => buildSystemVerificationPlan(config, ambiguousSystem, memoryMap)).toThrow(
    /target.*has more than one AXI4-Lite route/
  );
});
```

- [ ] **Step 2: Run the failing planner test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationPlanner.test.ts`

Expected: FAIL because the planner does not exist.

- [ ] **Step 3: Implement route and address validation**

```ts
export function buildSystemVerificationPlan(
  config: SystemVerificationConfig,
  discovered: DiscoveredSystem,
  memoryMap: NormalizedMemoryMap
): SystemVerificationPlan {
  const route = resolveUniqueAxi4LiteRoute(config.target, discovered);
  return { route, transactions: buildRegisterTransactions(route.baseAddress, memoryMap) };
}
```

Reject missing boundary interfaces, missing target instances, non-AXI4-Lite routes, non-unique routes, and address ranges smaller than the memory map. Keep all path matching exact; do not add guessed-name fallback behavior.

- [ ] **Step 4: Add failing vector tests**

```ts
it('emits reset, zero, writable-ones, and per-bit walking-one vectors in address order', () => {
  expect(buildDeterministicVectors(controlRegister, 4)).toEqual([
    expect.objectContaining({ kind: 'resetRead' }),
    expect.objectContaining({ kind: 'writeReadback', writeValue: 0 }),
    expect.objectContaining({ kind: 'writeReadback', writeValue: 0x00000003 }),
    expect.objectContaining({ kind: 'writeReadback', writeValue: 0x00000001 }),
    expect.objectContaining({ kind: 'writeReadback', writeValue: 0x00000002 }),
  ]);
});
```

- [ ] **Step 5: Implement vector construction**

Use the normalized field access rules to create masks and expected readback values. Exclude read-only, write-one-to-clear, volatile, and side-effect fields from write/readback vectors; retain their legal reset/read checks. Make the skipped reason explicit in the plan so generated comments and UI diagnostics explain it.

- [ ] **Step 6: Run planner tests**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationPlanner.test.ts`

Expected: PASS with both success and rejection cases.

### Task 3: Discover recreated Vivado systems in an isolated workspace

**Files:**

- Create: `src/services/systemVerification/VivadoSystemDiscovery.ts`
- Create: `src/generator/templates/system_verification_discover.tcl.j2`
- Test: `src/test/suite/services/systemVerification/VivadoSystemDiscovery.test.ts`
- Test fixture: `src/test/fixtures/system-verification/discovery-output.json`

**Interfaces:**

- Consumes a `VivadoToolchain`, `SystemVerificationConfig`, workspace root, and cancellation token.
- Produces `discoverVivadoSystem(request): Promise<DiscoveredSystem>`.
- The command layer owns all QuickPick decisions; discovery never opens UI.

- [ ] **Step 1: Write failing command-construction and manifest-parsing tests**

```ts
it('runs Vivado in batch mode inside the supplied scratch directory', async () => {
  await discovery.discover(request);
  expect(runProcess).toHaveBeenCalledWith(
    'vivado',
    expect.arrayContaining(['-mode', 'batch', '-source', expect.stringContaining('discover.tcl')]),
    expect.objectContaining({ cwd: scratchDir })
  );
});

it('rejects malformed discovery JSON with its source path', async () => {
  await expect(discovery.parseManifest('{bad}', manifestPath)).rejects.toThrow(/manifestPath/);
});
```

- [ ] **Step 2: Run the failing discovery test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/VivadoSystemDiscovery.test.ts`

Expected: FAIL because the discovery service does not exist.

- [ ] **Step 3: Implement Tcl query generation and manifest parsing**

The Tcl script must source the selected recreation script in a fresh temporary project/work directory, verify the configured design name, and emit one JSON file containing only: design name, block-boundary ports/interfaces, component instances, AXI interface properties, graph route candidates, and address segments. Use a file result rather than scraping console output. Invoke Vivado through `VivadoToolchain.resolve`, `getDocker`, `getLaunchEnv`, and `runProcess` so local and configured Docker execution retain existing behavior.

- [ ] **Step 4: Run discovery tests**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/VivadoSystemDiscovery.test.ts`

Expected: PASS, including source order and malformed-result diagnostics.

- [ ] **Step 5: Add cancellation cleanup coverage**

```ts
it('removes the scratch directory when discovery is cancelled before staging', async () => {
  await expect(discovery.discover(cancelledRequest)).rejects.toThrow(/cancelled/);
  expect(fs.existsSync(scratchDir)).toBe(false);
});
```

### Task 4: Generate the tracked VHDL/XSim runner scaffold

**Files:**

- Create: `src/services/systemVerification/SystemVerificationScaffolder.ts`
- Create: `src/generator/templates/system_verification_makefile.j2`
- Create: `src/generator/templates/system_verification_run_xsim.tcl.j2`
- Create: `src/generator/templates/system_verification_tb.vhd.j2`
- Create: `src/generator/templates/system_verification_axi4lite_bfm.vhd.j2`
- Test: `src/test/suite/services/systemVerification/SystemVerificationScaffolder.test.ts`

**Interfaces:**

- Consumes `SystemVerificationConfig`, `SystemVerificationPlan`, and an output directory.
- Produces `scaffoldSystemVerification(input): Record<string, string>` with the exact relative paths `system-verification.yml`, `Makefile`, `scripts/run_xsim.tcl`, `tb/system_verification_tb.vhd`, and `tb/axi4lite_master_bfm.vhd`.

- [ ] **Step 1: Write a failing generated-file contract test**

```ts
it('renders the mandatory Makefile and VHDL BFM with resolved plan values', () => {
  const files = scaffoldSystemVerification(input);
  expect(Object.keys(files).sort()).toEqual([
    'Makefile',
    'scripts/run_xsim.tcl',
    'system-verification.yml',
    'tb/axi4lite_master_bfm.vhd',
    'tb/system_verification_tb.vhd',
  ]);
  expect(files.Makefile).toContain('run:');
  expect(files['tb/system_verification_tb.vhd']).toContain('44A00004');
});
```

- [ ] **Step 2: Run the failing scaffold test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationScaffolder.test.ts`

Expected: FAIL because the scaffolder does not exist.

- [ ] **Step 3: Render all five tracked artifacts**

The Makefile must expose `run`, `clean`, and `help`; `run` calls `$(VIVADO) -mode batch -source scripts/run_xsim.tcl`, and `WAVES=1` is forwarded as a Tcl argument. The Tcl runner must recreate/export sources into `RUN_DIR`, compile via Vivado-generated source order, elaborate XSim, execute batch simulation, and write `result.json` on both pass and failure paths. The VHDL testbench must drive the explicit clock/reset and call BFM single-word procedures only. The BFM must use bounded `AW`, `W`, `B`, `AR`, and `R` handshakes and fail with transaction context on timeout or non-`OKAY` response.

- [ ] **Step 4: Add source-level assertions for V1 scope**

```ts
expect(files['tb/axi4lite_master_bfm.vhd']).not.toMatch(/burst|axi_vip|cocotb|questa/i);
expect(files['tb/system_verification_tb.vhd']).toContain('resetCycles');
expect(files['tb/system_verification_tb.vhd']).toContain('walking-one');
```

- [ ] **Step 5: Run the scaffold test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationScaffolder.test.ts`

Expected: PASS.

### Task 5: Reuse staging for generated system-verification files

**Files:**

- Create: `src/services/systemVerification/SystemVerificationStaging.ts`
- Test: `src/test/suite/services/systemVerification/SystemVerificationStaging.test.ts`
- Modify: `src/providers/StagingPanel.ts` only if a small typed `stageAndApply` helper prevents duplicated status/merge/overwrite policy.

**Interfaces:**

- Consumes `Record<string, string>` and an absolute `verification/` directory.
- Produces `stageSystemVerificationFiles(contents, outputDir): Promise<{ accepted: boolean; writtenPaths: string[] }>`.
- Uses the existing `StagedFile` and `StagingDecision` contracts; never opens an IP-core webview staging bridge.

- [ ] **Step 1: Write failing staging tests**

```ts
it('opens the existing panel before writing a new file', async () => {
  await stageSystemVerificationFiles({ Makefile: 'run:\n' }, verificationDir);
  expect(StagingPanel.show).toHaveBeenCalledWith([expect.objectContaining({ status: 'new' })], []);
  expect(fs.existsSync(path.join(verificationDir, 'Makefile'))).toBe(false);
});

it('writes only accepted new and selected modified files', async () => {
  jest
    .spyOn(StagingPanel, 'show')
    .mockResolvedValue({ confirmed: true, mergedPaths: [], overwritePaths: ['Makefile'] });
  expect((await stageSystemVerificationFiles(contents, verificationDir)).writtenPaths).toEqual([
    'Makefile',
  ]);
});
```

- [ ] **Step 2: Run the failing staging test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationStaging.test.ts`

Expected: FAIL because the staging service does not exist.

- [ ] **Step 3: Implement categorization and accepted writes**

Use the same new/modified/unchanged comparison and overwrite semantics as `GenerationEngine`, but keep the new service independent of `.ip.yml` and `WebviewStagingBridge`. Resolve every path against `verificationDir`; reject a generated relative path that escapes it. On cancel, return `{ accepted: false, writtenPaths: [] }` and write nothing. Preserve merge-editor paths exactly as `StagingPanel` requires.

- [ ] **Step 4: Run staging tests**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationStaging.test.ts src/test/suite/providers/stagingMerge.test.ts`

Expected: PASS.

### Task 6: Add the generate-from-Tcl command and reviewed selections

**Files:**

- Create: `src/commands/SystemVerificationCommands.ts`
- Modify: `src/commands/GenerateCommands.ts`
- Modify: `package.json`
- Test: `src/test/suite/commands/SystemVerificationCommands.test.ts`
- Test: `src/test/suite/commands/GenerateCommands.characterization.test.ts`
- Test: `src/test/suite/workspaceTrustManifest.test.ts`

**Interfaces:**

- Register command ID `fpga-ip-core.generateSystemTestbench` with title `Generate System Testbench from Vivado Tcl` and `requiresWorkspaceTrust: true`.
- Consumes `VivadoSystemDiscovery`, `SystemVerificationPlanner`, `SystemVerificationScaffolder`, and `SystemVerificationStaging` through narrow constructor parameters.

- [ ] **Step 1: Write failing command-flow tests**

```ts
it('opens a Tcl picker, selects only discovered AXI4-Lite entries, then stages the scaffold', async () => {
  await generateSystemTestbench(dependencies);
  expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
    expect.objectContaining({ filters: { Tcl: ['tcl'] } })
  );
  expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(6);
  expect(stageSystemVerificationFiles).toHaveBeenCalledWith(
    expect.any(Object),
    path.join('/work/hardware/system', 'verification')
  );
});

it('stops without staging when a selection is cancelled', async () => {
  (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
  await generateSystemTestbench(dependencies);
  expect(stageSystemVerificationFiles).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the failing command test**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/SystemVerificationCommands.test.ts`

Expected: FAIL because the command does not exist.

- [ ] **Step 3: Implement the selection and generation flow**

Use `showOpenDialog` for the Tcl file, run discovery in an isolated temporary workspace, then require separate QuickPicks for block design, external AXI4-Lite interface, target instance, linked `.mm.yml`, clock path, and reset path. Ask for clock period, reset polarity, and reset cycles using validated input boxes. Default output to `<tcl directory>/verification`. Build the configuration and plan only after all selections are explicit, then stage the generated files. A cancelled picker deletes the discovery scratch directory and shows no success notification.

- [ ] **Step 4: Register the command and manifest contribution**

```ts
safeRegisterCommand(
  context,
  'fpga-ip-core.generateSystemTestbench',
  () => generateSystemTestbench(context, resourceRoots),
  { requiresWorkspaceTrust: true }
);
```

Add the matching `package.json` command contribution with `isWorkspaceTrusted && ipcraft.vivadoFound` enablement. Add characterization and workspace-trust expectations so future refactors cannot expose it to untrusted workspaces.

- [ ] **Step 5: Run command registration tests**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/SystemVerificationCommands.test.ts src/test/suite/commands/GenerateCommands.characterization.test.ts src/test/suite/workspaceTrustManifest.test.ts`

Expected: PASS.

### Task 7: Run `make run` with typed lifecycle events and cancellation

**Files:**

- Create: `src/services/systemVerification/SystemVerificationRunner.ts`
- Modify: `src/services/BuildRunner.ts`
- Create: `src/providers/SystemVerificationRunPanel.ts`
- Test: `src/test/suite/services/systemVerification/SystemVerificationRunner.test.ts`
- Test: `src/test/suite/providers/SystemVerificationRunPanel.test.ts`

**Interfaces:**

- Produces `runSystemVerification(request, onEvent, cancellationToken): Promise<SystemVerificationResult>`.
- Emits `SystemVerificationLifecycleEvent` with one of `preflight`, `recreate`, `discover`, `plan`, `compile`, `run`, `complete` and a monotonic timestamp.
- `BuildRunner.runProcess` gains an optional VS Code cancellation token and a documented process-tree termination callback without changing existing callers.

- [ ] **Step 1: Write failing runner tests**

```ts
it('preflights GNU Make and Vivado before invoking make run', async () => {
  await expect(runner.run(request, onEvent, token)).rejects.toThrow(/GNU Make/);
  expect(runProcess).not.toHaveBeenCalled();
});

it('emits ordered lifecycle events and preserves result paths on a failed simulation', async () => {
  const result = await runner.run(request, onEvent, token);
  expect(onEvent.mock.calls.map(([event]) => event.stage)).toEqual([
    'preflight',
    'recreate',
    'discover',
    'plan',
    'compile',
    'run',
    'complete',
  ]);
  expect(result).toMatchObject({ outcome: 'failed', logsPath: expect.any(String) });
});
```

- [ ] **Step 2: Run the failing runner test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationRunner.test.ts`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement preflight, isolated run directories, and result parsing**

Create a collision-resistant run ID under `<workspace>/.ipcraft/system-verification/`. Verify `make --version` and the configured Vivado toolchain before starting. Invoke `make run RUN_DIR=<absolute run dir> WAVES=0|1` through `runProcess`, keep raw output in a dedicated output channel, and parse a schema-checked `result.json`. A nonzero Make exit is a failure even if malformed output claims success. Preserve the run directory on pass, fail, and cancellation.

- [ ] **Step 4: Add cancellation behavior to `BuildRunner`**

The cancellation implementation must terminate only the child process tree created for this run. Add tests using a spawned fixture process to prove the cancellation callback resolves once, marks the result as `cancelled`, and does not terminate an unrelated process. Do not change behavior for existing build callers that omit the token.

- [ ] **Step 5: Implement the minimal run panel**

The panel receives typed events only; it never parses terminal text. Render current stage, elapsed time, resolved route/base address, current scenario, first actionable diagnostic, and local links for logs/waves. Dispose safely on cancellation and ensure opening/closing it does not affect a running process.

- [ ] **Step 6: Run runner and panel tests**

Run: `npx jest --config config/jest.config.js src/test/suite/services/systemVerification/SystemVerificationRunner.test.ts src/test/suite/providers/SystemVerificationRunPanel.test.ts`

Expected: PASS.

### Task 8: Add the run command and make the Makefile the shared execution path

**Files:**

- Modify: `src/commands/SystemVerificationCommands.ts`
- Modify: `src/commands/GenerateCommands.ts`
- Modify: `package.json`
- Test: `src/test/suite/commands/SystemVerificationCommands.test.ts`

**Interfaces:**

- Register `fpga-ip-core.runSystemTestbench` with title `Run System Testbench` and trusted-workspace/Vivado enablement.
- Consumes a selected `system-verification.yml`; delegates exclusively to `SystemVerificationRunner`.

- [ ] **Step 1: Write failing run-command tests**

```ts
it('uses the selected tracked configuration and starts the run panel', async () => {
  await runSystemTestbench(dependencies, vscode.Uri.file(configPath));
  expect(runner.run).toHaveBeenCalledWith(
    expect.objectContaining({ configPath }),
    expect.any(Function),
    expect.anything()
  );
  expect(runPanel.show).toHaveBeenCalled();
});

it('reports a preflight failure without launching a simulation process', async () => {
  runner.run.mockRejectedValue(new Error('GNU Make was not found'));
  await runSystemTestbench(dependencies, vscode.Uri.file(configPath));
  expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('GNU Make'));
});
```

- [ ] **Step 2: Run the failing command tests**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/SystemVerificationCommands.test.ts`

Expected: FAIL because the run command is unregistered.

- [ ] **Step 3: Implement command registration and cancellation wiring**

Make the tracked YAML configuration the command resource. The command opens the run panel, passes its cancellation token to the runner, and reports completion/failure using the typed result. Add `runSystemTestbench` to the command manifest and command-registration test. Do not run Tcl directly from the command; all execution must remain `make run` through the runner.

- [ ] **Step 4: Run command tests**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/SystemVerificationCommands.test.ts`

Expected: PASS.

### Task 9: Prove the VHDL BFM independently of Vivado

**Files:**

- Create: `src/test/fixtures/system-verification/vhdl/axi4lite_slave_model.vhd`
- Create: `src/test/fixtures/system-verification/vhdl/axi4lite_bfm_tb.vhd`
- Create: `src/test/integration/system-verification.test.ts`
- Modify: `config/jest.integration.js` only if the existing integration path pattern does not include the new file.

**Interfaces:**

- Consumes the rendered BFM source from `SystemVerificationScaffolder` and the VHDL slave fixture.
- Produces an opt-in GHDL gate using `guardTier2('ghdl', ...)` consistent with existing integration tests.

- [ ] **Step 1: Add a failing BFM integration case**

```ts
it('compiles and runs deterministic AXI4-Lite reads, writes, errors, and timeouts', () => {
  const result = spawnSync('ghdl', ['-r', '--std=08', 'axi4lite_bfm_tb'], { cwd: workDir });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('BFM PASS');
});
```

- [ ] **Step 2: Run the GHDL-gated integration test**

Run: `npx jest --config config/jest.integration.js src/test/integration/system-verification.test.ts`

Expected: FAIL while the fixture and generated BFM are incomplete; skip only when GHDL is unavailable according to the existing tier guard.

- [ ] **Step 3: Implement a self-checking slave fixture**

Model separate `AW`/`W` acceptance, `B` responses, `AR`/`R` reads, byte strobes, `SLVERR`, `DECERR`, and withheld-ready timeout behavior. The VHDL testbench must prove the generated BFM reports each expected fault without issuing bursts or parallel transactions.

- [ ] **Step 4: Re-run the GHDL gate**

Run: `npx jest --config config/jest.integration.js src/test/integration/system-verification.test.ts`

Expected: PASS or explicit tier skip when GHDL is absent.

### Task 10: Prove a recreated mixed-language Vivado/XSim system

**Files:**

- Create: `src/test/fixtures/system-verification/vivado/create_system.tcl`
- Create: `src/test/fixtures/system-verification/vivado/vhdl_target.vhd`
- Create: `src/test/fixtures/system-verification/vivado/verilog_neighbour.sv`
- Create: `src/test/fixtures/system-verification/vivado/system-verification.yml`
- Modify: `src/test/integration/system-verification.test.ts`
- Modify: `scripts/integration/vivado/` only if a reusable fixture launcher is clearer than the test-owned process invocation.

**Interfaces:**

- Consumes the tracked-like generated `verification/Makefile` and config fixture.
- Produces a gated XSim end-to-end result with explicit `VIVADO_BIN`, `REQUIRE_VIVADO`, and `SKIP_VIVADO` behavior matching `src/test/integration/vivado.test.ts`.

- [ ] **Step 1: Add a failing vendor integration test**

```ts
it('runs make run through a recreated mixed-language AXI4-Lite block design', () => {
  const result = spawnSync('make', ['run', `VIVADO=${VIVADO_BIN}`, 'WAVES=0'], {
    cwd: verificationDir,
  });
  expect(result.status).toBe(0);
  expect(readResult(verificationDir)).toMatchObject({ outcome: 'passed' });
});
```

- [ ] **Step 2: Run the gated vendor integration test**

Run: `npx jest --config config/jest.integration.js src/test/integration/system-verification.test.ts -t "mixed-language"`

Expected: FAIL until the Tcl recreates the fixture; skip when Vivado is unavailable, and fail instead when `REQUIRE_VIVADO=1`.

- [ ] **Step 3: Implement the minimal fixture**

Create a reproducible block design with the external AXI4-Lite test entry, AXI Interconnect or SmartConnect, a VHDL IPCraft-style target, and a SystemVerilog neighbour. The Tcl must not depend on a GUI-only project or user-local source path. Cover absolute base-plus-offset routing, reset reads, legal reads, deterministic writes, and an intentional wrong-expectation run that produces register/address/value diagnostics.

- [ ] **Step 4: Re-run the vendor integration test**

Run: `npx jest --config config/jest.integration.js src/test/integration/system-verification.test.ts -t "mixed-language"`

Expected: PASS on a configured Vivado/XSim host or explicit tier skip elsewhere.

### Task 11: Document the workflow and verify the complete change

**Files:**

- Create: `docs/how-to/run-system-verification.md`
- Modify: `docs/reference/commands.md`
- Modify: `docs/reference/generator.md`
- Modify: `README.md` only if its feature list has a dedicated system-verification entry.

**Interfaces:**

- Documents the command, tracked layout, mandatory Makefile targets, tool prerequisites, staging guarantees, v1 limitations, run result locations, and failure diagnosis.

- [ ] **Step 1: Write documentation assertions as a checklist in the documentation test review**

```md
- [ ] Shows `make run` and `make run WAVES=1`.
- [ ] States GNU Make and Vivado/XSim are required.
- [ ] States AXI4-Lite single-word only; no AXI VIP, Cocotb, or Questa in v1.
- [ ] Explains staging cancellation writes no tracked files.
- [ ] Explains `.ipcraft/system-verification/<run-id>/` output retention.
```

- [ ] **Step 2: Write the user documentation**

Include the exact command names, configuration example, required explicit clock/reset fields, supported Make targets, expected result/log/wave locations, and first-failure troubleshooting. Link to the existing staging documentation instead of duplicating its visual behavior.

- [ ] **Step 3: Run focused tests and static checks**

Run:

```sh
npx jest --config config/jest.config.js src/test/suite/services/systemVerification src/test/suite/commands/SystemVerificationCommands.test.ts src/test/suite/providers/SystemVerificationRunPanel.test.ts
npx jest --config config/jest.integration.js src/test/integration/system-verification.test.ts
npm run type-check
npm run lint
git diff --check
```

Expected: unit tests, type check, lint, and diff check pass; integration tests pass on equipped hosts or report their documented tool-gated skips.

- [ ] **Step 4: Review the final diff against the approved design**

Confirm each approved requirement is represented: VHDL/XSim only, mandatory Makefile, exact explicit clock/reset configuration, staged tracked scaffold, isolated transient output, deterministic no-burst BFM, typed lifecycle run view, actionable failure diagnostics, GHDL BFM test, and Vivado mixed-language fixture. Leave all changes uncommitted for developer review.
