# Sync Correctness Refactoring Tasks

- `[x]` V-5: Shared Message Types
  - `[x]` Create `src/shared/messages/memoryMap.ts`
  - `[x]` Create `src/shared/messages/ipCore.ts`
- `[x]` V-5: Unified Message Dispatch
  - `[x]` Create `src/services/WebviewRouter.ts`
  - `[x]` Update `src/providers/providerServices.ts`
  - `[x]` Migrate `src/providers/MemoryMapEditorProvider.ts` to `WebviewRouter`
  - `[x]` Migrate `src/providers/IpCoreEditorProvider.ts` to `WebviewRouter`
  - `[x]` Migrate `src/providers/IpCoreSourcePreviewProvider.ts` to `WebviewRouter`
  - `[x]` Delete `src/services/MessageHandler.ts`
- `[x]` V-3 & V-4: Revisioned Sync & Debounce Guards
  - `[x]` Update `src/services/DocumentManager.ts` to support version verification
  - `[x]` Update `src/providers/IpCoreGenerateHandler.ts` to check `UpdateResult`
  - `[x]` Update webview `src/webview/hooks/useYamlSync.ts` with version checks
  - `[x]` Update webview `src/webview/ipcore/hooks/useIpCoreSync.ts` with version checks, capture-phase interceptor, and flush-on-hide/unmount
- `[x]` Adapt Unit Tests & Verify
  - `[x]` Adapt `src/test/suite/services/DocumentManager.test.ts`
  - `[x]` Adapt `src/test/suite/services/DocumentManager.race.test.ts`
  - `[x]` Create `src/test/suite/services/WebviewRouter.test.ts`
  - `[x]` Delete `src/test/suite/services/MessageHandler.test.ts`
  - `[x]` Verify compilation, linting, and unit tests run successfully

## Review follow-ups

Corrections found during post-implementation review (all verified: compile, lint, type-check, unit tests green).

- `[x]` Fix IP Core `command:'openFile'` dead path: route the canvas/import-file
  open actions through the dedicated `openFile` message; drop the misleading
  early-return branch in the IP Core `command` handler (it shadowed the standard one).
- `[x]` Fix IP Core `docVersion` stamping: capture `document.version` alongside the
  text in `updateWebview` and pass it to `postUpdate(payload, docVersion)`, so async
  import resolution can't desync the stamped version from the text it describes.
- `[x]` Add `forceResync` to the stale-base reject → resync path so a concurrent
  external edit cannot be visually dropped (FIFO mislabel + advanced version).
- `[x]` Omit `baseDocVersion` until a real version is seen (avoid spurious stale-base
  rejection of the first edit). Centralized in the shared filter below.
- `[x]` Extract webview receive/send rules into `src/webview/sync/revisionFilter.ts`
  (`shouldApplyUpdate`, `buildUpdateMessage`); both hooks now consume it (removes the
  duplicated, separately-maintained logic in `useYamlSync` / `useIpCoreSync`).
- `[x]` Add `src/test/suite/webview/revisionFilter.test.ts` (filter unit tests).
- `[x]` Add `src/test/suite/integrationLike/syncProtocol.test.ts` (host router +
  DocumentManager + webview filter harness: self-echo suppression, external-edit
  apply, stale-base reject → force-resync, first-edit-before-handshake).
