# Multi-version Vivado/Quartus toolchain support — design

Date: 2026-08-01

**Status:** Proposed — design approved, no issue or implementation plan yet.

## Problem

AMD (Vivado) and Intel (Quartus) each ship a new toolchain release roughly
twice a year. Users routinely have several versions installed side by side —
to migrate gradually, or because different projects were pinned to whatever
release existed when they were created. IPCraft currently only supports a
single configured install per vendor:

- `ipcraft.vivado.installDir` / `ipcraft.quartus.installDir` are plain
  strings (`package.json:989`, `package.json:1051`).
- `resolveVivadoInstallDir` (`src/utils/vivadoResolver.ts:41-62`) already has
  a rudimentary "family directory" mode: if `installDir` points at a parent
  folder containing several versioned subfolders, it silently picks the
  lexicographically **latest** one. There is no way to target an older
  version, and Quartus's resolver (`src/utils/quartusResolver.ts`) has no
  equivalent behavior at all — it requires `installDir` to already be the
  exact version directory.
- Nothing detects which version a given project (`.xpr`/`.qpf`) actually
  needs; whatever is configured is used unconditionally
  (`VivadoToolchain.ts:143,166` → `getVivadoLauncher(cfg)`).

Goal: let users register several installed versions (and, per later
clarification, several Docker images) per vendor, have IPCraft pick the
correct one automatically when opening an existing project, and let users
force a specific version at any time — with a UX that stays out of the way
in the common case.

## A. Settings model & version identification

Replace the single `installDir` string with arrays, for both vendors and
both runners:

```jsonc
"ipcraft.vivado.installDirs": [
  "/tools/Xilinx/Vivado/2024.2",
  "/tools/Xilinx/Vivado/2025.1"
],
"ipcraft.quartus.installDirs": [
  "/opt/intelFPGA_pro/23.1",
  "/opt/intelFPGA_pro/24.1"
],
"ipcraft.vivado.dockerImages": [
  { "label": "2024.2", "image": "myregistry/vivado:2024.2" },
  { "label": "2025.1", "image": "myregistry/vivado:2025.1" }
],
"ipcraft.quartus.dockerImages": [
  { "label": "23.1", "image": "myregistry/quartus:23.1" }
]
```

- **Local entries** (`installDirs`) auto-derive their version label the same
  way IPCraft can already do today — reuse/extend the `vivado -version`
  probe in `src/utils/detectVivadoVersion.ts`, and add an equivalent
  `quartus_sh --version` probe for Quartus — falling back to the folder name
  (e.g. `2024.2`) when the probe fails or is slow. No separate field for the
  user to keep in sync.
- **Docker entries** need an explicit `label`, since image references
  (`myregistry/vivado:latest-patched`) can't be reliably parsed into a
  version. Same shape as the existing `customBoards.vivado`/
  `customBoards.quartus` array-of-object pattern
  (`package.json:1004-1024,1066-1087`).
- **Migration**: the old `ipcraft.vivado.installDir` /
  `ipcraft.quartus.installDir` (singular) settings are read once at
  activation and folded into `installDirs` as a single-item array if the new
  array setting is empty and the old one is set, with a one-time info
  notification ("Migrated your Vivado install path to the new multi-version
  setting"). The old keys stay registered but are marked deprecated in
  `package.json`, not removed.

## B. Detection pipeline & confidence tiers

When opening an existing `.xpr`/`.qpf` (or its containing project),
detection runs in this order, stopping at the first source that yields a
candidate:

1. **IPCraft sidecar** — a small file (`.ipcraft-toolchain.json`) written
   next to the project file whenever IPCraft itself runs `createProject()`,
   recording `{ vendor, version, sourcePath }` for exactly what created it.
   **Confidence: exact.**
2. **Real parsing of the project file:**
   - Quartus: read the plain `QUARTUS_VERSION = "23.1"` line directly out of
     the `.qpf`. **Confidence: exact.**
   - Vivado: read the root `<Project Version="N" Minor="M">` attributes and
     match against a small internal `{formatVersion → [candidate
     releases]}` table built from known Vivado releases. Because Xilinx does
     not guarantee a 1:1 mapping from project-file format version to
     release, a single format-version can map to **one or more** candidate
     releases. **Confidence: exact (single candidate) or ambiguous (multiple
     candidates).**
3. **No signal available** — unrecognized/very old format-version, parse
   failure, or no project file exists yet (first-time project creation).
   **Confidence: none.**

Confidence tiers map to UX:

| Tier | Meaning | UX |
|---|---|---|
| Exact, and that version is installed | One candidate, it's configured | Launch immediately; toast every time: *"Opening with Vivado 2024.2 (detected from project) — Change"* |
| Exact or ambiguous, but **not** installed | Required version(s) known, none configured | Warning naming required vs. available versions, with actions *"Use 2024.2 anyway"*, *"Browse for install dir…"*, *"Configure paths"* (closest-installed suggested by version-string proximity). Never silently substitutes. |
| Ambiguous (multiple candidates) or none | Can't narrow to one version | QuickPick of all configured versions (local + Docker, merged, grouped by vendor/runner), required-version candidates (if any) pre-selected/highlighted first; includes a **"Remember for this workspace"** checkbox |

Vivado's format-version table only needs to distinguish releases the user
actually has configured, since matching is scoped to their `installDirs`/
`dockerImages` — with the typical 1-3 configured versions, true ambiguity
should be rare in practice.

## C. Remembering & explicit override

- **"Remember for this workspace"** (checked in the QuickPick) writes a
  resource-scoped setting — `ipcraft.vivado.pinnedVersion` /
  `ipcraft.quartus.pinnedVersion` — following the same pattern
  `pinnedPart`/`pinnedDevice` already use. Once set, the confident-tier
  behavior applies going forward: launch + toast, no QuickPick, until the
  user changes it.
- **Toast's "Change" action**, and a new standalone command — **"IPCraft:
  Select Vivado Version"** / **"IPCraft: Select Quartus Version"** (Command
  Palette, and a context-menu entry on `.xpr`/`.qpf`) — both open the same
  QuickPick, letting the user force a specific version at any time,
  independent of detection outcome.
