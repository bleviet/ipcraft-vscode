import {
  DEFAULT_EXPORT_OPTIONS,
  parseExportRect,
  parseSystemExportView,
  formatExtensionMismatch,
  sanitizeExportOptions,
  systemExportFileName,
} from '../../../shared/messages/imageExport';

describe('sanitizeExportOptions', () => {
  it('defaults to Light, PNG, 2x, grid and legend on, editor background', () => {
    expect(sanitizeExportOptions(undefined)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(DEFAULT_EXPORT_OPTIONS).toMatchObject({
      format: 'png',
      scale: 2,
      theme: 'light',
      grid: true,
      legend: true,
      background: 'editor',
    });
  });

  it('keeps valid fields and repairs the others one by one', () => {
    expect(
      sanitizeExportOptions({ format: 'svg', area: 'whole', scale: 3.4, theme: 'blue', grid: 0 })
    ).toEqual({ ...DEFAULT_EXPORT_OPTIONS, format: 'svg', area: 'whole', scale: 3 });
    expect(sanitizeExportOptions({ scale: 9 }).scale).toBe(2);
  });

  it('forces an opaque background for JPG', () => {
    expect(sanitizeExportOptions({ format: 'jpg', background: 'transparent' }).background).toBe(
      'editor'
    );
    expect(sanitizeExportOptions({ format: 'png', background: 'transparent' }).background).toBe(
      'transparent'
    );
  });
});

describe('systemExportFileName', () => {
  it('names the root level after the design and nested levels with / as _', () => {
    expect(systemExportFileName('soc', '/', 'png')).toBe('soc.png');
    expect(systemExportFileName('soc', '/dsp', 'svg')).toBe('soc-dsp.svg');
    expect(systemExportFileName('soc', '/dsp/fir', 'jpg')).toBe('soc-dsp_fir.jpg');
  });
});

describe('message parsers', () => {
  const view = { levelPath: '/', expanded: [], selectedNodeIds: [], clocks: false };

  it('accepts a well-formed view and rejects malformed ones', () => {
    expect(parseSystemExportView(view)).toEqual(view);
    expect(parseSystemExportView({ ...view, isolate: { nodeIds: ['a'], hops: 2 } })).toBeDefined();
    expect(parseSystemExportView({ ...view, expanded: [1] })).toBeUndefined();
    expect(
      parseSystemExportView({ ...view, isolate: { nodeIds: ['a'], hops: 'x' } })
    ).toBeUndefined();
    expect(parseSystemExportView({ ...view, visibleNodeIds: 'a' })).toBeUndefined();
    expect(parseSystemExportView({ ...view, isolate: null })).toBeUndefined();
    expect(parseSystemExportView(null)).toBeUndefined();
  });

  it('keeps a boolean marks flag and drops any other value', () => {
    expect(parseSystemExportView({ ...view, marks: true })).toEqual({ ...view, marks: true });
    expect(parseSystemExportView({ ...view, marks: false })).toEqual({ ...view, marks: false });
    for (const marks of ['yes', 1, null, {}]) {
      expect(parseSystemExportView({ ...view, marks })).toEqual(view);
    }
  });

  it('accepts only a finite, non-empty rectangle', () => {
    expect(parseExportRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(parseExportRect({ x: 1, y: 2, width: 0, height: 4 })).toBeUndefined();
    expect(parseExportRect({ x: NaN, y: 2, width: 3, height: 4 })).toBeUndefined();
    expect(parseExportRect(undefined)).toBeUndefined();
  });
});

describe('formatExtensionMismatch', () => {
  it('accepts a matching extension, .jpeg included for JPG, in any case', () => {
    expect(formatExtensionMismatch('/a/x.png', 'png')).toBeUndefined();
    expect(formatExtensionMismatch('/a/x.JPEG', 'jpg')).toBeUndefined();
    expect(formatExtensionMismatch('C:\\a\\x.svg', 'svg')).toBeUndefined();
  });

  it('reports a different or missing extension', () => {
    expect(formatExtensionMismatch('/a/x.svg', 'png')).toBe(
      'The file name ends in .svg, but the format is PNG. Export again with a .png name, or pick another format in the export options.'
    );
    expect(formatExtensionMismatch('/a/x', 'png')).toContain('has no extension');
    expect(formatExtensionMismatch('/a.b/x', 'png')).toContain('has no extension');
  });
});
