import { reuseUnchanged } from '../../../../webview/systemDiagram/stableElements';

interface El {
  id: string;
  selected?: boolean;
  data?: Record<string, unknown>;
}

describe('reuseUnchanged', () => {
  it('returns the previous array itself when every element is unchanged', () => {
    const previous: El[] = [
      { id: 'a', selected: false, data: { dimmed: false } },
      { id: 'b', data: { n: 1 } },
    ];
    const next: El[] = [
      { id: 'a', selected: false, data: { dimmed: false } },
      { id: 'b', data: { n: 1 } },
    ];
    expect(reuseUnchanged(previous, next)).toBe(previous);
  });

  it('keeps the previous object for unchanged elements and takes the new one otherwise', () => {
    const previous: El[] = [
      { id: 'a', data: { dimmed: false } },
      { id: 'b', data: { dimmed: false } },
    ];
    const next: El[] = [
      { id: 'a', data: { dimmed: false } },
      { id: 'b', data: { dimmed: true } },
    ];
    const result = reuseUnchanged(previous, next);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
  });

  it('sees a changed top-level property, an added data key and a new object value', () => {
    const set = new Set(['x']);
    const previous: El[] = [
      { id: 'a', selected: false, data: { set } },
      { id: 'b', data: {} },
      { id: 'c', data: { set } },
    ];
    const next: El[] = [
      { id: 'a', selected: true, data: { set } },
      { id: 'b', data: { extra: 1 } },
      { id: 'c', data: { set: new Set(['x']) } },
    ];
    const result = reuseUnchanged(previous, next);
    expect(result).toEqual(next);
    expect(result[0]).not.toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
    expect(result[2]).toBe(next[2]);
  });

  it('keeps the previous data object when only the element around it changed', () => {
    const previous: El[] = [{ id: 'a', selected: false, data: { n: 1 } }];
    const result = reuseUnchanged(previous, [{ id: 'a', selected: true, data: { n: 1 } }]);
    expect(result[0]).toEqual({ id: 'a', selected: true, data: { n: 1 } });
    expect(result[0]).not.toBe(previous[0]);
    expect(result[0].data).toBe(previous[0].data);
  });

  it('handles added, removed and reordered elements', () => {
    const a: El = { id: 'a', data: { n: 1 } };
    const b: El = { id: 'b', data: { n: 2 } };
    const result = reuseUnchanged([a, b], [{ id: 'b', data: { n: 2 } }, { id: 'c' }]);
    expect(result[0]).toBe(b);
    expect(result).toHaveLength(2);
    expect(
      reuseUnchanged(
        [a, b],
        [
          { id: 'b', data: { n: 2 } },
          { id: 'a', data: { n: 1 } },
        ]
      )
    ).toEqual([b, a]);
    expect(reuseUnchanged([a], [])).toEqual([]);
  });
});
