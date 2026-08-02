# Vendor Version Propagation Implementation Plan

**Status:** Completed in PR #202 (2026-08-01). All five tasks were implemented,
reviewed, and verified. Later review hardening added native Docker launcher
selection, atomic scanner cache/selection writes, resource-scope propagation,
and direct availability checks.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make every vendor-tool launch consistently honor the relevant Vivado or Quartus version.

**Architecture:** Keep selection policy in `resolveToolchainVersion.ts`: one helper for project-backed actions and one for resource-scoped actions without a project file. Thread a `preferredVersion` value through launch, Docker, and build-mode boundaries rather than replicating resolver logic in commands. Versioned scanner caches prevent one installed Vivado version from replacing another version's catalog data.

**Tech Stack:** TypeScript, VS Code extension API, Jest with `config/jest.config.js`.

## Global Constraints

- Use relative imports in production source; property names are camelCase only.
- Preserve the dependency direction: utilities/services before commands and components.
- Do not auto add, commit, or push; developer review controls all commits.
- Run Jest with `--config config/jest.config.js`; run `npm run lint`, `npm run type-check`, and `npm run compile` before handoff.
- Cancellation must not launch an external vendor tool or overwrite scanner caches.

---

### Task 1: Add resource-scoped no-project version resolution

**Files:**
- Modify: `src/services/toolchains/resolveToolchainVersion.ts`
- Test: `src/test/suite/services/toolchains/resolveToolchainVersion.test.ts`

**Interfaces:**
- Consumes: `listConfiguredVersions`, `pickToolVersion`, `ToolVersionChoice`.
- Produces: `resolveToolchainVersionForResource(cfg, vendor): Promise<ToolVersionChoice | undefined | null>`.

- [x] **Step 1: Write failing tests for pin, picker, no configured version, and cancellation**

```ts
it('uses a configured resource pin without opening the picker', async () => {
  const cfg = makeCfg({ 'vivado.pinnedVersion': '2024.2', 'vivado.installDirs': ['/x'] });
  mockResolveVivadoVersions.mockReturnValue([{ version: '2024.2', installDir: '/x' }]);
  await expect(resolveToolchainVersionForResource(cfg, 'vivado')).resolves.toEqual({
    runner: 'local', version: '2024.2',
  });
  expect(pickToolVersionModule.pickToolVersion).not.toHaveBeenCalled();
});

it('returns undefined when the resource picker is dismissed', async () => {
  mockPickToolVersion.mockResolvedValue(undefined);
  await expect(resolveToolchainVersionForResource(configuredCfg, 'quartus')).resolves.toBeUndefined();
});
```

- [x] **Step 2: Run the focused resolver test and verify the new import is missing**

Run: `npx jest --config config/jest.config.js src/test/suite/services/toolchains/resolveToolchainVersion.test.ts`

Expected: FAIL because `resolveToolchainVersionForResource` is not exported.

- [x] **Step 3: Implement the smallest resolver helper**

```ts
export async function resolveToolchainVersionForResource(
  cfg: vscode.WorkspaceConfiguration,
  vendor: Vendor
): Promise<ToolVersionChoice | undefined | null> {
  const configured = listConfiguredVersions(cfg, vendor);
  const pinned = cfg.get<string>(`${vendor}.pinnedVersion`, '').trim();
  const pinnedChoice = configured.find((choice) => choice.version === pinned);
  if (pinnedChoice) return pinnedChoice;
  if (configured.length === 0) return null;
  return pickToolVersion(cfg, vendor);
}
```

- [x] **Step 4: Re-run the focused resolver test**

Run: `npx jest --config config/jest.config.js src/test/suite/services/toolchains/resolveToolchainVersion.test.ts`

Expected: PASS.

### Task 2: Make descriptor GUI actions and Platform Designer availability version-aware

**Files:**
- Modify: `src/commands/editInIpPackager.ts`
- Modify: `src/commands/editInPlatformDesigner.ts`
- Modify: `src/services/toolchains/QuartusToolchain.ts`
- Test: `src/test/suite/commands/editInIpPackager.test.ts`
- Test: `src/test/suite/commands/editInPlatformDesigner.test.ts`
- Test: `src/test/suite/services/toolchains/QuartusToolchain.test.ts`

**Interfaces:**
- Consumes: `resolveToolchainVersionForResource` from Task 1.
- Produces: GUI launch calls that pass `choice?.version`, and `isSubToolAvailable` support for `quartus.installDirs` and `quartus.dockerImages`.

- [x] **Step 1: Write failing command tests for selected version and cancellation**

