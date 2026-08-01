# Multi-version Vivado/Quartus Toolchain Support Implementation Plan

**Status:** Completed in PR #202 (2026-08-01), commit `98140f65`.

> **For agentic workers:** This implementation is complete. Treat this document
> as the delivery record and use the linked design and follow-up plans for
> rationale. The current source and tests are authoritative if they differ from
> an earlier planning assumption.

**Goal:** Let users register multiple Vivado and Quartus versions, select among
local installations or Docker images, detect the version required by an
existing project, and consistently propagate the selected version through
every vendor-tool action.

**Architecture:** Version comparison and install discovery remain pure utility
concerns. A shared toolchain service owns project detection and selection
policy, while commands pass an explicit optional `preferredVersion` through
the existing toolchain interfaces. Resource-scoped settings and versioned
caches prevent one workspace or vendor version from silently affecting
another.

**Tech Stack:** TypeScript, VS Code Extension API, Jest, Node filesystem and
`child_process.execFileSync` APIs.

## Global Constraints

- Preserve deprecated singular `installDir` and `dockerImage` settings as
  compatibility fallbacks.
- Treat populated `installDirs` and `dockerImages` arrays as authoritative for
  their active runner; do not silently fall through to another configured
  version.
- Keep new parameters optional and trailing so existing toolchain call sites
  remain source-compatible.
- Store `pinnedVersion` at resource scope and accept it only when it matches a
  currently configured entry for the active runner.
- Distinguish cancellation (`undefined`) from the absence of multi-version
  configuration (`null`), which preserves legacy/PATH fallback behavior.
- Never silently substitute a different version when an exact project version
  is known but unavailable; require an explicit user choice.
- Keep `.ipcraft-toolchain.json` sidecars beside the generated `.xpr` or `.qpf`.
  Sidecar reads and writes are best-effort and must not break project creation
  or detection fallback.
- Prefer Vivado's exact `Product Version` project header. Use the verified
  project-format lookup table only when that header is unavailable; never guess
  mappings for unknown format versions.
- Use `execFileSync`, not shell-composed commands, for probes of user-configured
  executable paths.
- Docker launches must use the container-native executable, never a host path
  resolved from `installDirs`.
- TypeScript and JSON properties remain camelCase; production imports remain
  relative.
- Vendor launches require workspace trust and resource-scoped configuration
  resolution.

## Delivered File Structure

- `src/utils/toolchainVersions.ts` owns version comparison, proximity,
  ordering, and the verified Vivado project-format lookup table.
- `src/utils/detectVivadoVersion.ts` and
  `src/utils/detectQuartusVersion.ts` probe a specific local executable.
- `src/utils/vivadoResolver.ts` and `src/utils/quartusResolver.ts` resolve
  versioned local installations while retaining singular-setting and PATH
  fallbacks.
- `src/utils/migrateToolchainSettings.ts` performs the one-time migration of
  legacy install directories and Docker images without overwriting populated
  arrays.
- `src/utils/pickToolVersion.ts` lists only entries usable by the active runner
  and offers resource-scoped pinning.
- `src/services/toolchains/toolchainVersionDetector.ts` owns sidecar, `.xpr`,
  and `.qpf` detection.
- `src/services/toolchains/resolveToolchainVersion.ts` is the canonical policy
  boundary for project-backed, resource-backed, creation, and local-interface
  scan selection.
- `src/services/toolchains/LaunchableTool.ts` and
  `src/services/toolchains/SynthesisToolchain.ts` carry the optional preferred
  version through launch, Docker, project creation, and build-mode contracts.
- `src/services/toolchains/VivadoToolchain.ts` and `QuartusToolchain.ts`
  implement version-aware execution and sidecar stamping.
- `src/services/VivadoCacheVersion.ts`, `VivadoCatalogScanner.ts`, and
  `VivadoInterfaceScanner.ts` isolate cache data and selected-cache metadata by
  version and resource.
- Command adapters under `src/commands/` resolve once and propagate the choice
  through opening, GUI tools, project creation, builds, Generate & Build, and
  catalog/interface scans.

## Completed Workstreams

### 1. Version matching and local discovery

- [x] Add numeric dotted-version comparison, descending ordering, proximity,
      and verified Vivado format candidates.
- [x] Add per-executable Vivado and Quartus version probes.
- [x] Resolve multiple local installs, prefer an exact requested version, and
      retain legacy singular/PATH behavior when arrays are not configured.
- [x] Cover invalid directories, failed probes, folder-name fallback, and
      Windows launcher wrappers with unit tests.

### 2. Settings and migration

