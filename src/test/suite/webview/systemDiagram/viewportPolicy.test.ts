import {
  decideViewportAction,
  withSavedViewport,
  type Viewport,
} from '../../../../webview/systemDiagram/layout/viewportPolicy';

const root: Viewport = { x: 10, y: 20, zoom: 2 };

describe('decideViewportAction', () => {
  it('fits the first layout ever shown', () => {
    expect(decideViewportAction(null, '/', new Map())).toEqual({ kind: 'fit' });
  });

  it('fits the first visit to a different level', () => {
    expect(decideViewportAction('/', '/dsp', new Map([['/', root]]))).toEqual({ kind: 'fit' });
  });

  it('restores the saved viewport when returning to a level', () => {
    expect(decideViewportAction('/dsp', '/', new Map([['/', root]]))).toEqual({
      kind: 'restore',
      viewport: root,
    });
  });

  it('keeps the viewport for a new layout of the same level, even if one is saved', () => {
    expect(decideViewportAction('/', '/', new Map())).toEqual({ kind: 'keep' });
    expect(decideViewportAction('/', '/', new Map([['/', root]]))).toEqual({ kind: 'keep' });
  });
});

describe('withSavedViewport', () => {
  it('records the viewport of the level that stopped being shown, without mutating', () => {
    const before = new Map([['/', root]]);
    const after = withSavedViewport(before, '/dsp', { x: 1, y: 2, zoom: 3 });
    expect(after.get('/dsp')).toEqual({ x: 1, y: 2, zoom: 3 });
    expect(after.get('/')).toEqual(root);
    expect(before.has('/dsp')).toBe(false);
  });

  it('overwrites an earlier saved viewport of the same level', () => {
    const after = withSavedViewport(new Map([['/', root]]), '/', { x: 0, y: 0, zoom: 9 });
    expect(after.get('/')).toEqual({ x: 0, y: 0, zoom: 9 });
  });

  it('changes nothing when no level was shown', () => {
    const saved = new Map([['/', root]]);
    expect(withSavedViewport(saved, null, { x: 0, y: 0, zoom: 1 })).toBe(saved);
  });

  it('lets a recovered layout restore the saved view instead of keeping the reset one', () => {
    const saved = withSavedViewport(new Map(), '/', root);
    expect(decideViewportAction(null, '/', saved)).toEqual({ kind: 'restore', viewport: root });
  });
});
