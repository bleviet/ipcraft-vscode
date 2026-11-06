import type { SystemInstance, SystemPin } from '../../../../domain/systemGraph';
import {
  boundaryLayout,
  FRAME_MARGIN,
  framePadding,
  instanceLayout,
  middleEllipsis,
} from '../../../../webview/systemDiagram/layout/nodeSizing';
import { fakeMeasure } from './fixtureGraph';

// Row chrome: 9 + 9 px padding = 18 px beside the text at 7 px per character (markers sit on the border);
// the node border adds 2 px to the width and is not part of the columns.
const chars = (n: number) => 'x'.repeat(n);
const pin = (name: string): SystemPin => ({
  name,
  isInterface: false,
  direction: 'in',
  directionSource: 'connection',
  parameters: {},
});
const instance = (name: string): SystemInstance => ({ name }) as SystemInstance;
const layout = (west: string[], east: string[], name = 'u', subtitle = '') =>
  instanceLayout(
    instance(name),
    { west: west.map(pin), east: east.map(pin) },
    subtitle,
    fakeMeasure
  );

describe('hierarchy block width', () => {
  it('reserves room for the expand toggle beside the name', () => {
    const name = chars(30);
    const sides = { west: [], east: [] };
    const ip = instanceLayout(instance(name), sides, '', fakeMeasure);
    const hier = instanceLayout({ ...instance(name), kind: 'hier' }, sides, '', fakeMeasure);
    expect(hier.width).toBeGreaterThan(ip.width);
  });

  it('reserves exactly the expand toggle width, with no OPEN hint', () => {
    const name = chars(30);
    const hier = instanceLayout(
      { ...instance(name), kind: 'hier' },
      { west: [], east: [] },
      '',
      fakeMeasure
    );
    // name + padding + border + toggle and gap (22)
    expect(hier.width).toBe(30 * 7 + 16 + 2 + 22);
  });
});

describe('framePadding', () => {
  it('leaves room for the widest pin label of each side', () => {
    const padding = framePadding(
      { west: [pin(chars(10)), pin(chars(4))], east: [pin(chars(12))] },
      fakeMeasure
    );
    // 18 px of chrome beside the text, as in an instance pin row
    expect(padding).toEqual({ west: 18 + 70, east: 18 + 84 });
  });

  it('keeps a margin on a side without pins', () => {
    expect(framePadding({ west: [], east: [] }, fakeMeasure)).toEqual({
      west: FRAME_MARGIN,
      east: FRAME_MARGIN,
    });
  });
});

describe('middleEllipsis', () => {
  it('keeps text that fits', () => {
    expect(middleEllipsis('short', 100, fakeMeasure)).toBe('short');
  });

  it('keeps the start and the end around one ellipsis, 60/40', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = middleEllipsis(text, 11 * 7, fakeMeasure);
    expect(result).toHaveLength(11);
    const [start, end] = result.split('…');
    expect(start).toBe(text.slice(0, start.length));
    expect(end).toBe(text.slice(text.length - end.length));
    expect([start.length, end.length]).toEqual([6, 4]);
  });

  it('never drops below one character on either side', () => {
    expect(middleEllipsis('abcdefgh', 1, fakeMeasure)).toBe('a…h');
  });

  it('does not split surrogate pairs', () => {
    const text = '😀'.repeat(20);
    const result = middleEllipsis(text, 7 * 7, fakeMeasure);
    expect(result).toContain('…');
    expect(Array.from(result).every((char) => char === '…' || char === '😀')).toBe(true);
  });

  it('handles very long input', () => {
    const result = middleEllipsis(chars(100000), 200 * 7, fakeMeasure);
    expect(result).toHaveLength(200);
    expect(result).toContain('…');
  });
});

describe('instanceLayout', () => {
  it('gives a one-sided block the full width for its column', () => {
    const result = layout(['external_connection'], []);
    expect(result.westWidth).toBe(result.width - 2);
    expect(result.eastWidth).toBe(0);
    expect(result.labels.get('external_connection')).toBe('external_connection');
    const east = layout([], ['external_connection']);
    expect(east.eastWidth).toBe(east.width - 2);
    expect(east.westWidth).toBe(0);
  });

  it('keeps the natural west width and gives east the rest when both fit', () => {
    const result = layout([chars(5)], [chars(6)]);
    expect(result.width).toBe(180);
    expect(result.westWidth).toBe(18 + 35);
    expect(result.eastWidth).toBe(178 - result.westWidth);
    expect(result.labels.get(chars(5))).toBe(chars(5));
  });

  it('grows to the natural columns plus the gap', () => {
    const result = layout([chars(15)], [chars(15)]);
    expect(result.width).toBe(2 * (18 + 105) + 16 + 2);
    expect(result.westWidth).toBe(18 + 105);
  });

  it('lets the narrower side keep its natural width when it is at most half', () => {
    const result = layout([chars(5)], [chars(80)]);
    expect(result.width).toBe(420);
    expect(result.westWidth).toBe(18 + 35);
    expect(result.eastWidth).toBe(418 - result.westWidth);
    expect(result.labels.get(chars(80))).toContain('…');
  });

  it('splits in half when both sides are wide', () => {
    const result = layout([chars(60)], [chars(60)]);
    expect(result.width).toBe(420);
    expect(result.westWidth).toBe(209);
    expect(result.eastWidth).toBe(209);
  });

  it('clamps to the minimum and maximum width', () => {
    expect(layout([], []).width).toBe(180);
    expect(layout([chars(500)], []).width).toBe(420);
  });

  it('widens for a header or subtitle wider than the pins', () => {
    expect(layout([chars(2)], [], chars(30)).width).toBe(30 * 7 + 18);
    expect(layout([chars(2)], [], 'u', chars(32)).width).toBe(32 * 7 + 18);
  });
});

describe('boundaryLayout', () => {
  it('sizes to the name within the limits', () => {
    expect(boundaryLayout(pin('a'), fakeMeasure)).toEqual({ width: 100, label: 'a' });
    expect(boundaryLayout(pin(chars(20)), fakeMeasure)).toEqual({
      width: 24 + 140,
      label: chars(20),
    });
  });

  it('shortens names above the cap in the middle', () => {
    const result = boundaryLayout(pin(chars(80)), fakeMeasure);
    expect(result.width).toBe(320);
    expect(result.label).toContain('…');
    expect(result.label.length * 7).toBeLessThanOrEqual(320 - 24);
  });
});
