import { parseDocument } from 'yaml';
import { applyPathEdits, collectHexSpellings, serializeEdit } from '../../../yamledit';

function run(text: string, edit: (doc: ReturnType<typeof parseDocument>) => void): string {
  const doc = parseDocument(text);
  const hexFix = collectHexSpellings(doc);
  edit(doc);
  return serializeEdit(text, doc, hexFix);
}

describe('serializeEdit', () => {
  it('keeps original formatting of untouched nodes', () => {
    const text = 'a: 1\nlist: [X]\nmap: { k: v }\nb: 2\n';
    expect(run(text, (d) => d.setIn(['a'], 5))).toBe('a: 5\nlist: [X]\nmap: { k: v }\nb: 2\n');
  });

  it('takes the edited lines when an edit touches a reformatted line', () => {
    const text = 'list: [X]\nb: 2\n';
    const out = run(text, (d) => d.setIn(['list', 0], 'Y'));
    expect(out).toBe('list: [ Y ]\nb: 2\n');
  });

  it('is a plain serialisation when the text is already in yaml style', () => {
    const text = 'a: 1\nb:\n  - x\n';
    expect(run(text, (d) => d.setIn(['a'], 2))).toBe('a: 2\nb:\n  - x\n');
  });

  it('keeps data correct for a single-line flow document', () => {
    // A document that defeats line merging: the original is one flow line, the edit
    // replaces it; the guard must still yield data equal to the plain output.
    const text = '{ a: 1, b: [2] }\n';
    const doc = parseDocument(text);
    doc.setIn(['a'], 9);
    const out = serializeEdit(text, doc, new Map());
    expect(parseDocument(out).toJS()).toEqual({ a: 9, b: [2] });
  });
});

describe('serializeEdit CRLF and scale', () => {
  const crlf = 'a: 1\r\nb: [X]\r\nc: 3\r\n';

  it('keeps CRLF endings when appending a key', () => {
    expect(run(crlf, (d) => d.setIn(['d'], 4))).toBe('a: 1\r\nb: [X]\r\nc: 3\r\nd: 4\r\n');
  });

  it('keeps CRLF endings when prepending a key', () => {
    const out = run(crlf, (d) => {
      (d.contents as { items: unknown[] }).items.unshift(d.createPair('z', 0));
    });
    expect(out).toBe('z: 0\r\na: 1\r\nb: [X]\r\nc: 3\r\n');
  });

  it('preserves formatting on a large file within a time bound', () => {
    const entry = (i: number): string =>
      `  - name: r${i}\n    ports: [X]\n    description: >-\n      line one\n      line two\n`;
    const text = 'registers:\n' + Array.from({ length: 1200 }, (_, i) => entry(i)).join('');
    const start = Date.now();
    const out = run(text, (d) => d.setIn(['registers', 600, 'name'], 'changed'));
    expect(Date.now() - start).toBeLessThan(1000);
    expect(out).toBe(text.replace('name: r600\n', 'name: changed\n'));
  });
});

describe('serializeEdit input ends and long reformat regions', () => {
  it('does not throw when the reformatted line is the last line without a newline', () => {
    expect(applyPathEdits('a: [X]', [{ path: ['a'], value: 2 }])).toMatch(/^a: 2\n?$/);
  });

  it('keeps an unterminated last flow line', () => {
    const out = applyPathEdits('a: 1\nb: [X]', [{ path: ['a'], value: 2 }]);
    expect(out.startsWith('a: 2\nb: [X]')).toBe(true);
  });

  it('handles an unterminated folded scalar when adding a key', () => {
    const out = applyPathEdits('a: >-\n  x\n  y', [{ path: ['b'], value: 1 }]);
    expect(parseDocument(out).toJS()).toEqual({ a: 'x y', b: 1 });
  });

  it('keeps lines above a reformat region longer than the resync window', () => {
    const words = Array.from({ length: 70 }, (_, i) => `  word${i}`).join('\n');
    const text = `name: a\ndescription: >-\n${words}\nc: [X]\n`;
    const out = applyPathEdits(text, [{ path: ['name'], value: 'b' }]);
    expect(out.startsWith('name: b\ndescription: >-\n  word0\n  word1\n')).toBe(true);
    expect(parseDocument(out).toJS()).toEqual({
      name: 'b',
      description: Array.from({ length: 70 }, (_, i) => `word${i}`).join(' '),
      c: ['X'],
    });
  });
});
