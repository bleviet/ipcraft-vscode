import { extendRouteEnds } from '../../../../webview/systemDiagram/layout/edgePoints';

describe('extendRouteEnds', () => {
  it('pushes both ends along their last segments', () => {
    expect(
      extendRouteEnds(
        [
          { x: 104, y: 10 },
          { x: 150, y: 10 },
          { x: 150, y: 40 },
          { x: 196, y: 40 },
        ],
        4
      )
    ).toEqual([
      { x: 100, y: 10 },
      { x: 150, y: 10 },
      { x: 150, y: 40 },
      { x: 200, y: 40 },
    ]);
  });

  it('keeps degenerate routes', () => {
    expect(extendRouteEnds([{ x: 1, y: 1 }], 4)).toEqual([{ x: 1, y: 1 }]);
    expect(
      extendRouteEnds(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        4
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});