- Picking a version this way also offers **"Remember for this workspace"**,
  so a manual override can become the new default the same way an
  ambiguous-detection resolution can.
- No persistent status bar item — the toast is the passive indicator, the
  command/context-menu entry is the active override.

## D. Create Project (no project file yet) & sidecar stamping

- `createProject()`/`scaffold()` (`VivadoToolchain.ts`, `QuartusToolchain.ts`)
  have no file to detect from yet. They reuse the same resolution order:
  pinned workspace version if set → else the QuickPick (tier-3 flow) → the
  chosen local install or Docker image runs the TCL/scripts.
- Immediately after a successful `createProject()`, IPCraft writes the
  sidecar next to the generated `.xpr`/`.qpf`, recording exactly which
  install/image produced it. This makes tier-1 detection exact on every
  subsequent open — including by a teammate on a different machine, as long
  as their configured `installDirs`/`dockerImages` include a matching
  version (otherwise tier-2 real-parsing applies as it would for any
  externally-created project).
- The sidecar is generator output, not user-facing config: it lives under
  the same `xilinx/`/`altera/` output directories already treated as
  generated/build artifacts.

## E. Architecture / file-level plan

Keeps the existing dependency direction (types/utils → services →
components) and the "one canonical implementation for shared behavior"
rule, since Vivado and Quartus already share `SynthesisToolchain`.

- **New pure module** `src/utils/toolchainVersions.ts` — vendor-agnostic
  version matching/comparison/proximity logic, used by both resolvers and
  the picker. Pure functions, unit-testable in isolation, no `vscode`
  import.
- **Extend** `src/utils/vivadoResolver.ts` / `src/utils/quartusResolver.ts`
  — add version-derivation (`vivado -version` / `quartus_sh --version`
  probes, folder-name fallback) and multi-entry resolution against
  `installDirs`. Existing single-path functions keep working during
  migration.
- **New** `src/services/toolchainVersionDetector.ts` — the detection
  pipeline (sidecar read → `.qpf`/`.xpr` parse → none), shared shape for
  both vendors, vendor-specific parsers injected.
- **New** `src/utils/pickToolVersion.ts` — QuickPick UI, modeled directly on
  `src/utils/pickBoard.ts` (grouping, remember/pin checkbox, recently-used).
- **New command files** `src/commands/selectVivadoVersion.ts`,
  `selectQuartusVersion.ts`; new context-menu/command-palette entries in
  `package.json`.
- **`VivadoToolchain.ts`/`QuartusToolchain.ts`**: `createProject()` writes
  the sidecar after success; `resolve()`/`getVivadoLauncher()`/
  `getQuartusTool()` take the resolved version-specific path instead of a
  single `installDir`.
- **`package.json`**: new `installDirs`/`dockerImages` array settings,
  resource-scoped `pinnedVersion` per vendor, migration handled in
  `extension.ts` activation, old singular settings kept but deprecated.
- **Docker launch path** (`BuildRunner.ts`'s `getDocker`/`getLaunchEnv`):
  switches from a single configured image to the resolved entry's `image`
  field.

**Testing**: unit tests for `toolchainVersions.ts` matching/proximity logic
and the detection pipeline (mock sidecar/file contents) in
`src/test/suite/`; existing `VivadoToolchain.test.ts`/
`QuartusToolchain.test.ts`/`registry.test.ts` extended for multi-entry
resolution; no new e2e coverage needed beyond what `openInVivado`/
`openInQuartus` already have, since the command surface is unchanged — only
what backs it changes.

## F. Out of scope

- Quartus edition selection (Lite/Standard/Pro) — separate axis from
  version, not requested.
- Auto-downloading or installing missing versions.
- Syncing `installDirs` across machines/users beyond normal VS Code
  settings sync.
