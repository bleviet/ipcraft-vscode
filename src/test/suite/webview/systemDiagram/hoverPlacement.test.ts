import { placeHoverCard } from '../../../../webview/systemDiagram/layout/hoverPlacement';

const viewport = { width: 1000, height: 600 };
const card = { width: 200, height: 80 };
const anchor = { left: 400, right: 500, top: 100, bottom: 118 };

describe('placeHoverCard', () => {
  it('opens right of an east pin and left of a west pin', () => {
    expect(placeHoverCard(anchor, 'east', card, viewport)).toEqual({ left: 508, top: 100 });
    expect(placeHoverCard(anchor, 'west', card, viewport)).toEqual({ left: 192, top: 100 });
  });

  it('flips when the preferred side leaves the viewport', () => {
    const edge = { ...anchor, left: 850, right: 950 };
    expect(placeHoverCard(edge, 'east', card, viewport).left).toBe(850 - 8 - 200);
    const start = { ...anchor, left: 50, right: 150 };
    expect(placeHoverCard(start, 'west', card, viewport).left).toBe(158);
  });

  it('clamps vertically inside the viewport', () => {
    expect(placeHoverCard({ ...anchor, top: 580 }, 'east', card, viewport).top).toBe(516);
  });
});
