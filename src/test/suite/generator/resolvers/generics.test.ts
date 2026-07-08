import { buildGenerics, buildXguiPages } from '../../../../generator/resolvers/generics';
import { normalizeIpCoreData } from '../../../../generator/registerProcessor';

describe('buildGenerics', () => {
  it('returns empty array for IP with no parameters', () => {
    const ipCore = normalizeIpCoreData({});
    expect(buildGenerics(ipCore)).toEqual([]);
  });

  it('maps integer parameter correctly', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'DATA_WIDTH', value: 32, dataType: 'integer' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.name).toBe('DATA_WIDTH');
    expect(g.type).toBe('integer');
    expect(g.sv_type).toBe('int');
    expect(g.default_value).toBe(32);
    expect(g.sv_default).toBe(32);
  });

  it('wraps string default in VHDL quotes', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'TAG', value: 'hello', dataType: 'string' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.default_value).toBe('"hello"');
    expect(g.sv_default).toBe('"hello"');
  });

  it('strips pre-existing quotes for string type', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'TAG', value: '"already_quoted"', dataType: 'string' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.default_value).toBe('"already_quoted"');
  });

  it('maps boolean parameter to SV bit type', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'ENABLE', value: 'true', dataType: 'boolean' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.sv_type).toBe('bit');
    expect(g.sv_default).toBe("1'b1");
  });

  it('uses default 0 for integer with no value', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'N', dataType: 'integer' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.default_value).toBe(0);
  });

  it('uses default false for boolean with no value', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'EN', dataType: 'boolean' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.default_value).toBe('false');
    expect(g.sv_default).toBe("1'b0");
  });

  it('passes min and max through for ranged integer parameters', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'ADDR_WIDTH', value: 32, dataType: 'integer', min: 16, max: 64 }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.min).toBe(16);
    expect(g.max).toBe(64);
  });

  it('sets min and max to null when not provided', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'DATA_WIDTH', value: 32, dataType: 'integer' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.min).toBeNull();
    expect(g.max).toBeNull();
  });
});

describe('buildXguiPages', () => {
  it('groups generics without uiPage onto Page 0', () => {
    const generics = [{ name: 'A', ui_page: '', ui_group: '' }];
    const pages = buildXguiPages(generics);
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe('Page 0');
    expect(pages[0].ungrouped_params).toEqual([{ name: 'A', tooltip: '' }]);
  });

  it('groups generics into named page and group', () => {
    const generics = [{ name: 'A', ui_page: 'Config', ui_group: 'Widths' }];
    const pages = buildXguiPages(generics);
    expect(pages[0].name).toBe('Config');
    expect(pages[0].groups[0].name).toBe('Widths');
    expect(pages[0].groups[0].params).toEqual([{ name: 'A', tooltip: '' }]);
  });

  it('generates tcl_var slugs', () => {
    const generics = [{ name: 'A', ui_page: 'My Page', ui_group: 'My-Group' }];
    const pages = buildXguiPages(generics);
    expect(pages[0].tcl_var).toBe('Page_My_Page');
    expect(pages[0].groups[0].tcl_var).toBe('Group_My_Page_My_Group');
  });
});
