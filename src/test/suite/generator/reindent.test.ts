import * as path from 'path';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import {
  createIndentUnit,
  reindentGeneratedSources,
  reindentSource,
  resolveIndentationDefaults,
} from '../../../generator/reindent';
import { Logger } from '../../../utils/Logger';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('generated source indentation', () => {
  const logger = new Logger('test');
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  const loader = new TemplateLoader(logger, templatesPath);
  const renderedVhdl = loader.render('architecture.vhdl.j2', {
    entity_name: 'example',
    architecture_name: 'rtl',
  });

  it.each([
    {
      label: '3 spaces',
      unit: '   ',
      expected: `architecture rtl of example is
begin
      -- Your architecture code goes here
end architecture rtl;
`,
    },
    {
      label: '4 spaces',
      unit: '    ',
      expected: `architecture rtl of example is
begin
        -- Your architecture code goes here
end architecture rtl;
`,
    },
    {
      label: '8 spaces',
      unit: '        ',
      expected: `architecture rtl of example is
begin
                -- Your architecture code goes here
end architecture rtl;
`,
    },
    {
      label: 'tabs',
      unit: '\t',
      expected: `architecture rtl of example is
begin
\t\t-- Your architecture code goes here
end architecture rtl;
`,
    },
  ])('reindents a rendered VHDL template with $label', ({ unit, expected }) => {
    expect(reindentSource(renderedVhdl, unit)).toMatchSnapshot();
    expect(reindentSource(renderedVhdl, unit)).toBe(expected);
  });

  it('preserves default output byte-for-byte', () => {
    expect(reindentSource(renderedVhdl, createIndentUnit('spaces', 2))).toBe(renderedVhdl);
  });

  it('only changes HDL and synthesis-tool source extensions', () => {
    const files = {
      'rtl/example.vhd': 'begin\n    statement;\nend;',
      'rtl/example.SV': 'module example;\n    logic value;\nendmodule',
      'scripts/build.tcl': 'if {$enabled} {\n    run\n}',
      'constraints/example.xdc': 'if {$enabled} {\n    constrain\n}',
      'constraints/example.sdc': 'if {$enabled} {\n    constrain\n}',
      'docs/example.md': '# Example\n    preserved',
      'tb/example.py': 'def example():\n    preserved',
      'config/example.yml': 'example:\n    preserved',
    };

    expect(reindentGeneratedSources(files, 'spaces', 4)).toEqual({
      'rtl/example.vhd': 'begin\n        statement;\nend;',
      'rtl/example.SV': 'module example;\n        logic value;\nendmodule',
      'scripts/build.tcl': 'if {$enabled} {\n        run\n}',
      'constraints/example.xdc': 'if {$enabled} {\n        constrain\n}',
      'constraints/example.sdc': 'if {$enabled} {\n        constrain\n}',
      'docs/example.md': files['docs/example.md'],
      'tb/example.py': files['tb/example.py'],
      'config/example.yml': files['config/example.yml'],
    });
  });

  it('rejects a non-positive space indentation size', () => {
    expect(() => createIndentUnit('spaces', 0)).toThrow('Indent size must be a positive integer');
  });
});

describe('resolveIndentationDefaults (issue #160)', () => {
  it('explicit wins over pack and workspace for both fields', () => {
    expect(
      resolveIndentationDefaults(
        { style: 'tab', size: 8 },
        { style: 'spaces', size: 4 },
        { style: 'spaces', size: 2 }
      )
    ).toEqual({ style: 'tab', size: 8 });
  });

  it('pack wins over workspace when explicit is absent', () => {
    expect(
      resolveIndentationDefaults({}, { style: 'tab', size: 4 }, { style: 'spaces', size: 2 })
    ).toEqual({
      style: 'tab',
      size: 4,
    });
  });

  it('workspace wins when explicit and pack are absent', () => {
    expect(resolveIndentationDefaults({}, undefined, { style: 'tab', size: 3 })).toEqual({
      style: 'tab',
      size: 3,
    });
  });

  it('falls back to the built-in default when all tiers are absent', () => {
    expect(resolveIndentationDefaults({}, undefined, undefined)).toEqual({
      style: 'spaces',
      size: 2,
    });
  });

  it('combines explicit style with pack size when each source declares only one field', () => {
    expect(
      resolveIndentationDefaults({ style: 'tab' }, { size: 4 }, { style: 'spaces', size: 8 })
    ).toEqual({ style: 'tab', size: 4 });
  });

  it('combines pack style with workspace size when pack omits size', () => {
    expect(resolveIndentationDefaults({}, { style: 'tab' }, { size: 6 })).toEqual({
      style: 'tab',
      size: 6,
    });
  });

  it('combines explicit size with workspace style when explicit omits style and pack is absent', () => {
    expect(resolveIndentationDefaults({ size: 5 }, undefined, { style: 'tab' })).toEqual({
      style: 'tab',
      size: 5,
    });
  });

  it('combines pack size with built-in default style when neither explicit nor workspace declare style', () => {
    expect(resolveIndentationDefaults({}, { size: 4 }, undefined)).toEqual({
      style: 'spaces',
      size: 4,
    });
  });
});
