# V-5 — Unified Message Dispatch

> Status: proposed · Severity: Medium · Effort: M (2–3 days)
> Enables: [V-3](V-03-revisioned-sync-protocol.md) (gives the revision tracker one home)
> Source finding: [architecture.md §7 V-5](../architecture.md#v-5--dual-message-dispatch-mechanisms-on-the-host)

## Why

Host-side webview message handling grew organically into **three** mechanisms:

1. **`MessageHandler`** (`src/services/MessageHandler.ts`) — the "official" service:
   `update`, `command` (`save`/`validate`/`openFile`). Used by the MM provider… mostly.
2. **MM provider inline special case** — `MemoryMapEditorProvider.resolveCustomTextEditor`
   intercepts `ready` itself before delegating, with an `isReady` flag local to the closure.
3. **IP core provider's own table** — `IpCoreEditorProvider.registerWebviewMessageHandlers`
   builds a ~20-entry `Record<string, MessageHandlerFn>` (`ready`, `selectFiles`,
   `generate`, `stagingResult`, `setHdlLanguage`, …) and falls back to `MessageHandler`
   for anything unmatched.

Consequences:

- **No single place to reason about the protocol.** The V-3 revision stamping needs to wrap
  *every* update path; today that means three call sites.
- **Inconsistent cross-cutting concerns.** The IP core table gets the command allow-list
  (`WEBVIEW_COMMAND_ALLOWLIST`) and per-message logging decisions; `MessageHandler` has its
  own logging; the MM inline `ready` has neither. Type safety differs per mechanism
  (`message as any` appears in the MM provider, typed handlers in the IP core table).
- **Closure state hides lifecycle.** `isReady`, `stagingSideColumn`, and `isDisposed` live
  in `resolveCustomTextEditor` closures — untestable without spinning up a full provider.

This is an **open/closed** failure in reverse: the system was extended by modification in
whichever file was nearest, three times.

## Design goals

1. One router class, instantiated per webview panel, used by both providers.
2. **Typed message contracts** — a discriminated union per editor, no `as any` at the
   boundary.
3. Cross-cutting concerns (ready-gating, command allow-list, logging, V-3 revision stamping)
   implemented once as router features, not re-implemented per provider.
4. Providers keep ownership of *what* the handlers do; the router owns *how* messages reach
   them. (Single responsibility: routing ≠ handling.)

## How

### Target design

```ts
// src/services/WebviewRouter.ts
export interface RouterOptions<M extends { type: string }> {
  webviewPanel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  logger: Logger;
  commandAllowlist?: ReadonlySet<string>;
  onReady: () => Promise<void>;          // initial push — router gates it
}

export class WebviewRouter<M extends { type: string }> {
  /** Register a typed handler; narrowed by the `type` discriminant. */
  on<T extends M['type']>(type: T, handler: (msg: Extract<M, { type: T }>) => Promise<void>): this;

  /** update/save/validate/openFile defaults — today's MessageHandler behavior. */
  useStandardDocumentHandlers(documentManager: DocumentManager, validator: YamlValidator): this;

  /** Push an update to the webview (single funnel — V-3 stamps revisions here). */
  postUpdate(payload: UpdatePayload): void;

  dispose(): void;                        // unsubscribes; replaces ad-hoc onDidDispose wiring
}
```

Key behaviors centralized in the router:

- **Ready gating.** Router queues `postUpdate` calls until the webview's `ready` arrives,
  then flushes the latest (exactly the MM provider's `isReady` logic, plus replacing the IP
  core provider's `setTimeout(100)` — this is where V-6 lands).
- **Command allow-list.** `on('command', …)` routes through the allow-list when configured;
  the list moves from `IpCoreEditorProvider` into the router config.
- **Disposal.** Router owns the `onDidReceiveMessage`/`onDidDispose` subscriptions; providers
  register cleanup via `router.dispose()`.

### Message type unions

```ts
// src/shared/messages/memoryMap.ts  (shared host↔webview, like syncProtocol.ts)
export type MmWebviewMessage =
  | { type: 'ready' }
  | { type: 'update'; text: string; editId?: number; baseDocVersion?: number }
  | { type: 'command'; command: 'save' | 'validate' }
  | { type: 'command'; command: 'openFile'; path: string };

// src/shared/messages/ipCore.ts — the ~20 IP core types, currently implicit in
// IpcMessage + ad-hoc casts inside each handler
```

Writing the IP core union is itself an audit: every `message.foo as string` cast in
`IpCoreEditorProvider` becomes an explicit field, and undocumented message shapes surface.

### What stays where

- `MessageHandler`'s logic becomes `useStandardDocumentHandlers` — the class dissolves.
- Provider-specific handlers (staging, file pickers, walkthroughs) stay in the providers,
  registered on the router. The providers shrink to: detect file type, build HTML, build
  router, register handlers, wire watchers.

## Tasks

1. **Write the message unions** (S). Pure types from reading both providers; no behavior
   change. Surfaces every implicit message field.
2. **Implement `WebviewRouter`** (M). Port ready-gating from the MM provider, allow-list from
   the IP core provider; unit tests with a mock panel (queue-until-ready, allow-list block,
   unknown-type warning, dispose).
3. **Migrate MM provider** (S). Smallest surface (3 message types + ready). Deletes the
   inline `ready` special case.
4. **Migrate IP core provider** (M). Mechanical table → `router.on(...)` conversion; the
   `stagingSideColumn` closure moves into the staging handler pair's own small class or
   remains closure state captured by the two handlers — acceptable, now scoped to staging
   only.
5. **Delete `MessageHandler`** (S). After both migrations; `sendUpdate` callers switch to
   `router.postUpdate`.

## Acceptance criteria

- One `onDidReceiveMessage` subscription per panel, created by the router.
- Zero `as any` / `as unknown as` casts on webview messages in providers.
- `WEBVIEW_COMMAND_ALLOWLIST` enforced for *both* editors (today the MM editor's `command`
  path has no allow-list — it only handles save/validate/openFile, but the gap closes).
- Existing e2e suite green; no webview-visible behavior change.

## Risks

- The IP core provider's handlers capture many locals (`document`, `webviewPanel`,
  `updateWebview`); migration must avoid accidentally re-binding stale references —
  mechanical, but review each handler.
- Don't over-engineer: no middleware stacks, no event-emitter generalization. The router is
  a typed switch with three features. Resist scope creep toward a "framework."
