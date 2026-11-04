import {
  decideViewportAction,
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
