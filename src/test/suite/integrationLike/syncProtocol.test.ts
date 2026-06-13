/**
 * Integration harness for the revisioned sync protocol (V-3 / V-4 / V-5).
 *
 * Wires the REAL host-side `WebviewRouter` + `DocumentManager` to the REAL
 * webview-side `revisionFilter` decision logic, against an in-memory document
 * whose `applyEdit` mutates the text, bumps the version, and fires a change
 * event (the same chain a custom editor sees). This catches contract mismatches
 * between the two sides — field spellings (`docVersion`, `sourceEditId`,
 * `baseDocVersion`, `forceResync`), FIFO pairing, and the stale-base reject →
 * force-resync path — that per-side unit tests cannot.
 *
 * The wiring mirrors the Memory Map provider: every document change is routed
 * through `router.handleDocumentChange`.
 */
import * as vscode from 'vscode';
import { WebviewRouter } from '../../../services/WebviewRouter';
import { DocumentManager } from '../../../services/DocumentManager';
import { YamlValidator } from '../../../services/YamlValidator';
import { Logger } from '../../../utils/Logger';
import {
  createRevisionState,
  shouldApplyUpdate,
  buildUpdateMessage,
} from '../../../webview/sync/revisionFilter';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createHarness(initial: string) {
  const state = { text: initial, version: 1 };
  const changeListeners: Array<(e: vscode.TextDocumentChangeEvent) => void> = [];
  const lines = () => state.text.split('\n');

  const doc = {
    uri: { fsPath: '/fake.mm.yml', toString: () => 'file:///fake.mm.yml' },
    getText: () => state.text,
    get version() {
      return state.version;
    },
    get lineCount() {
      return lines().length;
    },
    lineAt: (n: number) => ({ lineNumber: n, text: lines()[n] ?? '' }),
  } as unknown as vscode.TextDocument;

  // Replace the whole document, bump the version, and fire the change event —
  // the observable effect of any edit a custom editor sees.
  const applyFullText = (text: string) => {
    state.text = text;
    state.version += 1;
    changeListeners.forEach((l) => l({ document: doc } as vscode.TextDocumentChangeEvent));
  };

  // applyEdit replays the WorkspaceEdit's recorded full-text replace.
  (vscode.workspace.applyEdit as jest.Mock).mockImplementation(
    async (edit: { replace: jest.Mock }) => {
      const calls = edit.replace.mock.calls;
      const text = calls[calls.length - 1][2] as string;
      await Promise.resolve();
      applyFullText(text);
      return true;
    }
  );

  // ---- webview side (real decision logic) ----
  const revision = createRevisionState();
  let renderedText: string | null = null;
  let applyCount = 0;

  let toHost: (message: unknown) => Promise<void> | void = async () => {};

  const webviewPanel = {
    webview: {
      onDidReceiveMessage: (listener: (message: unknown) => Promise<void> | void) => {
        toHost = listener;
        return { dispose: jest.fn() };
      },
      postMessage: (msg: {
        type?: string;
        text?: string;
        docVersion?: number;
        sourceEditId?: number;
        forceResync?: boolean;
      }) => {
        if (msg.type === 'update') {
          if (shouldApplyUpdate(revision, msg)) {
            applyCount += 1;
            if (typeof msg.text === 'string') {
              renderedText = msg.text;
            }
          }
        }
        return Promise.resolve(true);
      },
    },
    onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
  };

  const router = new WebviewRouter({
    webviewPanel: webviewPanel as unknown as vscode.WebviewPanel,
    document: doc,
    logger: new Logger('SyncIT'),
    onReady: () => {
      router.postUpdate({ text: doc.getText(), fileName: 'fake.mm.yml' });
    },
  });
  router.useStandardDocumentHandlers(new DocumentManager(), new YamlValidator());

  // Memory Map wiring: every document change is echoed through the router.
  changeListeners.push((e) => router.handleDocumentChange(e));

  return {
    doc,
    state,
    router,
    get rendered() {
      return renderedText;
    },
    get applyCount() {
      return applyCount;
    },
    get seenDocVersion() {
      return revision.seenDocVersion;
    },
    /** Webview handshake → initial document push. */
    ready: () => toHost({ type: 'ready' }),
    /** Webview edits via the real outbound builder (omits baseDocVersion until a version is seen). */
    webviewEdit: (text: string) => toHost(buildUpdateMessage(revision, text)),
    /** Webview sends a hand-crafted message (to model a stale-base race deterministically). */
    sendRaw: (message: Record<string, unknown>) => toHost(message),
    /** External edit (raw text editor, git, generator write-back) — bypasses the webview. */
    externalEdit: (text: string) => applyFullText(text),
  };
}

describe('sync protocol (host router + webview filter)', () => {
  it('suppresses the echo of the webview own edit (no self re-parse)', async () => {
    const h = createHarness('a: 1');
    await h.ready(); // initial push: text 'a: 1', docVersion 1

    expect(h.rendered).toBe('a: 1');
    const appliesAfterReady = h.applyCount;

    await h.webviewEdit('a: 1\nb: 2');
    await flush();

    // The host applied the edit and echoed it back tagged with our editId; the
    // webview must NOT re-apply that echo (it already holds the state).
    expect(h.doc.getText()).toBe('a: 1\nb: 2');
    expect(h.applyCount).toBe(appliesAfterReady); // no extra apply from the echo
    expect(h.seenDocVersion).toBe(2); // but version bookkeeping advanced
  });

  it('applies an external edit made while the webview is open', async () => {
    const h = createHarness('a: 1');
    await h.ready();

    h.externalEdit('x: 9'); // raw editor / git changes the file
    await flush();

    expect(h.rendered).toBe('x: 9');
    expect(h.seenDocVersion).toBe(2);
  });

  it('rejects a stale-base edit, preserves disk content, and force-resyncs the webview (V-4 #3)', async () => {
    const h = createHarness('a: 1');
    await h.ready(); // seen = 1

    // An external edit lands; the webview sees it and advances to version 2.
    h.externalEdit('x: 9');
    await flush();
    expect(h.seenDocVersion).toBe(2);
    const appliesBeforeConflict = h.applyCount;

    // A webview edit based on the now-stale version 1 races in (e.g. a debounced
    // canvas push that started before the external edit was observed).
    await h.sendRaw({ type: 'update', text: 'stale: 1', editId: 99, baseDocVersion: 1 });
    await flush();

    // Data safety: the stale edit must NOT overwrite the external change on disk.
    expect(h.doc.getText()).toBe('x: 9');
    // The user is told.
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    // The resync reaches the webview even though its docVersion (2) is <= seen (2):
    // forceResync overrides, so applyCount increases and the canvas shows disk truth.
    expect(h.applyCount).toBe(appliesBeforeConflict + 1);
    expect(h.rendered).toBe('x: 9');
  });

  it('does not reject the first edit sent before any host update (fix #4)', async () => {
    const h = createHarness('a: 1');
    // No ready()/initial push: the webview has not seen a version yet.

    await h.webviewEdit('first: 1'); // buildUpdateMessage omits baseDocVersion
    await flush();

    expect(h.doc.getText()).toBe('first: 1');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
