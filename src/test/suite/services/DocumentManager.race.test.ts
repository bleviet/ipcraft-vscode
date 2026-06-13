/**
 * Regression test: concurrent updateDocument calls must not corrupt the document.
 *
 * The webview can send two 'update' messages in quick succession (e.g. a
 * structural edit followed by a layout repack). The provider dispatches them
 * fire-and-forget, so two updateDocument calls overlap. The replace range
 * must be computed against the document state at the time the edit is
 * actually applied — otherwise the second edit replaces only the extent of
 * the older (shorter) text and leaves a stale tail behind, corrupting the
 * YAML on disk.
 */
import * as vscode from 'vscode';
import { DocumentManager } from '../../../services/DocumentManager';

interface RecordedReplace {
  range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  text: string;
}

/** Minimal line-based TextDocument fake backed by a mutable string. */
function makeFakeDocument(initial: string) {
  const state = { text: initial };
  const lines = () => state.text.split('\n');
  const doc = {
    uri: { toString: () => 'file:///fake.mm.yml', fsPath: '/fake.mm.yml' },
    getText: () => state.text,
    get lineCount() {
      return lines().length;
    },
    lineAt: (n: number) => ({ lineNumber: n, text: lines()[n] ?? '' }),
    version: 1,
  };
  const applyReplace = (r: RecordedReplace) => {
    const ls = lines();
    let endOffset = 0;
    for (let i = 0; i < r.range.endLine; i++) {
      endOffset += ls[i].length + 1; // +1 for '\n'
    }
    endOffset += r.range.endCharacter;
    state.text = r.text + state.text.slice(endOffset);
  };
  return { doc: doc as unknown as vscode.TextDocument, applyReplace, state };
}

describe('DocumentManager concurrent updates', () => {
  it('applies overlapping updates sequentially without leaving stale tails', async () => {
    const initial = 'a: 1\nb: 2';
    const textA = 'a: 1\nb: 2\nc: 3\nd: 4'; // first edit grows the doc
    const textB = 'a: 1\nb: 2\nc: 3\nd: 4\ne: 5'; // second edit grows it further

    const { doc, applyReplace } = makeFakeDocument(initial);

    // Mimic VS Code: applyEdit resolves asynchronously, applying the edit
    // only after a macrotask — edits queued while another is in flight see
    // the pre-edit document if the caller computed its range too early.
    (vscode.workspace.applyEdit as jest.Mock).mockImplementation(
      async (edit: { replace: jest.Mock }) => {
        const [, range, text] = edit.replace.mock.calls[0];
        await new Promise((resolve) => setTimeout(resolve, 0));
        applyReplace({ range, text });
        return true;
      }
    );

    const dm = new DocumentManager();
    const p1 = dm.updateDocument(doc, textA);
    const p2 = dm.updateDocument(doc, textB);
    await Promise.all([p1, p2]);

    expect(doc.getText()).toBe(textB);
  });
});
