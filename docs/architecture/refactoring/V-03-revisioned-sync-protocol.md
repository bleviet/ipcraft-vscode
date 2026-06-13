# V-3 — Revisioned Sync Protocol

> Status: proposed · Severity: High (correctness) · Effort: M (2–4 days)
> Depends on: [V-6](V-06-handshake-cleanup.md) · Enables: [V-4](V-04-debounce-data-loss.md) · Best landed after [V-5](V-05-unified-message-dispatch.md)
> Source finding: [architecture.md §7 V-3](../architecture.md#v-3--echo-loop-is-convention-not-contract)

## Why

The webview↔host sync loop works like this (see [architecture.md §4.1](../architecture.md#41-the-authoritative-loop)):

1. Webview edits → optimistically updates local state → posts full text to host.
2. Host applies a `WorkspaceEdit` → `onDidChangeTextDocument` fires → host **echoes the full
   text back** to the webview.
3. Webview re-parses the echo.

Nothing identifies *which* edit an echo corresponds to. Correctness currently rests on three
**conventions**:

- `DocumentManager.performUpdate` skips the edit when text is already equal (breaks infinite
  loops).
- Webview callers compare `applyPathEdits` output by identity before sending (suppresses
  no-ops).
- Cell components keep keystrokes in **draft maps** so an echo re-render doesn't clobber
  in-progress typing.

The failure mode the conventions don't cover: **a stale echo arriving after a newer local
edit**. Timeline:

```
t0  webview state = A, user edits → B, send B, optimistic state = B
t1  user edits again → C, send C, optimistic state = C
t2  echo(B) arrives → webview re-parses B → UI flashes/reverts to B
t3  echo(C) arrives → UI back to C
```

That t2→t3 flicker is precisely the bug class fixed repeatedly in recent history
(stale `nameDrafts` flash on Enter, blur/Enter commit glitches — commits `c75b246`,
`5e999d7`, `2fdd646`, `dfb66da`). Each fix patched a symptom at the component level
(draft maps, cleanup effects). The disease is the unversioned protocol. The IP core
editor's 500 ms debounce widens the same window (see V-4).

There is also a comment in `src/webview/index.tsx` (~line 183) admitting the deeper variant:
two back-to-back updates "can corrupt the file when the second edit races the first one in
the extension host" — worked around by collapsing structural edits into single updates.

## Design goals

1. **Make echo identity explicit.** Every update carries a revision; receivers can decide
   "is this newer than what I have?" instead of guessing.
2. **Don't replace the architecture.** Full-text push with last-writer-wins stays — it is
   simple and adequate. We are adding *ordering metadata*, not OT/CRDT.
3. **Self-echo suppression as the primary win:** a webview should never re-render from an
   echo of its own edit; it already has that state.

## How

### Protocol change

```ts
// webview → host
{ type: 'update', text: string, editId: number }      // editId: per-webview monotonic counter

// host → webview
{ type: 'update', text: string, sourceEditId?: number, docVersion: number }
//   sourceEditId: present when this update is the echo of that webview edit
//   docVersion:   vscode TextDocument.version after the change
```

### Host side

`DocumentManager.updateDocument` returns through the existing per-URI promise queue; the
provider records `editId → applied` and stamps the next `onDidChangeTextDocument`-triggered
push with `sourceEditId`. Since the queue serializes edits per document, mapping the change
event to the in-flight `editId` is a simple FIFO pairing:

```ts
// provider (sketch)
const pendingEchoes: number[] = [];
onMessage('update', (m) => {
  pendingEchoes.push(m.editId);
  void documentManager.updateDocument(document, m.text);
});
onDidChangeTextDocument(() => {
  const sourceEditId = pendingEchoes.shift();      // undefined → external edit
  postUpdate({ text, sourceEditId, docVersion: document.version });
});
```

Caveat: `applyEdit` can fail or be a no-op (text identical) — in those cases no change event
fires and the FIFO would desync. `updateDocument` already returns `boolean` and detects
no-ops; pop the FIFO entry on those paths too.

### Webview side

```ts
// useYamlSync (sketch)
const lastSentEditId = useRef(0);
const seenDocVersion = useRef(-1);

function onHostUpdate(msg) {
  if (msg.docVersion <= seenDocVersion.current) return;       // stale echo — drop
  seenDocVersion.current = msg.docVersion;
  if (msg.sourceEditId === lastSentEditId.current) return;    // own latest edit — state already correct
  onUpdate(msg.text);                                         // external/older-origin change — re-parse
}
```

Two rules, two distinct protections:

- `docVersion` ordering drops out-of-order echoes (the t2 flicker above).
- `sourceEditId === lastSent` skips redundant re-parse of our own latest edit — this is what
  makes component-level draft juggling mostly unnecessary.

Echoes of our own *older* edits (sourceEditId < lastSent) are also dropped by the
docVersion rule, because our newer edit produced a higher version. External edits (no
`sourceEditId`) always apply.

### What this does NOT do

- No merge of concurrent external + webview edits — still last-writer-wins (V-4 narrows the
  window; true merging is out of scope and not worth the complexity here).
- Draft maps stay (they solve "typing while ANY re-render happens", including parse-error
  states), but their cleanup heuristics stop being load-bearing for correctness.

## Tasks

1. **Land V-6 first** (prereq). The `setTimeout(100)` blind push in `IpCoreEditorProvider`
   would bypass version stamping and confuse testing.
2. **Type the protocol** (S). `src/shared/syncProtocol.ts` with the message interfaces above,
   imported by both host and webviews (the host/webview shared-types precedent exists:
   `GenerateOptionsMessage`).
3. **Host stamping** (M). Implement FIFO pairing in a small `RevisionTracker` class used by
   both providers (natural home: the V-5 unified router; without V-5, instantiate per
   provider). Unit-test the desync caveats: failed `applyEdit`, no-op edit, external edit
   interleaved between webview edits.
4. **Webview filtering** (S). Implement the two-rule receiver in `useYamlSync` (MM) and the
   IP core message listener. Feature-flag fallback: if `docVersion` is absent (old host,
   stale webview bundle), behave as today.
5. **Integration tests** (M). Simulated host+webview harness (the e2e suite under
   `src/test/e2e/` has the plumbing): rapid double edit asserts no intermediate re-render
   with stale text; external edit during webview editing asserts it is applied.
6. **Retire defensive code** (S, separate PR, after soak). Remove echo-driven workarounds
   that exist only for the stale-echo case — candidates flagged in code review, each removal
   individually revertable.

## Acceptance criteria

- Typing rapidly across two fields and pressing Enter never renders earlier text (manual
  repro from the recent bug reports + automated harness test).
- Webview log shows zero self-echo re-parses during a normal editing session.
- External edit (raw text editor side-by-side) still propagates to the webview within one
  change event.

## Risks

- FIFO desync would silently mislabel echoes — mitigated by the no-op/failure handling in
  task 3 and by the `docVersion` rule acting as an independent backstop.
- `retainContextWhenHidden` means long-lived webviews; counters must not reset on tab
  switches (refs persist — verify with a hide/show test).

## Known limitation (as implemented)

The FIFO pairing in task 3 is **arrival-ordered**, not edit-identity-ordered, and there is no
reliable point to pair a change event to the edit that caused it: `onDidChangeTextDocument`
fires *before* `vscode.workspace.applyEdit` resolves, so the host cannot record
"editId E produced version V" in time to match the event.

Consequence — a narrow interleave: if an **external** edit lands after a webview edit has been
sent (its `editId` is already on the FIFO) but before that edit's `applyEdit` runs, the
external change event pops the FIFO and is stamped with the webview's `editId`. The webview
then treats the external change as an echo of its own edit and drops it; the subsequent
stale-base rejection resync would also look stale because `seenDocVersion` has advanced.

This is **mitigated, not eliminated**:

- **Data is safe regardless.** The `baseDocVersion` guard (V-4) rejects the stale webview edit
  inside `DocumentManager`'s per-URI queue, so the external change is never overwritten on disk.
- **The view is corrected.** The stale-base rejection resync carries `forceResync: true`
  (see `WebviewRouter.useStandardDocumentHandlers` → `shouldApplyUpdate`), which bypasses the
  `docVersion`/`sourceEditId` suppression so the webview re-parses the document (the SSOT)
  even after the transient mislabel. Covered by
  `src/test/suite/integrationLike/syncProtocol.test.ts` ("stale-base … force-resyncs").

Eliminating the transient (so the external change is shown on the *first* event rather than the
follow-up resync) would require identity-paired echoes — e.g. matching change events to
`editId → resulting version` once that ordering is obtainable, or moving off arrival-ordered
FIFO entirely. Deliberately out of scope: last-writer-wins with detect-and-resync is adequate,
and the transient is sub-frame.
