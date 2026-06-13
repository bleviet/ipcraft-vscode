/**
 * Webview-side rules for the revisioned sync protocol (V-3 / V-4).
 *
 * Both editor webviews (`useYamlSync` for the memory map, `useIpCoreSync` for the
 * IP core) apply the same receive/send rules. They live here as pure functions so
 * the protocol can be unit-tested directly, and so an integration harness can
 * exercise the real logic instead of a hand-copied duplicate that could drift.
 */

/** Mutable per-webview revision bookkeeping. */
export interface RevisionState {
  /** Highest editId this webview has sent (monotonic counter). */
  lastSentEditId: number;
  /** Highest docVersion this webview has seen from the host (-1 = none yet). */
  seenDocVersion: number;
}

/** The revision-relevant fields of a host→webview `update` message. */
export interface IncomingUpdate {
  docVersion?: number;
  sourceEditId?: number;
  forceResync?: boolean;
}

/** Fresh state for a newly mounted webview. `seenDocVersion` starts at the -1 sentinel. */
export function createRevisionState(): RevisionState {
  return { lastSentEditId: 0, seenDocVersion: -1 };
}

/**
 * Decide whether a host→webview `update` should be applied (re-parsed) by the
 * webview, advancing `state.seenDocVersion` as a side effect.
 *
 * - `forceResync` always applies: the host rejected a stale-base edit, so the
 *   document (the SSOT) must win even past our version/echo bookkeeping. A
 *   concurrent external edit can be mislabeled as an echo of the rejected edit
 *   and the version it bumped can make this resync look stale — forcing avoids
 *   both traps.
 * - An update at or below the version we've already seen is a stale/out-of-order
 *   echo and is dropped.
 * - An echo of our own latest edit is dropped (we already hold that state).
 */
export function shouldApplyUpdate(state: RevisionState, update: IncomingUpdate): boolean {
  const { docVersion, sourceEditId, forceResync } = update;

  if (forceResync) {
    if (docVersion !== undefined) {
      state.seenDocVersion = docVersion;
    }
    return true;
  }

  if (docVersion !== undefined) {
    if (docVersion <= state.seenDocVersion) {
      return false;
    }
    state.seenDocVersion = docVersion;
  }

  // Drop echoes of any edit we sent, not just the latest. An older in-flight
  // echo (sourceEditId < lastSentEditId) would otherwise pass and revert the
  // canvas to a superseded state.
  if (sourceEditId !== undefined && sourceEditId > 0 && sourceEditId <= state.lastSentEditId) {
    return false;
  }

  return true;
}

/**
 * Build a webview→host `update` payload for `text`, advancing `lastSentEditId`.
 *
 * `baseDocVersion` is omitted until the webview has seen a real version: before
 * the first host update `seenDocVersion` is the -1 sentinel, and sending that as
 * a base version would make the host reject the edit as stale-base (its version
 * can never be -1) and surface a spurious "file changed on disk" warning.
 */
export function buildUpdateMessage(state: RevisionState, text: string): Record<string, unknown> {
  state.lastSentEditId += 1;
  const message: Record<string, unknown> = {
    type: 'update',
    text,
    editId: state.lastSentEditId,
  };
  if (state.seenDocVersion >= 0) {
    message.baseDocVersion = state.seenDocVersion;
  }
  return message;
}
