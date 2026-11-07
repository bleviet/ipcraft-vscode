import { FAR_ZOOM, isFar, nameScale } from '../../../../webview/systemDiagram/layout/zoomDetail';

describe('Auto detail thresholds', () => {
  it('is far strictly below 0.42', () => {
    expect(FAR_ZOOM).toBe(0.42);
    expect(isFar(0.41)).toBe(true);
    expect(isFar(0.42)).toBe(false);
    expect(isFar(1)).toBe(false);
  });

  it('scales a name by the inverse zoom, at most three times', () => {
    expect(nameScale(0.5)).toBe(2);
    expect(nameScale(0.4)).toBeCloseTo(2.5);
    expect(nameScale(0.1)).toBe(3);
  });
});