- [x] Add `installDirs`, labeled `dockerImages`, and resource-scoped
      `pinnedVersion` settings for both vendors.
- [x] Deprecate, but retain, singular `installDir` and `dockerImage` settings.
- [x] Migrate each legacy setting independently only when its replacement array
      is empty.
- [x] Derive a best-effort Docker label from the legacy image tag during the
      one-time migration, including registry host/port handling.

### 3. Detection and selection policy

- [x] Read and validate sidecars without throwing on missing, corrupt, or
      mismatched data.
- [x] Detect Quartus from `QUARTUS_VERSION` in `.qpf` files.
- [x] Detect Vivado first from its exact `Product Version` header, then from a
      verified project-format mapping.
- [x] Validate pins against currently configured entries and preserve the
      runner associated with the selected version.
- [x] Implement exact, ambiguous, unavailable, cancellation, and legacy-fallback
      outcomes with focused tests.

### 4. Toolchain execution boundaries

- [x] Thread `preferredVersion` through executable resolution, Docker
      resolution, project creation, and build-mode execution.
- [x] Use `resolveExecutionLauncher` as the single Docker/local launcher
      decision so containers receive `vivado` or `quartus_sh`, not host paths.
- [x] Stamp sidecars beside generated project files after successful creation.
- [x] Keep sidecar writes non-fatal so a filesystem error cannot turn a
      successful vendor project creation into a failure.

### 5. Complete command-surface propagation

- [x] Apply the same selection policy to Open in Vivado/Quartus, IP Packager,
      Platform Designer, direct builds, project generation, and Generate & Build.
- [x] Add explicit Select Vivado Version and Select Quartus Version commands
      with resource-aware configuration and workspace-trust checks.
- [x] Propagate the selected version through Vivado catalog and interface scans,
      imports, subcore resolution, and generated-project flows.
- [x] Ensure cancellation performs no external launch and no cache mutation.

### 6. Cache isolation and review hardening

- [x] Store Vivado catalog and interface caches by selected version and cache
      kind.
- [x] Persist selected cache metadata per workspace resource and invalidate it
      when the pin changes.
- [x] Replace cache payload and selection metadata atomically so failed writes
      retain the previous valid cache.
- [x] Make availability checks search configured directories directly instead
      of executing vendor version probes.
- [x] Add the scoped browser-build heap guard required by CI.

## Deliberate Changes from the Initial Draft

The delivered implementation tightened several assumptions found during review:

- The picker lists only versions usable by the configured active runner. A
  combined local-and-Docker list could select an entry the launch path could
  not honor.
- Pins are validated rather than trusted blindly, preventing stale workspace
  state from selecting a different executable implicitly.
- The resolver returns `null` when no multi-version entries exist, preserving
  existing singular-setting and PATH users; explicit cancellation remains
  `undefined`.
- Legacy Docker settings migrate as well as install directories. The migration
  derives a best-effort initial label, while all user-created array entries
  still require an explicit label.
- Vivado's exact product-version header is checked before the sparse
  format-version table.
- Sidecars live in the actual generated project directory
  (`xilinx/build/ooc`, `xilinx/build/xpr`, or `altera/build`) and writes are
  non-fatal.
- Version policy extends beyond open/create commands to builds, GUI tools,
  scanners, caches, imports, and subcore consumers.

## Verification

Automated repository verification:

```bash
npm run lint
npm run type-check
npm run compile
npm run test:unit -- --runInBand
npm run test:integration:open-source
npm run test:browser
```

Manual smoke testing requires development hosts with two configured versions
per vendor, either as local installs or runnable Docker images:

1. Open an existing `.xpr` and `.qpf` and confirm exact detection selects the
   matching configured version.
2. Exercise each explicit version-selection command and confirm its resource
   pin is isolated to the selected workspace resource.
3. Create and build one project per vendor; confirm the sidecar is beside the
   generated project file and subsequent opens reuse it.
4. Exercise IP Packager, Platform Designer, Generate & Build, and Vivado scans;
   confirm every process and cache uses the selected version.
5. Cancel each picker once and confirm no process starts and no cache or
   selection metadata changes.

## Related Records

- [Approved design](../specs/2026-08-01-multi-version-vendor-toolchains-design.md)
- [Vendor version propagation plan](2026-08-01-vendor-version-propagation.md)
- [Vendor version propagation design](../specs/2026-08-01-vendor-version-propagation-design.md)
- [Toolchain review fixes plan](2026-08-01-toolchain-review-fixes.md)
- [Toolchain review fixes design](../specs/2026-08-01-toolchain-review-fixes-design.md)
