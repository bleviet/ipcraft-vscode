# Vendor Version Propagation Design

**Status:** Implemented in PR #202 (2026-08-01).

## Goal

Ensure every Vivado and Quartus integration action uses the relevant configured tool version instead of silently selecting the default installation or Docker image.

## Scope

The change covers Open in Vivado/Quartus, IP Packager, Platform Designer,
vendor builds, project generation/scaffolding, Generate & Build, Vivado
catalog scans, Vivado interface scans, and Platform Designer command
availability. Import and scaffolding do not launch a vendor tool, but they
read the matching resource-scoped interface cache.

## Selection policy

Actions with an existing vendor project file use the established project-open policy: a valid resource pin first, then sidecar/project-file detection, then the version picker. This applies to builds when the generated `.xpr` or `.qpf` is available.

Actions without a vendor project file use the resource pin when it names a configured version; otherwise they show the existing version picker. This applies to IP Packager, Platform Designer, project creation before a project exists, and Generate & Build.

Vivado catalog and interface scans are workspace-level operations. They use the workspace pin when valid, otherwise the picker. Their cached output is stored per selected Vivado version so scanning one installation cannot overwrite another installation's data.

When the user cancels a picker, the action performs no external tool launch or cache update. `null` continues to mean legacy/PATH fallback for callers where preserving that behavior is required.

## Architecture

Extend the toolchain-version resolver with a single resource-aware helper for actions that need a configured version but have no project file. The helper returns the existing `ToolVersionChoice | undefined | null` shape, allowing current cancellation and legacy fallback semantics to remain explicit.

Thread `preferredVersion` through the build-mode boundary. Build commands resolve a version before detecting modes; both Vivado and Quartus toolchains pass it to executable and Docker resolution. Generate & Build resolves once and invokes the build command with that selection so it cannot reopen a competing picker or choose a different version.

IP Packager and Platform Designer use the no-project helper with the selected descriptor URI. Platform Designer's `qsys-edit` availability check recognizes the same multi-version local and Docker settings used by its resolver.

Vivado scanners receive the selected choice explicitly. The catalog scanner records the actual selected version and uses a version-specific cache path. The interface scanner resolves its installation from the selected version rather than relying on the deprecated singular `installDir`.

Successful scans persist their selected cache version per workspace resource
and cache kind. A changed pin invalidates that persisted selection; an
explicit legacy/PATH scan remains unversioned. Cache payloads and selection
metadata are staged and replaced atomically, preserving the previous
selection if a write fails.

All Docker GUI, build, project-creation, and catalog actions use the
container-native vendor executable through `resolveExecutionLauncher`. This
prevents a host executable resolved from `installDirs` from being passed into
a selected Docker image.

## Error handling

Cancellation stops the initiating command without launching a process. A
missing configured version follows the existing user-facing picker/no-version
warning flow. Scanner failures retain their current error notification
behavior and never delete or overwrite another version's cache. The browser
CI webpack step receives `NODE_OPTIONS=--max-old-space-size=4096` so macOS
can build browser assets before Playwright starts.

## Testing

Focused unit tests cover no-project selection, cancellation, preferred-version
propagation through build modes, native Docker executables, scanner selection,
cache isolation and failure recovery, resource scope, and `qsys-edit`
availability with `installDirs` and `dockerImages`. Existing open-project
detection tests remain in place.
