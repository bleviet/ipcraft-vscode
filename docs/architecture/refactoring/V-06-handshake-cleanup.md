# V-6 — Webview Handshake Cleanup

> Status: proposed · Severity: Low (hygiene; blocks V-3 testing) · Effort: S (½ day)
> Blocks: [V-3](V-03-revisioned-sync-protocol.md) · Subsumed by [V-5](V-05-unified-message-dispatch.md) task 2 if that lands first
> Source finding: [architecture.md §7 V-6](../architecture.md#v-6--handshake-belt-and-suspenders)

## Why

Two handshake implementations coexist, one correct and one papered-over:

**MM provider — correct** (`MemoryMapEditorProvider.resolveCustomTextEditor`):

```ts
let isReady = false;
const updateWebview = () => { if (!isReady) return; … };
// on message 'ready': isReady = true; updateWebview();
updateWebview();   // initial call is correctly gated
```

**IP core provider — belt and suspenders** (`IpCoreEditorProvider.resolveCustomTextEditor:188`):

```ts
this.registerWebviewMessageHandlers(document, webviewPanel, updateWebview);
// handler for 'ready' → updateWebview()        ← the handshake
setTimeout(() => { void updateWebview(); }, 100);   ← AND a blind timer
```

The `setTimeout(100)` is a leftover race fix. Problems it causes:

1. **Masks defects.** If the `ready` handshake ever breaks (bundle error, message renamed),
   the editor still *appears* to work whenever the webview boots within 100 ms — until it
   doesn't, on a slow machine, intermittently. Classic flake generator.
2. **Wasted/dropped work.** When the timer fires before the webview's message listener is
   installed, the posted update is silently dropped by the webview API; when it fires after
   `ready` already triggered a push, it duplicates a full import-resolution +
   file-existence-probe cycle (`updateWebview` in this provider does real I/O: five
   `fs.access`/`readdir` probes plus import resolution).
3. **Blocks V-3.** A push outside the handshake bypasses revision stamping and makes the
   sync harness nondeterministic.

There is also an asymmetry worth fixing while here: the MM provider's `isReady` gate never
*queues* — an update arriving before `ready` is dropped, relying on the `ready` handler to
trigger a fresh one. That works today because `ready` always pulls current state, but
"flush latest on ready" is the explicit contract V-5's router formalizes.

## Design goal

One handshake pattern, identical in both providers:

- Provider never pushes before `ready`.
- On `ready`, provider pushes current state exactly once.
- Document changes before `ready` do not queue a backlog — only the latest state matters
  (the push always sends full current text, so "flush latest" is free).

## How

Minimal diff version (if done before V-5):

```ts
// IpCoreEditorProvider.resolveCustomTextEditor
let isReady = false;
const updateWebview = async () => {
  if (!isReady || isDisposed) return;
  await this.updateWebview(document, webviewPanel, () => isDisposed);
};
// in messageHandlers:
ready: async () => { isReady = true; await updateWebview(); },
// DELETE: setTimeout(() => { void updateWebview(); }, 100);
```

The webview side already posts `ready` unconditionally on mount
(`index.tsx:59` for MM; verify the IP core app does the same on its mount path — it does,
via its message bootstrap). `retainContextWhenHidden: true` means the webview is not
re-created on tab switches, so `ready` firing once per panel lifetime is sufficient.

If V-5 lands first: this entire item is the router's queue-until-ready feature; just delete
the timer during migration.

## Tasks

1. **Confirm the IP core webview's `ready` emission path** (XS). Read
   `IpCoreApp.tsx`/its bootstrap; add a unit/browser test asserting `ready` is posted on
   mount (pin it so a future refactor can't silently break the handshake the timer used to
   mask).
2. **Gate + delete the timer** (S). Apply the sketch above. Manual verification matrix:
   fresh open, reopen after close, tab hide/show, VS Code reload with editor restored,
   slow-host simulation (add artificial delay in the webview bundle to prove the gate holds
   where the timer would have raced).
3. **Align the MM provider comment** (XS). Document the "drop early updates, ready pulls
   latest" contract where `isReady` is declared, so the next reader doesn't re-add a queue.

## Acceptance criteria

- No `setTimeout` in either `resolveCustomTextEditor`.
- e2e: editor opens and renders content on first open and on workbench reload (both already
  covered paths — they now exercise the handshake alone).
- Log shows exactly one initial update push per panel open.

## Risks

- If some environment exists where the webview never sends `ready` (CSP failure, bundle
  404), the editor now shows a blank panel instead of accidentally working. That is the
  correct behavior — fail visibly — but add a log line on resolve ("waiting for webview
  ready") so the failure is diagnosable from the output channel.
