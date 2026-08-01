# Toolchain Review Fixes Design

**Status:** Implemented in PR #202 (2026-08-01).

## Goal

Address the two important PR #202 review findings without changing the
version-selection contract: all launch paths use the shared Docker/local
launcher policy, and availability checks do not execute vendor binaries.

## Design

Build-mode closures in `VivadoToolchain` and `QuartusToolchain` will call
`resolveExecutionLauncher`. They pass the Docker configuration, the
container-native executable (`vivado` or `quartus_sh`), and the existing local
resolver. This preserves both preferred-version selection and the rule that a
Docker container never receives a host executable path.

`isAvailable` and Quartus `isSubToolAvailable` will treat configured
`installDirs` as directories to search, not versions to detect. They will use
the existing filesystem helpers for each configured directory. Docker,
single-install, and PATH fallback behavior remains unchanged.

The browser-test workflow now gives only its webpack build step a 4 GB Node
heap. This resolves the macOS runner's build-stage out-of-memory failure
without changing Playwright workers or unrelated CI jobs.

## Tests

Toolchain tests will prove build modes call the shared launcher path for local
and Docker execution, and prove availability checks find configured
executables without invoking `resolveVivadoVersions` or
`resolveQuartusVersions`.
