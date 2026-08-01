# Toolchain Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated launch-policy decisions and expensive version probes identified in PR #202 review.

**Architecture:** Reuse `resolveExecutionLauncher` at all build-mode execution boundaries. Availability checks remain synchronous but search configured installation directories directly through existing resolver helpers, avoiding vendor `--version` subprocesses.

**Tech Stack:** TypeScript, VS Code configuration API, Jest.

## Global Constraints

- Preserve Docker image and preferred-version selection.
- Do not execute a host path inside Docker.
- Preserve legacy `installDir`, Docker, and PATH fallback behavior.
- Use camelCase and relative imports; pass lint with zero warnings.

---

### Task 1: Centralize build-mode launch selection

**Files:**
- Modify: `src/services/toolchains/VivadoToolchain.ts:226-267`
- Modify: `src/services/toolchains/QuartusToolchain.ts:479-509`
- Test: `src/test/suite/services/toolchains/VivadoToolchain.test.ts:312-357`
- Test: `src/test/suite/services/toolchains/QuartusToolchain.test.ts:378-426`

**Interfaces:**
- Consumes: `resolveExecutionLauncher(docker, containerExecutable, resolveLocal)`.
- Produces: build-mode `run(preferredVersion?)` functions with one canonical launcher decision.

- [ ] **Step 1: Write the failing build-mode tests**

Add a local-mode assertion that the mode resolves through the toolchain's
`resolve` method and a Docker-mode assertion that the runner receives the
native literal command `vivado` or `quartus_sh`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx jest --config config/jest.config.js src/test/suite/services/toolchains/VivadoToolchain.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts --runInBand`

Expected: the new assertions fail because the closures duplicate the decision
instead of using the shared helper.

- [ ] **Step 3: Replace duplicated branches with the shared launcher helper**

```ts
const launcher = resolveExecutionLauncher(docker, 'vivado', () =>
  this.resolve('vivado', cfg, runPreferredVersion)
);
```

Use the equivalent Quartus call with `quartus_sh`, and retain the existing
arguments passed to `runProcess`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run the command from Step 2. Expected: all tests pass.

### Task 2: Avoid version probes in availability checks

**Files:**
- Modify: `src/services/toolchains/VivadoToolchain.ts:48-67`
- Modify: `src/services/toolchains/QuartusToolchain.ts:266-333`
- Test: `src/test/suite/services/toolchains/VivadoToolchain.test.ts:114-147`
- Test: `src/test/suite/services/toolchains/QuartusToolchain.test.ts:133-147,542-549`

**Interfaces:**
- Consumes: `findVivadoInInstallDir(installDir)` and
  `findInInstallDir(toolName, installDir)`.
- Produces: boolean availability without `resolveVivadoVersions` or
  `resolveQuartusVersions` when `installDirs` is configured.

- [ ] **Step 1: Write failing no-probe tests**

Configure two `installDirs`, make the direct finder succeed in one directory,
and assert availability is true while the corresponding version resolver is
not called. Cover Vivado availability, Quartus availability, and Quartus
`qsys-edit` availability.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npx jest --config config/jest.config.js src/test/suite/services/toolchains/VivadoToolchain.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts --runInBand`

Expected: the no-probe assertions fail because the methods call the version
resolvers.

- [ ] **Step 3: Search configured directories directly**

```ts
return installDirs.some((installDir) =>
  findInInstallDir(toolName, installDir) !== null
);
```

Use `findVivadoInInstallDir` for Vivado. Leave all non-`installDirs` branches
unchanged.

- [ ] **Step 4: Verify focused and full project checks**

Run the focused Jest command, then `npm test` and `git diff --check`.
Expected: all commands exit zero.
