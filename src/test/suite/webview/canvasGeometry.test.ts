import {
  CANVAS_ZOOM_MIN,
  CANVAS_ZOOM_MAX,
  nextZoomForWheel,
  panAfterWheel,
  panAfterDrag,
  manhattanExceeds,
  euclideanExceeds,
  computeMarqueeRect,
  rectIntersectsMarquee,
  dropHalfSide,
  isCanvasBackground,
} from '../../../webview/ipcore/components/canvas/canvasGeometry';

describe('nextZoomForWheel', () => {
  it('zooms in on negative deltaY', () => {
    expect(nextZoomForWheel(1.0, -100)).toBeCloseTo(1.1);
  });

  it('zooms out on positive deltaY', () => {
    expect(nextZoomForWheel(1.0, 100)).toBeCloseTo(0.9);
  });

  it('clamps to CANVAS_ZOOM_MAX', () => {
    expect(nextZoomForWheel(CANVAS_ZOOM_MAX, -100)).toBe(CANVAS_ZOOM_MAX);
  });

  it('clamps to CANVAS_ZOOM_MIN', () => {
    expect(nextZoomForWheel(CANVAS_ZOOM_MIN, 100)).toBe(CANVAS_ZOOM_MIN);
  });

  it('rounds to 2 decimal places', () => {
    const result = nextZoomForWheel(0.333, -100);
    expect(result).toBe(Math.round(result * 100) / 100);
  });
});

describe('panAfterWheel', () => {
  it('subtracts wheel deltas from the current pan', () => {
    expect(panAfterWheel({ x: 10, y: 20 }, 5, -3)).toEqual({ x: 5, y: 23 });
  });
});

describe('panAfterDrag', () => {
  it('offsets the pan-at-drag-start by the mouse delta', () => {
    const result = panAfterDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 130, y: 90 });
    expect(result).toEqual({ x: 30, y: -10 });
  });
});

describe('manhattanExceeds', () => {
  it('is false at or below the threshold', () => {
    expect(manhattanExceeds(2, 2, 4)).toBe(false);
  });

  it('is true above the threshold', () => {
    expect(manhattanExceeds(3, 2, 4)).toBe(true);
  });
});

describe('euclideanExceeds', () => {
  it('is false at or below the threshold', () => {
    expect(euclideanExceeds(3, 4, 5)).toBe(false);
  });

  it('is true above the threshold', () => {
    expect(euclideanExceeds(4, 4, 5)).toBe(true);
  });
});

describe('computeMarqueeRect', () => {
  it('normalizes start/end into a top-left/width/height box, relative to the container', () => {
    const rect = computeMarqueeRect(
      { startX: 150, startY: 220, endX: 90, endY: 260 },
      { left: 50, top: 100 }
    );
    expect(rect).toEqual({ left: 40, top: 120, width: 60, height: 40 });
  });
});

describe('rectIntersectsMarquee', () => {
  const drag = { startX: 0, startY: 0, endX: 100, endY: 100 };

  it('is true when the rect overlaps the marquee box', () => {
    expect(rectIntersectsMarquee({ left: 50, top: 50, right: 150, bottom: 150 }, drag)).toBe(true);
  });

  it('is false when the rect is fully outside the marquee box', () => {
    expect(rectIntersectsMarquee({ left: 200, top: 200, right: 250, bottom: 250 }, drag)).toBe(
      false
    );
  });

  it('is false when the rect only touches the boundary (strict inequality)', () => {
    expect(rectIntersectsMarquee({ left: 100, top: 0, right: 150, bottom: 50 }, drag)).toBe(false);
  });

  it('handles a marquee dragged in reverse (end before start)', () => {
    const reversed = { startX: 100, startY: 100, endX: 0, endY: 0 };
    expect(rectIntersectsMarquee({ left: 50, top: 50, right: 150, bottom: 150 }, reversed)).toBe(
      true
    );
  });
});

describe('dropHalfSide', () => {
  const rect = { left: 100, width: 200 };

  it('returns left for the left half', () => {
    expect(dropHalfSide(150, rect)).toBe('left');
  });

  it('returns right for the right half', () => {
    expect(dropHalfSide(250, rect)).toBe('right');
  });

  it('returns right exactly at the midpoint', () => {
    expect(dropHalfSide(200, rect)).toBe('right');
  });
});

describe('isCanvasBackground', () => {
  it('is false for null', () => {
    expect(isCanvasBackground(null)).toBe(false);
  });

  it('is true for an element with the background class', () => {
    const el = document.createElement('div');
    el.classList.add('ip-canvas-background');
    expect(isCanvasBackground(el)).toBe(true);
  });

  it('is true for an svg element', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(isCanvasBackground(el)).toBe(true);
  });

  it('is false for an unrelated element', () => {
    const el = document.createElement('div');
    expect(isCanvasBackground(el)).toBe(false);
  });
});
