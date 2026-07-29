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
  // Quartus renders a GROUP display item's own id as its visible label — it
  // does not honor DISPLAY_NAME as a rename target for GROUP items (see the
  // stub's rejection of that call for GROUP kind). So the id must equal the
  // authored uiPage/uiGroup text directly, and every item carries an
  // `_tcl`-escaped copy of both id and parent for safe embedding in the
  // generated double-quoted Tcl arguments.

  it('nests a uiGroup inside its uiPage, using the authored text as the id', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: 'Config', ui_group: 'Widths' }])
    );
    expect(items).toEqual([
      { id: 'Config', id_tcl: 'Config', parent: '', parent_tcl: '', kind: 'GROUP' },
      {
        id: 'Widths',
        id_tcl: 'Widths',
        parent: 'Config',
        parent_tcl: 'Config',
        kind: 'GROUP',
      },
      { id: 'A', id_tcl: 'A', parent: 'Widths', parent_tcl: 'Widths', kind: 'PARAMETER' },
    ]);
  });

  it('parents a page-only parameter directly to its page group', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: 'Config', ui_group: '' }])
    );
    expect(items).toEqual([
      { id: 'Config', id_tcl: 'Config', parent: '', parent_tcl: '', kind: 'GROUP' },
      { id: 'A', id_tcl: 'A', parent: 'Config', parent_tcl: 'Config', kind: 'PARAMETER' },
    ]);
  });

  it('places parameters with no uiPage at the root, not under a synthetic page', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: '', ui_group: '' }])
    );
    expect(items).toEqual([
      { id: 'A', id_tcl: 'A', parent: '', parent_tcl: '', kind: 'PARAMETER' },
    ]);
  });

  it('upper-cases parameter ids to match add_parameter in the hw.tcl template', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'data_width', ui_page: 'Config', ui_group: '' }])
    );
    expect(items[1]).toEqual({
      id: 'DATA_WIDTH',
      id_tcl: 'DATA_WIDTH',
      parent: 'Config',
      parent_tcl: 'Config',
      kind: 'PARAMETER',
    });
  });

  it('keeps distinct group labels across pages verbatim, with no qualification', () => {
    const items = buildDisplayItems(
      buildParameterLayout([
        { name: 'A', ui_page: 'Config', ui_group: 'Widths' },
        { name: 'B', ui_page: 'Timing', ui_group: 'Clocks' },
      ])
    );
    const groups = items.filter((i) => i.kind === 'GROUP');
    expect(groups.map((i) => i.id)).toEqual(['Config', 'Widths', 'Timing', 'Clocks']);
  });

  it('disambiguates a group label reused on two pages with a visible qualifier', () => {
    const items = buildDisplayItems(
      buildParameterLayout([
        { name: 'A', ui_page: 'Config', ui_group: 'Advanced' },
        { name: 'B', ui_page: 'Timing', ui_group: 'Advanced' },
      ])
    );
    const groups = items.filter((i) => i.kind === 'GROUP');
    expect(groups).toEqual([
      { id: 'Config', id_tcl: 'Config', parent: '', parent_tcl: '', kind: 'GROUP' },
      {
        id: 'Advanced',
        id_tcl: 'Advanced',
        parent: 'Config',
        parent_tcl: 'Config',
        kind: 'GROUP',
      },
      { id: 'Timing', id_tcl: 'Timing', parent: '', parent_tcl: '', kind: 'GROUP' },
      {
        id: 'Advanced (2)',
        id_tcl: 'Advanced (2)',
        parent: 'Timing',
        parent_tcl: 'Timing',
        kind: 'GROUP',
      },
    ]);
    expect(items.find((i) => i.id === 'B')?.parent).toBe('Advanced (2)');
  });

  it('disambiguates a group label that collides with a parameter name', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'Advanced', ui_page: 'Config', ui_group: 'Advanced' }])
    );
    expect(items).toEqual([
      { id: 'Config', id_tcl: 'Config', parent: '', parent_tcl: '', kind: 'GROUP' },
      {
        id: 'Advanced (2)',
        id_tcl: 'Advanced (2)',
        parent: 'Config',
        parent_tcl: 'Config',
        kind: 'GROUP',
      },
      {
        id: 'ADVANCED',
        id_tcl: 'ADVANCED',
        parent: 'Advanced (2)',
        parent_tcl: 'Advanced (2)',
        kind: 'PARAMETER',
      },
    ]);
  });

  it('disambiguates a page label that collides with a parameter name', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'Config', ui_page: 'Config', ui_group: '' }])
    );
    expect(items).toEqual([
      {
        id: 'Config (2)',
        id_tcl: 'Config (2)',
        parent: '',
        parent_tcl: '',
        kind: 'GROUP',
      },
      {
        id: 'CONFIG',
        id_tcl: 'CONFIG',
        parent: 'Config (2)',
        parent_tcl: 'Config (2)',
        kind: 'PARAMETER',
      },
    ]);
  });

  it('escapes a uiPage/uiGroup name for Tcl double-quoted embedding, consistently across id and parent', () => {
    const items = buildDisplayItems(
      buildParameterLayout([{ name: 'A', ui_page: 'Config "Page"', ui_group: 'Group$x' }])
    );
    expect(items).toEqual([
      {
        id: 'Config "Page"',
        id_tcl: 'Config \\"Page\\"',
        parent: '',
        parent_tcl: '',
        kind: 'GROUP',
      },
      {
        id: 'Group$x',
        id_tcl: 'Group\\$x',
        parent: 'Config "Page"',
        parent_tcl: 'Config \\"Page\\"',
        kind: 'GROUP',
      },
      {
        id: 'A',
        id_tcl: 'A',
        parent: 'Group$x',
        parent_tcl: 'Group\\$x',
        kind: 'PARAMETER',
      },
    ]);
  });
});
