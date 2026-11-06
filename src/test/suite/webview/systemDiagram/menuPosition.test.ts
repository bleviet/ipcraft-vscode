import { clampMenuPosition } from '../../../../webview/systemDiagram/layout/menuPosition';

const menu = { width: 100, height: 60 };
const canvas = { width: 400, height: 300 };

describe('clampMenuPosition', () => {
  it('opens at the pointer when it fits', () => {
    expect(clampMenuPosition(50, 40, menu, canvas)).toEqual({ left: 50, top: 40 });
  });

  it('shifts the menu back inside at the right and bottom edges', () => {
    expect(clampMenuPosition(390, 295, menu, canvas)).toEqual({ left: 300, top: 240 });
  });

  it('never goes negative', () => {
    expect(clampMenuPosition(-5, -5, menu, { width: 50, height: 20 })).toEqual({ left: 0, top: 0 });
  });
});
