import { buildDisplayItems } from '../../../../generator/resolvers/displayItems';
import { buildGenerics } from '../../../../generator/resolvers/generics';
import { buildParameterLayout } from '../../../../generator/resolvers/parameterLayout';
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

  it('escapes displayName and description for Tcl double-quoted embedding, leaving the raw copies alone', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [
        {
          name: 'MODE',
          dataType: 'string',
          displayName: 'Mode "select"',
          description: 'Uses $HOME and [exec pwd] and a "quote"',
        },
      ],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.display_name).toBe('Mode "select"');
    expect(g.display_name_tcl).toBe('Mode \\"select\\"');
    expect(g.description).toBe('Uses $HOME and [exec pwd] and a "quote"');
    expect(g.description_tcl).toBe('Uses \\$HOME and \\[exec pwd] and a \\"quote\\"');
  });

  it('renders allowed_values_tcl as a quoted Tcl list for string parameters, escaping each element', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [
        {
          name: 'VENDOR',
          dataType: 'string',
          allowedValues: ['ALTERA', 'He said "yes"'],
        },
      ],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.allowed_values_tcl).toBe('{ "ALTERA" "He said \\"yes\\"" }');
  });

  it('renders allowed_values_tcl as a bare Tcl list for numeric parameters', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'DATA_WIDTH', dataType: 'integer', allowedValues: [8, 16, 32] }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.allowed_values_tcl).toBe('{ 8 16 32 }');
  });

  it('sets allowed_values_tcl to null when there are no allowedValues', () => {
    const ipCore = normalizeIpCoreData({
      parameters: [{ name: 'DATA_WIDTH', dataType: 'integer' }],
    });
    const [g] = buildGenerics(ipCore);
    expect(g.allowed_values_tcl).toBeNull();
  });
});

describe('buildParameterLayout', () => {
  it('groups generics without uiPage onto Page 0', () => {
    const generics = [{ name: 'A', ui_page: '', ui_group: '' }];
    const pages = buildParameterLayout(generics);
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe('Page 0');
    expect(pages[0].isDefault).toBe(true);
    expect(pages[0].ungrouped_params).toEqual([{ name: 'A', tooltip: '' }]);
  });

  it('groups generics into named page and group', () => {
    const generics = [{ name: 'A', ui_page: 'Config', ui_group: 'Widths' }];
    const pages = buildParameterLayout(generics);
    expect(pages[0].name).toBe('Config');
    expect(pages[0].isDefault).toBe(false);
    expect(pages[0].groups[0].name).toBe('Widths');
    expect(pages[0].groups[0].params).toEqual([{ name: 'A', tooltip: '' }]);
  });

  it('generates tcl_var slugs', () => {
    const generics = [{ name: 'A', ui_page: 'My Page', ui_group: 'My-Group' }];
    const pages = buildParameterLayout(generics);
    expect(pages[0].tcl_var).toBe('Page_My_Page');
    expect(pages[0].groups[0].tcl_var).toBe('Group_My_Page_My_Group');
  });

  it('keeps an explicit uiPage: "Page 0" distinct from the synthetic default-page bucket', () => {
    const generics = [
      { name: 'A', ui_page: 'Page 0', ui_group: '' },
      { name: 'B', ui_page: '', ui_group: '' },
    ];
    const pages = buildParameterLayout(generics);
    expect(pages).toHaveLength(2);

    const explicit = pages.find((p) => p.ungrouped_params.some((prm) => prm.name === 'A'))!;
    const synthetic = pages.find((p) => p.ungrouped_params.some((prm) => prm.name === 'B'))!;

    expect(explicit.isDefault).toBe(false);
    expect(synthetic.isDefault).toBe(true);
    // Both display as "Page 0" (Vivado's synthetic-page name collides with the
    // author's literal choice), but their parameter membership must not merge.
    expect(explicit.name).toBe('Page 0');
    expect(synthetic.name).toBe('Page 0');
    expect(explicit.ungrouped_params).toEqual([{ name: 'A', tooltip: '' }]);
    expect(synthetic.ungrouped_params).toEqual([{ name: 'B', tooltip: '' }]);
  });
});

