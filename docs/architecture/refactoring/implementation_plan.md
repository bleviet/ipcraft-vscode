# Foundations Refactoring Plan (V-9, V-10, V-6)

Implement the first sequencing point (Foundations, zero behavior change) from the refactoring recommended order: V-9 (Centralized Resource Root Resolution), V-10 (Spec Versioning), and V-6 (Webview Handshake Cleanup).

## User Review Required

None. The proposed changes are architectural foundations with zero behavior changes. They consolidate environment-specific file-system paths, standardize the webview handshake, and assert spec conformance.

## Open Questions

None.

## Proposed Changes

### Centralized Resource Root Resolution (V-9)

Add a unified `ResourceRoots` service to resolve bundled resource paths at activation time. Pass this configuration object to downstream service constructors instead of letting them query `__dirname` independently.

#### [NEW] [ResourceRoots.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/ResourceRoots.ts)
- Define `ResourceRoots` interface capturing `schemasDir`, `builtinPacksDir`, `templatesDir`, and `busDefinitionsDir`.
- Implement `resolveResourceRoots(extensionPath: string)` for runtime extension use.
- Implement `devResourceRoots(repoRoot: string)` for ts-jest test suite use.
- Both verify directory existence synchronously and throw immediately if a directory is missing.

#### [MODIFY] [TemplateLoader.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/generator/TemplateLoader.ts)
- Remove `resolveTemplatesPath` static method and the `process.cwd()` fallback.
- Require `templatesPath` or `templatesDir` parameter in the constructor instead of defaulting to resolved paths.

#### [MODIFY] [ScaffoldPackLoader.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/generator/ScaffoldPackLoader.ts)
- Convert `ScaffoldPackLoader` to an instantiable class (accepts `builtinPacksDir: string` in its constructor).
- Refactor `resolve`, `resolveDefault`, `listBuiltinPacks`, and the `builtinPacksDir` getter to use the instance configuration instead of static properties.
- Keep the pure `load` function static.

#### [MODIFY] [BusLibraryService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/BusLibraryService.ts)
- Accept `busDefinitionsDir: string` in constructor instead of `vscode.ExtensionContext`.
- Load the default library directly from the injected directory.

#### [MODIFY] [IpCoreScaffolder.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/generator/IpCoreScaffolder.ts)
- Accept `resourceRoots: ResourceRoots` in constructor instead of `vscode.ExtensionContext`.
- Remove `IP_CORE_SCHEMA_PATH` static IIFE; resolve the schema path dynamically from `resourceRoots.schemasDir`.
- Create the internal `BusLibraryService` using `resourceRoots.busDefinitionsDir`.
- Update pack loading to use an instance of `ScaffoldPackLoader` instantiated with `resourceRoots.builtinPacksDir`.

#### [MODIFY] [providerServices.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/providerServices.ts)
- Update `createSharedProviderServices` to accept `resourceRoots: ResourceRoots`.
- In `IpCoreEditorProvider`, instantiate `IpCoreScaffolder` using the resolved `resourceRoots`.
- Pass `builtinPacksDir` to `collectAvailableScaffoldPacks` instead of relying on the static property.

#### [MODIFY] [TemplatePreviewProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/TemplatePreviewProvider.ts)
- Accept `resourceRoots: ResourceRoots` in constructor.
- Pass `resourceRoots` to the `IpCoreScaffolder` constructor and the `TemplateLoader` constructor.

#### [MODIFY] [IpCoreSourcePreviewProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/IpCoreSourcePreviewProvider.ts)
- Accept `resourceRoots: ResourceRoots` in constructor.
- Pass `resourceRoots` when instantiating `IpCoreScaffolder`.

#### [MODIFY] [ScaffoldPackPanel.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/ScaffoldPackPanel.ts)
- Pass `resourceRoots` when instantiating `IpCoreScaffolder`.

#### [MODIFY] [GenerateCommands.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/commands/GenerateCommands.ts)
- Thread `resourceRoots` through command registration. Pass `resourceRoots` when instantiating `IpCoreScaffolder`.

#### [MODIFY] [ScaffoldPackCommands.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/commands/ScaffoldPackCommands.ts)
- Thread `resourceRoots` through command registration. Replace static `ScaffoldPackLoader` references with instantiated `ScaffoldPackLoader`.

#### [MODIFY] [extension.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/extension.ts)
- Resolve `resourceRoots` at activation time using `resolveResourceRoots(context.extensionPath)`.
- Pass `resourceRoots` to providers and commands during initialization.

---

### Spec Versioning (`ipcraft-spec`) (V-10)

Add conformance safeguards to verify that the spec submodule matches the code expectation and is present.

#### [NEW] [check-submodule.js](file:///home/balevision/workspace/bleviet/ipcraft-vscode/scripts/check-submodule.js)
- Script that runs before compilation to ensure that `ipcraft-spec/schemas/ip_core.schema.json` exists. If not, it errors out with instructions to run `git submodule update --init --recursive`.

#### [MODIFY] [package.json](file:///home/balevision/workspace/bleviet/ipcraft-vscode/package.json)
- Prepend `node scripts/check-submodule.js` to the `pretest` script.
- Ensure webpack copies are strict (we will check if webpack config has warnings or errors on copy).

#### [NEW] [SpecConformance.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/SpecConformance.test.ts)
- Conformance test verifying all YAML files under `src/test/fixtures/` and templates in `ipcraft-spec/templates/` validate successfully against their respective schemas (`ip_core.schema.json` and `memory_map.schema.json`).

---

### Webview Handshake Cleanup (V-6)

Standardize the webview handshake to run strictly on the visual canvas loading event.

#### [MODIFY] [IpCoreEditorProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/IpCoreEditorProvider.ts)
- Gate `updateWebview` with a check for `isReady`.
- Initialize `isReady = false` inside `resolveCustomTextEditor`.
- Delete `setTimeout` 100ms blind timer.
- Enable `isReady = true` inside `ready` message handler, followed by `updateWebview()`.

#### [MODIFY] [IpCoreSourcePreviewProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/IpCoreSourcePreviewProvider.ts)
- Delete `setTimeout` 100ms blind timer. The initial parse will happen strictly in response to the `ready` message from the webview.

---

### Unit Test Adaptations

#### [MODIFY] [IpCoreScaffolder.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/generator/IpCoreScaffolder.test.ts)
- Instantiate `IpCoreScaffolder` by passing the `devResourceRoots(repoRoot)` configuration.

#### [MODIFY] [monitorChangeOf.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/generator/monitorChangeOf.test.ts)
- Update `IpCoreScaffolder` instantiation to pass `devResourceRoots(repoRoot)`.

#### [MODIFY] [BusLibraryService.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/BusLibraryService.test.ts)
- Update `BusLibraryService` instantiation to pass `MOCK_DIR` instead of mocking the extension context.

## Verification Plan

### Automated Tests
- Run `npm test` to verify unit and integration tests are passing.
- Run `npm run lint` to confirm zero warnings.
- Run `npm run compile` to verify compilation succeeds.

### Manual Verification
- Launch the VS Code Extension in development mode.
- Open an `.ip.yml` file and verify that the canvas opens successfully and renders the diagram.
- Edit the diagram and save, verifying that changes are synced.
- Open templates/scaffold pack and verify preview works correctly.
- Rename `dist/packs` locally to verify that extension activation fails immediately with a descriptive error.
