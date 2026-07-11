# V-4 — Debounced Push Data-Loss Window

> Status: **Implemented** (landed together with V-3) · Severity: High (silent data loss, low probability) · Effort: S (≤1 day, given V-3)
> Depends on: [V-3](V-03-revisioned-sync-protocol.md)
> Source finding: [architecture.md §7 V-4](../architecture.md#v-4--ip-core-debounced-full-text-push-can-drop-concurrent-external-edits)

## Why

`useIpCoreSync` (`src/webview/ipcore/hooks/useIpCoreSync.ts`) pushes the **entire** document
text 500 ms after any `rawYaml` change:

```ts
useEffect(() => {
  if (!rawYaml) return;
  const timeoutId = setTimeout(() => sendUpdate(rawYaml), 500);
  return () => clearTimeout(timeoutId);
}, [rawYaml, sendUpdate]);
```

Loss scenario:

```
t0    user edits on canvas → rawYaml = B (debounce timer starts)
t200  document changes externally (git checkout, format-on-save, raw text edit,
      generator fileSets write-back) → document = X
t250  host echoes X to webview → updateFromYaml(X) → rawYaml = X… 
      EXCEPT the canvas edit at t0 already diverged: whichever lands last in
      React state wins, and at t500 the timer fires with whatever rawYaml holds
t500  if rawYaml still = B: sendUpdate(B) → document = B. X is gone. Silently.
```

Three aggravating factors:

1. **Whole-file granularity** — the push doesn't carry "what changed", so the host cannot
   merge; it replaces.
2. **The extension itself writes to `.ip.yml`** — `updateFileSetsInYaml` and
   `updateScaffoldPackInYaml` run right after generation (`GenerateCommands.ts:704`),
   while the canvas is typically open. This is not just a git-race; it's a self-race.
3. **Silent** — no error, no dirty-conflict marker. The user discovers the loss in a diff,
   if ever.

The MM editor shares the whole-file write but pushes immediately, so its window is the
host round-trip (~ms) instead of 500 ms+.

Note the debounce exists for a reason: canvas drag interactions produce high-frequency
`updateIpCore` calls, and each push triggers a full host round-trip + echo. Removing the
debounce naively would regress interaction performance.

## Design goals

1. Close the window without giving up write coalescing.
2. Detect, never silently lose: when a conflicting external change is detected, the external
   (document) state wins and the user is told — the document is the SSOT.
3. Keep the mechanism in one place (`useIpCoreSync`), not spread through canvas code.

## How

Three measures, layered:

### 1. Version-guarded push (the fix; requires V-3)

The webview tracks `seenDocVersion` (from V-3 update messages). The debounced push carries
the version its edit was **based on**:

```ts
// webview → host
{ type: 'update', text, editId, baseDocVersion: seenDocVersion.current }
```

Host side, in `DocumentManager.updateDocument` (inside the existing per-URI queue, so the
check and the edit are atomic with respect to other webview edits):

```ts
if (baseDocVersion !== undefined && document.version !== baseDocVersion) {
  // Document moved under the webview → reject, let the echo resync the webview
  return { applied: false, reason: 'stale-base' };
}
```

On rejection the provider pushes the current document state (a normal update message); the
webview re-parses, and the user's still-pending canvas edit is re-applied by the UI layer or
— simpler and acceptable for v1 — surfaced as a toast: *"File changed on disk; canvas
reloaded."* Losing 500 ms of canvas tweaking with a visible notice beats silently losing an
external commit.

### 2. Flush on visibility loss (cheap hardening, no V-3 needed)

The 500 ms timer can also lose the *webview's own* edit: hide the tab (or close it) inside
the window and the cleanup clears the timer without sending. `retainContextWhenHidden`
makes this rare but real. Flush instead of drop:

```ts
useEffect(() => () => { /* on unmount/hide: */ sendUpdateRef.current(rawYamlRef.current); }, []);
document.addEventListener('visibilitychange', flushIfHidden);
```

### 3. Shrink the window (tuning)

With V-2's no-op-aware `applyPathEdits`, most single edits produce one push; drop the
debounce to ~150 ms or switch to leading-edge + trailing-edge ("send now, coalesce
follow-ups") so the common case has near-zero window and drags still coalesce.

## Tasks

1. **Characterize the race** (S). Integration test: open canvas state, simulate external
   `WorkspaceEdit`, fire a canvas edit within the window, assert current behavior loses the
   external edit. This test flips polarity when fixed.
2. **Flush-on-hide** (S). Measure 2 — independent, ship immediately.
3. **`baseDocVersion` guard** (M with V-3 in place, includes the reject-then-resync path and
   the toast). Extend `syncProtocol.ts`; implement the version check inside
   `DocumentManager`'s queue task (not before enqueueing — the queue is what makes it
   race-free).
4. **Debounce tuning** (S). Leading-edge send; verify canvas drag still coalesces (manual +
   message-count assertion in the harness).
5. **Apply the same guard to the MM editor** (S). Its window is small but nonzero; the
   protocol field is already there.

## Acceptance criteria

- The task-1 race test passes: external edit survives, user sees the resync notice.
- Closing/hiding the IP core tab within 500 ms of an edit does not lose the edit.
- Canvas drag of a bus interface produces ≤ a handful of update messages, not one per
  mousemove.

## Risks

- Reject-then-resync discards up to one debounce window of canvas edits. Mitigated by the
  toast and by the small window after task 4. A re-apply of pending edits on top of the new
  text is possible later (the edit is path-shaped after V-2) but is deliberately out of v1
  scope.
- `document.version` increments on every change including the webview's own queued edits;
  the FIFO/queue integration from V-3 task 3 must stamp `seenDocVersion` consistently or
  legitimate pushes get rejected. Covered by the V-3 harness.
