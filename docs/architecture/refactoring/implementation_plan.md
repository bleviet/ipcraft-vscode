# Sync Correctness Refactoring Plan (V-5, V-3, V-4)

Implement the second sequencing point (Sync correctness) from the refactoring recommended order: V-5 (Unified Message Dispatch), V-3 (Revisioned Sync Protocol), and V-4 (Debounced Push Data-Loss Window).

## User Review Required

None. The proposed changes are architectural and protocol-level improvements to guarantee editing correctness. When a version mismatch is detected due to external changes, a standard VS Code warning notification is shown prompting the user that the editor has been reloaded, preventing silent data loss.

## Open Questions

None.

## Proposed Changes

### Shared Message Types (V-5)

Define discriminated message union types for both editors to guarantee type safety at the message boundary.

#### [NEW] [memoryMap.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/shared/messages/memoryMap.ts)
- Define `MmWebviewMessage` union capturing all message types sent from the Memory Map editor webview: `ready`, `update`, `command`.

#### [NEW] [ipCore.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/shared/messages/ipCore.ts)
- Define `IpCoreWebviewMessage` union capturing all message types sent from the IP Core editor webview (including `generate`, `selectFiles`, `checkFilesExist`, `stagingResult`, and toolchain actions).

---

### Unified Message Dispatch (V-5)

Introduce a centralized `WebviewRouter` that manages messaging lifecycle, ready-gating, and standard document actions.

#### [NEW] [WebviewRouter.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/WebviewRouter.ts)
- Class `WebviewRouter` that wraps a `vscode.WebviewPanel` and its event registrations.
- Queues outbound messages (`postUpdate`) until the `ready` handshake is received from the webview.
- Implements standard document handlers (`update`, `command` for save, validate, openFile).
- Handles revision tracking FIFO queues and handles version verification.
- Exposes `popSourceEditId` for custom change dispatch pairing.
- Implements disposal to clean up listener registrations.

#### [DELETE] [MessageHandler.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/MessageHandler.ts)
- Remove `MessageHandler.ts` class. Standard document handlers are moved into `WebviewRouter.ts`.

#### [MODIFY] [providerServices.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/providerServices.ts)
- Remove `messageHandler` instantiation. Expose `yamlValidator` and `documentManager` directly to providers.

---

### Revisioned Sync Protocol (V-3) & Debounced Push Guard (V-4)

Implement the monotonic `editId` on the webview, `docVersion` on the host, and check document versions before applying changes to prevent concurrent overwrite data loss.

#### [MODIFY] [DocumentManager.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/services/DocumentManager.ts)
- Update `updateDocument` to accept `baseDocVersion?: number`.
- Change return type of `updateDocument` to a typed `UpdateResult` union:
  - `{ type: 'applied' }`
  - `{ type: 'noop' }`
  - `{ type: 'rejected'; reason: 'stale-base' | 'error' }`
- Reject updates if `baseDocVersion` is specified and the current `document.version` does not match.

#### [MODIFY] [IpCoreGenerateHandler.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/IpCoreGenerateHandler.ts)
- Adapt `handleGenerateRequest` to check `updateResult.type === 'applied'` or `type !== 'rejected'`.

#### [MODIFY] [MemoryMapEditorProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/MemoryMapEditorProvider.ts)
- Instantiate `WebviewRouter` instead of using `MessageHandler`.
- Delegate `onDidChangeTextDocument` events to `router.handleDocumentChange(e)`.

#### [MODIFY] [IpCoreEditorProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/IpCoreEditorProvider.ts)
- Remove manual `isReady` flags and inline message dispatch tables.
- Instantiate `WebviewRouter` and register handlers using `router.on()`.
- Thread `router.popSourceEditId()` into the document change listener to stamp `sourceEditId` when updating the webview.

#### [MODIFY] [IpCoreSourcePreviewProvider.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/providers/IpCoreSourcePreviewProvider.ts)
- Use `WebviewRouter` for consistent routing and ready-gating.

#### [MODIFY] [useYamlSync.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/hooks/useYamlSync.ts)
- Track monotonic `lastSentEditId` and `seenDocVersion`.
- Include `editId` and `baseDocVersion` in `update` payloads.
- Filter out stale updates (`docVersion <= seenDocVersion`) and own echos (`sourceEditId === lastSentEditId`).

#### [MODIFY] [useIpCoreSync.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/ipcore/hooks/useIpCoreSync.ts)
- Track `lastSentEditId` and `seenDocVersion`.
- Intercept incoming window messages during the capture phase to drop stale/echoed events.
- Implement flush-on-hide and flush-on-unmount to guarantee pending edits are sent when the tab is hidden/closed.
- Tune debounce timeout from 500ms to 150ms for improved editing responsiveness.

---

### Review follow-ups (post-implementation hardening)

Corrections from the correctness review of the changes above.

#### [NEW] [revisionFilter.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/sync/revisionFilter.ts)
- Pure webview-side protocol rules shared by both hooks: `shouldApplyUpdate` (drop stale/self-echo, honor `forceResync`) and `buildUpdateMessage` (monotonic `editId`; omit `baseDocVersion` until a real version is seen). Removes the duplicated logic previously maintained in `useYamlSync` and `useIpCoreSync` separately.

#### [MODIFY] WebviewRouter / IpCoreEditorProvider
- `postUpdate(payload, docVersion?)` so async callers stamp the version captured **with** the text; `updateWebview` now captures `document.version` next to `getText()`.
- Stale-base rejection resync carries `forceResync: true`, so a concurrent external edit cannot be visually dropped (FIFO mislabel + advanced `seenDocVersion`).
- IP Core `command` handler no longer shadows standard `save`/`validate`/`openFile`; canvas/import open actions use the dedicated `openFile` message.

#### [NEW] Tests
- `revisionFilter.test.ts` — unit tests for the shared filter (incl. the `baseDocVersion`-omission fix).
- `integrationLike/syncProtocol.test.ts` — real host router + `DocumentManager` + webview filter harness covering self-echo suppression, external-edit apply, the stale-base reject → force-resync path, and first-edit-before-handshake.

---

### Tests

#### [NEW] [WebviewRouter.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/WebviewRouter.test.ts)
- Unit tests for `WebviewRouter` including message routing, ready-gating queue, standard commands, command allow-listing, and revision/version tracking logic.

#### [DELETE] [MessageHandler.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/MessageHandler.test.ts)
- Remove obsolete message handler tests.

#### [MODIFY] [DocumentManager.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/DocumentManager.test.ts)
- Adapt mock returns and assert against `UpdateResult` structures. Add tests for version check rejection.

#### [MODIFY] [DocumentManager.race.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/services/DocumentManager.race.test.ts)
- Update mock workspace edit resolution and expected return values.

## Verification Plan

### Automated Tests
- Run `npm test` to verify unit and integration tests pass.
- Run `npm run lint` to check for zero linter warnings.
- Run `npm run compile` to confirm successful build.

### Manual Verification
- Open the visual memory map and IP Core editors in Extension Development Host.
- Edit registers/fields and check that they sync smoothly without flashes or duplicate re-renders.
- Modify the document externally (or trigger a workspace edit) while editing in the webview, verifying that the visual editor receives the warning message and correctly resyncs without silently overriding the external change.
- Close/hide a tab with a pending canvas edit and confirm the edit is flushed successfully.
