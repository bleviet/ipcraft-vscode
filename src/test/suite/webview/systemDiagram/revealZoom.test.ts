import { revealZoom } from '../../../../webview/systemDiagram/layout/revealZoom';

describe('revealZoom', () => {
  it('never zooms out', () => {
    expect(revealZoom(1.7, 5)).toBe(1.7);
    expect(revealZoom(1.7, 0.3)).toBe(1.7);
  });

  it('zooms in to the readable level at most', () => {
    expect(revealZoom(0.2, 5)).toBe(0.8);
    expect(revealZoom(0.2, 5, 0.5)).toBe(0.5);
  });

  it('does not zoom past the zoom at which the node fits', () => {
    expect(revealZoom(0.2, 0.4)).toBe(0.4);
  });
});
