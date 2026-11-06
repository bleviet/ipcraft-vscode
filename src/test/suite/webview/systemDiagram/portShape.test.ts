import { portShapePath } from '../../../../webview/systemDiagram/layout/portShape';

describe('portShapePath', () => {
  it('points east with a 12 px tip', () => {
    expect(portShapePath(100, 26)).toBe('M0,0 H88 L100,13 L88,26 H0 Z');
  });

  it('points both ways for inout ports', () => {
    expect(portShapePath(100, 26, true)).toBe('M12,0 H88 L100,13 L88,26 H12 L0,13 Z');
  });
});
