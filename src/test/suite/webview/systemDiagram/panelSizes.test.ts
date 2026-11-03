import {
  clampSize,
  DEFAULT_PANEL_SIZES,
  keyboardDelta,
  KEY_STEP,
  limitsFor,
  sizeFromPointer,
} from '../../../../webview/systemDiagram/layout/panelSizes';

describe('panelSizes', () => {
  it('uses the existing layout as defaults', () => {
    expect(DEFAULT_PANEL_SIZES).toEqual({ left: 260, right: 320, bottom: 200 });
  });

  it('limits side panels to 160-600 and the bottom panel to 80 px - 70 % of the height', () => {
    expect(limitsFor('left', 1000)).toEqual({ min: 160, max: 600 });
    expect(limitsFor('right', 10)).toEqual({ min: 160, max: 600 });
    expect(limitsFor('bottom', 800)).toEqual({ min: 80, max: 560 });
    expect(limitsFor('bottom', 0)).toEqual({ min: 80, max: 80 });
  });

  it('clamps sizes into the limits', () => {
    const limits = limitsFor('left', 0);
    expect(clampSize(10, limits)).toBe(160);
    expect(clampSize(300, limits)).toBe(300);
    expect(clampSize(9000, limits)).toBe(600);
  });

  it('derives the size from the pointer for each docked edge', () => {
    const rect = { left: 100, right: 1100, bottom: 900 };
    expect(sizeFromPointer('left', { x: 400, y: 0 }, rect)).toBe(300);
    expect(sizeFromPointer('right', { x: 800, y: 0 }, rect)).toBe(300);
    expect(sizeFromPointer('bottom', { x: 0, y: 700 }, rect)).toBe(200);
  });

  it('maps arrow keys to 16 px steps that grow toward the canvas', () => {
    expect(KEY_STEP).toBe(16);
    expect(keyboardDelta('left', 'ArrowRight')).toBe(16);
    expect(keyboardDelta('left', 'ArrowLeft')).toBe(-16);
    expect(keyboardDelta('right', 'ArrowLeft')).toBe(16);
    expect(keyboardDelta('right', 'ArrowRight')).toBe(-16);
    expect(keyboardDelta('bottom', 'ArrowUp')).toBe(16);
    expect(keyboardDelta('bottom', 'ArrowDown')).toBe(-16);
    expect(keyboardDelta('bottom', 'ArrowLeft')).toBe(0);
    expect(keyboardDelta('left', 'Enter')).toBe(0);
  });
});
