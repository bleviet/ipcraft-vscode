# Comprehensive Avalon Active-Low Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the comprehensive Avalon example so every polarity-capable active Avalon-MM function uses its active-low vendor role and `_n` physical port name.

**Architecture:** Keep the branch's existing canonical logical-port model: `useOptionalPorts` continues to contain `read`, `write`, `byteenable`, `readdatavalid`, and `waitrequest`. Add per-interface `portPolarityOverrides` for those five canonical keys; the shared bus-contract resolver remains responsible for vendor roles, physical suffixes, boundary inversion, and generated output.

**Tech Stack:** YAML IP-core fixtures, TypeScript, Jest integration snapshots, Nunjucks HDL/vendor generators.

## Global Constraints

- Keep canonical logical names in `useOptionalPorts`; do not add legacy `_n` aliases there.
- Configure exactly the five polarity-capable Avalon-MM functions: `read`, `write`, `byteenable`, `readdatavalid`, and `waitrequest`.
- Do not add or change runtime polarity logic; the branch already implements the approved contract model.
- Preserve one source of truth through `portPolarityOverrides` and do not add physical-name overrides.
- Do not automatically add, commit, or push changes.
- Run compile after any code generation; no type generation is required for this fixture-only change.

---

### Task 1: Characterize the comprehensive Avalon active-low contract

**Files:**
- Modify: `src/test/integration/snapshots.test.ts`
- Modify: `ipcraft-spec/examples/comprehensive_avalon/comprehensive_avalon.ip.yml`
- Modify: `src/test/integration/__snapshots__/snapshots.test.ts.snap`

**Interfaces:**
- Consumes: the existing `generateFixtures()`, `alteraFixtures()`, and `hwTclFiles()` integration helpers.
- Produces: a comprehensive Avalon fixture whose generated HDL ports and Altera logical roles use `_n` for all five configured functions.

- [x] **Step 1: Add a failing focused generated-output test**

Add this test after the existing Avalon-ST symbol-ordering assertion in `src/test/integration/snapshots.test.ts`:

```ts
it('emits every configured Avalon-MM polarity as an active-low physical port and vendor role', () => {
  const fixture = alteraFixtures(allFixtures).find(
    (candidate) => candidate.name === 'examples/comprehensive_avalon_vhdl'
  );
  expect(fixture).toBeDefined();

  const tcl = fs.readFileSync(hwTclFiles(fixture!)[0], 'utf8');
  for (const [role, direction, width] of [
    ['read_n', 'Input', 1],
    ['write_n', 'Input', 1],
    ['byteenable_n', 'Input', 4],
    ['readdatavalid_n', 'Output', 1],
    ['waitrequest_n', 'Output', 1],
  ] as const) {
    expect(tcl).toContain(
      `add_interface_port S_AVMM avs_${role} ${role} ${direction} ${width}`
    );
  }
});
```

- [x] **Step 2: Run the focused test and verify the current example fails**

Run:

```bash
npm run test:integration:snapshots -- --runInBand -t "emits every configured Avalon-MM polarity"
```

Expected: FAIL because the generated Tcl currently contains active-high names such as `avs_read read`.

- [x] **Step 3: Configure all five canonical ports as active-low**

Add this map to the `S_AVMM` interface in `ipcraft-spec/examples/comprehensive_avalon/comprehensive_avalon.ip.yml`, adjacent to `portWidthOverrides`:

```yaml
    portPolarityOverrides:
      read: activeLow
      write: activeLow
      byteenable: activeLow
      readdatavalid: activeLow
      waitrequest: activeLow
```

Keep the existing canonical names in `useOptionalPorts` unchanged.

- [x] **Step 4: Run the focused test and verify active-low resolution passes**

Run:

```bash
npm run test:integration:snapshots -- --runInBand -t "emits every configured Avalon-MM polarity"
```

Expected: PASS. Jest may also report obsolete snapshot content because the fixture intentionally changed.

- [x] **Step 5: Update only the affected integration snapshots**

Run:

```bash
npm run test:integration:snapshots -- --runInBand -u
```

Inspect the snapshot diff and confirm the comprehensive Avalon VHDL and SystemVerilog outputs change from the five active-high names and roles to:

```text
avs_read_n read_n
avs_write_n write_n
avs_byteenable_n byteenable_n
avs_readdatavalid_n readdatavalid_n
avs_waitrequest_n waitrequest_n
```

The component.xml and `_hw.tcl` snapshot changes must be limited to the comprehensive Avalon VHDL and SystemVerilog fixtures; unrelated fixtures must not change. Existing focused HDL polarity tests continue to own boundary-inversion coverage.

- [x] **Step 6: Run focused conformance and generator verification**

Run:

```bash
npx jest --config config/jest.config.js src/test/suite/services/AllExamplesConformance.test.ts --runInBand
npx jest --config config/jest.config.js src/test/suite/generator/IpCoreScaffolder.test.ts --runInBand -t "renders big-endian"
npx jest --config config/jest.integration.js src/test/integration/polarity-hdl.test.ts --runInBand
npm run test:integration:snapshots -- --runInBand
```

Expected: all commands PASS with no obsolete or failed snapshots.

- [x] **Step 7: Run project quality gates**

Run:

```bash
npm run type-check
npm run lint
npm run compile
git diff --check
```

Expected: every command exits successfully with no warnings or whitespace errors.

- [x] **Step 8: Review the final diff without committing**

Run:

```bash
git status --short
git diff --stat
git diff -- ipcraft-spec src/test/integration/snapshots.test.ts src/test/integration/__snapshots__/snapshots.test.ts.snap
```

Expected: only the submodule pointer, focused regression test, affected snapshots, and this plan are new or modified. Leave all changes unstaged and uncommitted for developer review.