describe('buildDisplayItems', () => {
  it('nests a uiGroup inside its uiPage', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: 'Config', ui_group: 'Widths' }])
    );
    expect(items).toEqual([
      {
        id: 'ipcraft_page_0',
        parent: '',
        kind: 'GROUP',
        display_name: 'Config',
        display_name_tcl: 'Config',
      },
      {
        id: 'ipcraft_group_0_0',
        parent: 'ipcraft_page_0',
        kind: 'GROUP',
        display_name: 'Widths',
        display_name_tcl: 'Widths',
      },
      { id: 'A', parent: 'ipcraft_group_0_0', kind: 'PARAMETER' },
    ]);
  });

  it('parents a page-only parameter directly to its page group', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: 'Config', ui_group: '' }])
    );
    expect(items).toEqual([
      {
        id: 'ipcraft_page_0',
        parent: '',
        kind: 'GROUP',
        display_name: 'Config',
        display_name_tcl: 'Config',
      },
      { id: 'A', parent: 'ipcraft_page_0', kind: 'PARAMETER' },
    ]);
  });

  it('places parameters with no uiPage at the root, not under a synthetic page', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: '', ui_group: '' }])
    );
    expect(items).toEqual([{ id: 'A', parent: '', kind: 'PARAMETER' }]);
  });

  it('upper-cases parameter ids to match add_parameter in the hw.tcl template', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'data_width', ui_page: 'Config', ui_group: '' }])
    );
    expect(items[1]).toEqual({
      id: 'DATA_WIDTH',
      parent: 'ipcraft_page_0',
      kind: 'PARAMETER',
    });
  });

  it('page-qualifies a group name reused on two pages', () => {
    const items = buildDisplayItems(
      buildParameterLayout([
        { name: 'A', ui_page: 'Config', ui_group: 'Advanced' },
        { name: 'B', ui_page: 'Timing', ui_group: 'Advanced' },
      ])
    );
    const groups = items.filter((i) => i.kind === 'GROUP');
    expect(groups).toEqual([
      {
        id: 'ipcraft_page_0',
        parent: '',
        kind: 'GROUP',
        display_name: 'Config',
        display_name_tcl: 'Config',
      },
      {
        id: 'ipcraft_group_0_0',
        parent: 'ipcraft_page_0',
        kind: 'GROUP',
        display_name: 'Advanced',
        display_name_tcl: 'Advanced',
      },
      {
        id: 'ipcraft_page_1',
        parent: '',
        kind: 'GROUP',
        display_name: 'Timing',
        display_name_tcl: 'Timing',
      },
      {
        id: 'ipcraft_group_1_0',
        parent: 'ipcraft_page_1',
        kind: 'GROUP',
        display_name: 'Advanced',
        display_name_tcl: 'Advanced',
      },
    ]);
    expect(items.find((i) => i.id === 'B')?.parent).toBe('ipcraft_group_1_0');
  });

  it('does not let a group id collide with a parameter name', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'Advanced', ui_page: 'Config', ui_group: 'Advanced' }])
    );
    expect(items).toEqual([
      {
        id: 'ipcraft_page_0',
        parent: '',
        kind: 'GROUP',
        display_name: 'Config',
        display_name_tcl: 'Config',
      },
      {
        id: 'ipcraft_group_0_0',
        parent: 'ipcraft_page_0',
        kind: 'GROUP',
        display_name: 'Advanced',
        display_name_tcl: 'Advanced',
      },
      { id: 'ADVANCED', parent: 'ipcraft_group_0_0', kind: 'PARAMETER' },
    ]);
  });

  it('suffixes an internal id that collides with a parameter name', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'IPCRAFT_PAGE_0', ui_page: 'Config', ui_group: '' }])
    );
    expect(items[0]).toMatchObject({
      id: 'ipcraft_page_0_2',
      display_name: 'Config',
      kind: 'GROUP',
    });
    expect(items[1]).toEqual({
      id: 'IPCRAFT_PAGE_0',
      parent: 'ipcraft_page_0_2',
      kind: 'PARAMETER',
    });
  });

  it('escapes a uiPage/uiGroup name for Tcl double-quoted embedding, consistently across id and parent', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: 'Config "Page"', ui_group: 'Group$x' }])
    );
    expect(items).toEqual([
      {
        id: 'ipcraft_page_0',
        parent: '',
        kind: 'GROUP',
        display_name: 'Config "Page"',
        display_name_tcl: 'Config \\"Page\\"',
      },
      {
        id: 'ipcraft_group_0_0',
        parent: 'ipcraft_page_0',
        kind: 'GROUP',
        display_name: 'Group$x',
        display_name_tcl: 'Group\\$x',
      },
      { id: 'A', parent: 'ipcraft_group_0_0', kind: 'PARAMETER' },
    ]);
  });

  it('keeps repeated group labels while assigning globally unique internal ids', () => {
    const items = buildDisplayItems(
      buildParameterLayout([
        { name: 'A', ui_page: 'Config', ui_group: 'A$B' },
        { name: 'B', ui_page: 'Timing', ui_group: 'A$B' },
      ])
    );
    const groups = items.filter((i) => i.kind === 'GROUP');
    expect(groups.map((i) => i.id)).toEqual([
      'ipcraft_page_0',
      'ipcraft_group_0_0',
      'ipcraft_page_1',
      'ipcraft_group_1_0',
    ]);
    expect(groups.map((i) => i.display_name)).toEqual(['Config', 'A$B', 'Timing', 'A$B']);
    expect(groups.map((i) => i.display_name_tcl)).toEqual(['Config', 'A\\$B', 'Timing', 'A\\$B']);
  });
});