```ts
it('passes the selected Vivado version to IP Packager resolution and Docker', async () => {
  mockResolveForResource.mockResolvedValue({ runner: 'local', version: '2024.2' });
  await editInIpPackagerCommand(vscode.Uri.file('/ip/xilinx/component.xml'));
  expect(mockToolchain.resolve).toHaveBeenCalledWith('vivado', expect.anything(), '2024.2');
  expect(mockToolchain.getDocker).toHaveBeenCalledWith(expect.anything(), expect.any(String), '2024.2');
});

it('does not launch Platform Designer when version selection is cancelled', async () => {
  mockResolveForResource.mockResolvedValue(undefined);
  await editInPlatformDesignerCommand(vscode.Uri.file('/ip/altera/foo_hw.tcl'));
  expect(mockSpawnGui).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Add failing availability tests for the new Quartus settings**

```ts
it('finds qsys-edit in a configured multi-version local install', () => {
  mockResolveQuartusVersions.mockReturnValue([{ version: '23.1', installDir: '/opt/23.1' }]);
  mockFindInInstallDir.mockReturnValue('/opt/23.1/quartus/sopc_builder/bin/qsys-edit');
  expect(toolchain.isSubToolAvailable('qsys-edit', makeCfg({ 'quartus.installDirs': ['/opt/23.1'] }))).toBe(true);
});
```

- [x] **Step 3: Run the three focused tests and verify the new behavior fails**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/editInIpPackager.test.ts src/test/suite/commands/editInPlatformDesigner.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts`

Expected: FAIL because GUI commands omit `preferredVersion` and sub-tool availability ignores the arrays.

- [x] **Step 4: Implement resource selection and availability parity**

```ts
const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, targetUri);
const choice = await resolveToolchainVersionForResource(cfg, 'vivado');
if (choice === undefined) return;
const launcher = toolchain.resolve('vivado', cfg, choice?.version);
const docker = toolchain.getDocker(cfg, tmpDir, choice?.version);
```

For `qsys-edit`, resolve every configured local version and check the chosen install directory for the sub-tool; for Docker runner, return true when either `dockerImages` or legacy `dockerImage` is configured.

- [x] **Step 5: Re-run the focused tests**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/editInIpPackager.test.ts src/test/suite/commands/editInPlatformDesigner.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts`

Expected: PASS.

### Task 3: Propagate selected versions through builds and Generate & Build

**Files:**
- Modify: `src/services/toolchains/SynthesisToolchain.ts`
- Modify: `src/services/toolchains/VivadoToolchain.ts`
- Modify: `src/services/toolchains/QuartusToolchain.ts`
- Modify: `src/commands/BuildCommands.ts`
- Modify: `src/commands/VendorProjectCommands.ts`
- Test: `src/test/suite/commands/BuildCommands.test.ts`
- Test: `src/test/suite/services/toolchains/VivadoToolchain.test.ts`
- Test: `src/test/suite/services/toolchains/QuartusToolchain.test.ts`

**Interfaces:**
- Consumes: `resolveToolchainVersionForOpen` and `resolveToolchainVersionForResource` from Task 1.
- Produces: `BuildMode` metadata with a vendor and project-file path; `run(preferredVersion?: string)`; `detectBuildModes(..., preferredVersion?: string)`.

- [x] **Step 1: Write failing build tests that characterize selection forwarding**

```ts
it('runs a direct Vivado build with the project-detected version', async () => {
  mockResolveForOpen.mockResolvedValue({ runner: 'local', version: '2023.2' });
  await runBuildCommand(vscode.Uri.file('/ip/foo.ip.yml'));
  expect(mockBuildMode.run).toHaveBeenCalledWith('2023.2');
});

it('stops Generate & Build when the no-project version picker is cancelled', async () => {
  mockResolveForResource.mockResolvedValue(undefined);
  await generateAndBuildVivado(context, roots, vscode.Uri.file('/ip/foo.ip.yml'));
  expect(mockExecuteCommand).not.toHaveBeenCalledWith('fpga-ip-core.buildVivadoOoc', expect.anything(), expect.anything());
});
```

- [x] **Step 2: Run focused build and toolchain tests to verify they fail**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/BuildCommands.test.ts src/test/suite/services/toolchains/VivadoToolchain.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts`

Expected: FAIL because build modes do not accept a version and Generate & Build does not resolve one.

- [x] **Step 3: Add version-carrying build mode metadata and forwarding**

```ts
export interface BuildMode {
  label: string;
  description: string;
  projectFilePath: string;
  run: (preferredVersion?: string) => Promise<BuildReports | undefined>;
}

async function detectTargets(name: string, ipDir: string, cfg: vscode.WorkspaceConfiguration) {
  return toolchain.detectBuildModes(name, ipDir, cfg, channel, preferredVersion);
}
```

Set Vivado mode project paths to `xilinx/build/ooc/${name}.xpr` and `xilinx/build/xpr/${name}.xpr`; set Quartus to `altera/build/${name}.qpf`. Build commands resolve the chosen mode’s project path with `resolveToolchainVersionForOpen`; if no file signal exists, the existing resolver falls back to the picker. Toolchains pass the received `preferredVersion` to their launch and Docker functions.

