/* eslint-disable */
import * as path from 'path';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { normalizeIpCoreData } from '../../../generator/registerProcessor';
import { buildDisplayItems } from '../../../generator/resolvers/displayItems';
import { buildGenerics } from '../../../generator/resolvers/generics';
import { buildParameterLayout } from '../../../generator/resolvers/parameterLayout';
import { Logger } from '../../../utils/Logger';

// Mock Logger to avoid VS Code dependencies
jest.mock('../../../utils/Logger', () => {
  return {
    Logger: jest.fn().mockImplementation(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  };
});

describe('TemplateLoader', () => {
  let loader: TemplateLoader;

  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');

  beforeEach(() => {
    loader = new TemplateLoader(logger, templatesPath);
  });

  it('resolves templates path', () => {
    expect(loader.getTemplatesPath()).toBe(templatesPath);
  });

  it('renders a simple template', () => {
    // architecture.vhdl.j2 is very simple
    const context = { entity_name: 'test_entity', architecture_name: 'rtl' };
    const result = loader.render('architecture.vhdl.j2', context);
    expect(result).toContain('architecture rtl of test_entity is');
  });

  it('applies format filter (hex)', () => {
    // We can use a fake template string to test filters if needed,
    // but we can also just use an existing template that uses it or test renderString if exposed.
    // TemplateLoader doesn't expose renderString, so we'll test via a small dummy template file if possible,
    // or just trust the filters are registered and test them via render() on a template that uses them.

    // many templates use format('%08X', ...)
    // Let's use register_file.vhdl.j2 which is complex but uses many filters
    const context = {
      entity_name: 'test',
      registers: [{ name: 'REG', offset: 4, fields: [], access: 'read-write' }],
    };
    const result = loader.render('register_file.vhdl.j2', context);
    expect(result).toContain('REG_REG');
  });

  it('format filter takes (formatString, value) — pipe the format string, value is the argument', () => {
    expect(loader.renderString("{{ '%02X' | format(4) }}", {})).toBe('04');
    expect(loader.renderString("{{ '%X' | format(255) }}", {})).toBe('FF');
    expect(loader.renderString("{{ '%08X' | format(255) }}", {})).toBe('000000FF');
    expect(loader.renderString("{{ '%x' | format(255) }}", {})).toBe('ff');
  });

  it('applies list filter', () => {
    const context = {
      entity_name: 'test',
      registers: [],
    };
    const result = loader.render('register_file.vhdl.j2', context);
    expect(result).toBeDefined();
  });

  it('renders an empty interrupt addressable point when no memory-mapped slave exists', () => {
    const result = loader.render('altera_hw_tcl.j2', {
      entity_name: 'irq_only',
      is_systemverilog: false,
      has_memory_mapped_slave: false,
      generics: [],
      clock_port: 'clk',
      reset_port: 'rst',
      reset_associated_clock: 'clk',
      reset_active_high: true,
      secondary_clocks: [],
      secondary_resets: [],
      expanded_bus_interfaces: [],
      user_ports: [],
      interrupt_ports: [
        {
          name: 'irq',
          direction: 'out',
          sensitivity: 'LEVEL_HIGH',
          associated_bus_interface: '',
          associated_clock: 'clk',
        },
      ],
      elaborate_port_widths: [],
      rtl_files: [],
    });

    expect(result).toContain('set_interface_property irq associatedAddressablePoint ""');
    expect(result).toContain('set_interface_property irq associatedClock clk');
  });

  describe('altera_hw_tcl parameter GUI', () => {
    function renderParameters(ipCore: Record<string, unknown>): string {
      const generics = buildGenerics(normalizeIpCoreData(ipCore));
      return loader.render('altera_hw_tcl.j2', {
        entity_name: 'params_core',
        is_systemverilog: false,
        has_memory_mapped_slave: false,
        generics,
        display_items: buildDisplayItems(buildParameterLayout(generics)),
        clock_port: 'clk',
        reset_port: 'rst',
        reset_associated_clock: 'clk',
        reset_active_high: true,
        secondary_clocks: [],
        secondary_resets: [],
        expanded_bus_interfaces: [],
        user_ports: [],
        interrupt_ports: [],
        elaborate_port_widths: [],
        rtl_files: [],
      });
    }

    it('emits a nested add_display_item tree for uiPage/uiGroup', () => {
      const result = renderParameters({
        parameters: [
          {
            name: 'DATA_WIDTH',
            value: 32,
            dataType: 'integer',
            uiPage: 'Config',
            uiGroup: 'Widths',
          },
          { name: 'MODE', value: 'fast', dataType: 'string', uiPage: 'Config' },
        ],
      });

      // Page-level (root) groups render as a Platform Designer tab; nested
      // groups render as a plain collapsible group — verified against a real,
      // tool-generated Intel component (add_display_item "" "X" "group" "tab"
      // for a root group vs add_display_item "X" "Y" "group" "" for a nested
      // one). Quartus renders a GROUP's own id as its visible label (it does
      // not honor DISPLAY_NAME for GROUP items), so the authored uiPage/
      // uiGroup text is used as the id directly rather than as a rename.
      expect(result).toContain('add_display_item "" "Config" GROUP tab');
      expect(result).toContain('add_display_item "Config" "MODE" PARAMETER');
      expect(result).toContain('add_display_item "Config" "Widths" GROUP ""');
      expect(result).toContain('add_display_item "Widths" "DATA_WIDTH" PARAMETER');
      expect(result).not.toMatch(/set_display_item_property .*DISPLAY_NAME/);

      // A group must be declared before anything is parented to it.
      expect(result.indexOf('"" "Config" GROUP')).toBeLessThan(
        result.indexOf('"Config" "Widths" GROUP')
      );
      expect(result.indexOf('"Config" "Widths" GROUP')).toBeLessThan(
        result.indexOf('"Widths" "DATA_WIDTH" PARAMETER')
      );

      // The deprecated flat GROUP property cannot express nesting and is not used.
      expect(result).not.toMatch(/set_parameter_property \w+ GROUP/);
    });

    it('places parameters with no uiPage at the root instead of a synthetic page group', () => {
      const result = renderParameters({
        parameters: [{ name: 'DATA_WIDTH', value: 32, dataType: 'integer' }],
      });

      expect(result).toContain('add_display_item "" "DATA_WIDTH" PARAMETER');
      expect(result).not.toContain('Page 0');
    });

    it('keeps an explicit uiPage: "Page 0" as its own tab, separate from unplaced parameters', () => {
      const result = renderParameters({
        parameters: [
          { name: 'A', value: 1, dataType: 'integer', uiPage: 'Page 0' },
          { name: 'B', value: 2, dataType: 'integer' },
        ],
      });

      expect(result).toContain('add_display_item "" "Page 0" GROUP tab');
      expect(result).toContain('add_display_item "Page 0" "A" PARAMETER');
      // B has no uiPage at all, so it sits at the root rather than under the
      // "Page 0" tab that A explicitly asked for.
      expect(result).toContain('add_display_item "" "B" PARAMETER');
    });

    it('escapes Tcl-special characters in uiPage/uiGroup names and parameter free text', () => {
      const result = renderParameters({
        parameters: [
          {
            name: 'MODE',
            value: '[exec pwd] and $HOME and "quoted"',
            dataType: 'string',
            description: 'Uses $HOME and [exec pwd] and a "quote" and \\backslash',
            displayName: 'Mode "select"',
            allowedValues: ['01', 'He said "yes"', 'A}B'],
            uiPage: 'Config "Page"',
            uiGroup: 'Group$x',
          },
        ],
      });

      expect(result).toContain(
        'set_parameter_property MODE DESCRIPTION "Uses \\$HOME and \\[exec pwd] and a \\"quote\\" and \\\\backslash"'
      );
      expect(result).toContain('set_parameter_property MODE DISPLAY_NAME "Mode \\"select\\""');
      expect(result).toContain(
        'set_parameter_property MODE DEFAULT_VALUE "\\[exec pwd] and \\$HOME and \\"quoted\\""'
      );
      expect(result).toContain(
        'set_parameter_property MODE ALLOWED_RANGES { "01" "He said \\"yes\\"" "A\\}B" }'
      );
      // The group's own escaped text is the id (and thus the visible label)
      // — there is no DISPLAY_NAME rename to escape separately for GROUP.
      expect(result).toContain('add_display_item "" "Config \\"Page\\"" GROUP tab');
      expect(result).toContain('add_display_item "Config \\"Page\\"" "Group\\$x" GROUP ""');
      expect(result).toContain('add_display_item "Group\\$x" "MODE" PARAMETER');
    });

    it('quotes string choices in ALLOWED_RANGES but leaves numeric ones bare', () => {
      const result = renderParameters({
        parameters: [
          {
            name: 'VENDOR',
            value: 'ALTERA',
            dataType: 'string',
            allowedValues: ['ALTERA', 'XILINX'],
          },
          { name: 'DATA_WIDTH', value: 32, dataType: 'integer', allowedValues: [8, 16, 32] },
        ],
      });

      expect(result).toContain(
        'set_parameter_property VENDOR ALLOWED_RANGES { "ALTERA" "XILINX" }'
      );
      expect(result).toContain('set_parameter_property DATA_WIDTH ALLOWED_RANGES { 8 16 32 }');
    });

    it('uses displayName for DISPLAY_NAME and title-cases the name when absent', () => {
      const result = renderParameters({
        parameters: [
          { name: 'DATA_WIDTH', value: 32, dataType: 'integer', displayName: 'Data Bus Width' },
          { name: 'ADDR_WIDTH', value: 8, dataType: 'integer' },
        ],
      });

      expect(result).toContain('set_parameter_property DATA_WIDTH DISPLAY_NAME "Data Bus Width"');
      expect(result).toContain('set_parameter_property ADDR_WIDTH DISPLAY_NAME "Addr Width"');
    });
  });

  describe('hasTemplate', () => {
    it('returns true for a template that exists in the built-in dir', () => {
      expect(loader.hasTemplate('architecture.vhdl.j2')).toBe(true);
    });

    it('returns false for a template that does not exist anywhere on the search path', () => {
      expect(loader.hasTemplate('component.xml.j2')).toBe(false);
    });

    it('returns true when a pack dir (searched first) supplies a template with no built-in equivalent', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-template-loader-'));
      try {
        fs.writeFileSync(path.join(tmp, 'component.xml.j2'), '<custom/>');
        const multiRootLoader = new TemplateLoader(logger, [tmp, templatesPath]);
        // component.xml.j2 has no built-in equivalent — hasTemplate must still find
        // it via the pack search path so callers know to render the pack's override.
        expect(multiRootLoader.hasTemplate('component.xml.j2')).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
