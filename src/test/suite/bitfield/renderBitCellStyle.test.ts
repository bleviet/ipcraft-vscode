import { renderBitCellStyle } from '../../../webview/components/bitfield/renderBitCellStyle';

describe('renderBitCellStyle', () => {
  const baseArgs = {
    isOutOfNewRange: false,
    isInNewRange: false,
    colorToken: 'blue',
    ctrlDragActive: false,
    ctrlHeld: false,
  };

  it('marks bit value 1 as active', () => {
    const { labelClassName } = renderBitCellStyle({ ...baseArgs, bitValue: 1 });
    expect(labelClassName).toContain('ipcraft-pattern-label--active');
    expect(labelClassName).not.toContain('ipcraft-pattern-label--inactive');
  });

  it('marks bit value 0 as inactive', () => {
    const { labelClassName } = renderBitCellStyle({ ...baseArgs, bitValue: 0 });
    expect(labelClassName).toContain('ipcraft-pattern-label--inactive');
    expect(labelClassName).not.toContain('ipcraft-pattern-label--active');
  });
});