- [x] **Step 4: Resolve once in Generate & Build and forward the choice**

```ts
const choice = await resolveToolchainVersionForResource(cfg, 'vivado');
if (choice === undefined) return;
await vscode.commands.executeCommand('fpga-ip-core.buildVivadoOoc', ipCoreUri, choice?.version);
```

Use the corresponding Quartus call. The build command accepts the optional supplied version and does not invoke a second picker when it is provided.

- [x] **Step 5: Re-run focused build and toolchain tests**

Run: `npx jest --config config/jest.config.js src/test/suite/commands/BuildCommands.test.ts src/test/suite/services/toolchains/VivadoToolchain.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts`

Expected: PASS.

### Task 4: Version-select and isolate Vivado scanner caches

**Files:**
- Modify: `src/commands/scanVivadoCatalog.ts`
- Modify: `src/commands/scanVivadoInterfaces.ts`
- Modify: `src/services/VivadoCatalogScanner.ts`
- Modify: `src/services/VivadoInterfaceScanner.ts`
- Test: `src/test/suite/services/VivadoCatalogScanner.test.ts`
- Test: `src/test/suite/services/VivadoInterfaceScanner.test.ts`

**Interfaces:**
- Consumes: `ToolVersionChoice` and `resolveToolchainVersionForResource`.
- Produces: `scan(choice: ToolVersionChoice | null)` operations that use a resolved launcher/install and versioned cache directories.

- [x] **Step 1: Write failing scanner tests for preferred resolution and cache isolation**

```ts
it('writes a catalog below a version-specific cache directory', async () => {
  await scanner.scan({ runner: 'local', version: '2024.2' });
  expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('/vivado/2024.2/catalog.json'), expect.any(String), 'utf8');
});

it('reads interfaces from the install matching the selected version', async () => {
  await scanner.scan({ runner: 'local', version: '2023.1' });
  expect(mockResolveVivadoVersions).toHaveBeenCalled();
  expect(mockReadDir).toHaveBeenCalledWith('/opt/Vivado/2023.1/data/ip/interfaces', expect.anything());
});
```

- [x] **Step 2: Run focused scanner tests and verify they fail**

Run: `npx jest --config config/jest.config.js src/test/suite/services/VivadoCatalogScanner.test.ts src/test/suite/services/VivadoInterfaceScanner.test.ts`

Expected: FAIL because scanners have no choice parameter and use one global cache / legacy install setting.

- [x] **Step 3: Implement explicit choice handling**

```ts
const choice = await resolveToolchainVersionForResource(cfg, 'vivado');
if (choice === undefined) return;
const result = await scanner.scan(cfg, choice?.version);
```

Resolve catalog launchers with `getVivadoLauncher(cfg, preferredVersion)`. Resolve interface directories via `resolveVivadoVersions(cfg.get('vivado.installDirs', []))` and an exact version match, then fall back only through existing legacy/PATH behavior when the resolver result is `null`. Put cache files below `getIpcraftConfigDir()/vivado/<encodeURIComponent(version)>/`.

- [x] **Step 4: Re-run focused scanner tests**

Run: `npx jest --config config/jest.config.js src/test/suite/services/VivadoCatalogScanner.test.ts src/test/suite/services/VivadoInterfaceScanner.test.ts`

Expected: PASS.

### Task 5: Verify the complete integration surface

**Files:**
- Modify only if test or lint failures require a direct fix in files from Tasks 1–4.
- Test: affected suites from Tasks 1–4.

**Interfaces:**
- Consumes: all propagated `preferredVersion` interfaces.
- Produces: a verified build with no untested version-bypass regression.

- [x] **Step 1: Search for remaining vendor launches that omit version policy**

Run: `rg -n "getVivadoLauncher\\(|getQuartusTool\\(|resolve\\('(vivado|quartus|qsys-edit)'|getDocker\\(" src/commands src/services --glob '!src/test/**'`

Expected: each user-triggered launch is either deliberately global/non-versioned or receives an explicit selected version.

- [x] **Step 2: Run all directly affected unit suites**

Run: `npx jest --config config/jest.config.js src/test/suite/services/toolchains/resolveToolchainVersion.test.ts src/test/suite/commands/BuildCommands.test.ts src/test/suite/commands/editInIpPackager.test.ts src/test/suite/commands/editInPlatformDesigner.test.ts src/test/suite/services/VivadoCatalogScanner.test.ts src/test/suite/services/VivadoInterfaceScanner.test.ts src/test/suite/services/toolchains/VivadoToolchain.test.ts src/test/suite/services/toolchains/QuartusToolchain.test.ts`

Expected: PASS.

- [x] **Step 3: Run repository verification**

Run: `npm run lint && npm run type-check && npm run compile`

Expected: all commands exit 0 with no ESLint warnings.
