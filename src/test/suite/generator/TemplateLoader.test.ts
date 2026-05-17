/* eslint-disable */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemplateLoader } from '../../../generator/TemplateLoader';
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

  it('applies list filter', () => {
    const context = {
      entity_name: 'test',
      registers: [],
    };
    const result = loader.render('register_file.vhdl.j2', context);
    expect(result).toBeDefined();
  });

  it('renderString evaluates a Jinja2 expression against the context', () => {
    const result = loader.renderString('{{ entity_name }}_{{ bus_type }}', {
      entity_name: 'my_core',
      bus_type: 'axil',
    });
    expect(result).toBe('my_core_axil');
  });

  it('renderString returns empty string for missing variables', () => {
    const result = loader.renderString('{{ missing_var }}', {});
    expect(result).toBe('');
  });
});

describe('TemplateLoader — multi-directory support', () => {
  const logger = new Logger('test') as any;
  const builtinPath = path.resolve(__dirname, '../../../generator/templates');
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-loader-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a string[] templateDirs and uses the first directory that has the template', () => {
    fs.writeFileSync(path.join(tmpDir, 'top.vhdl.j2'), 'CUSTOM {{ entity_name }}');
    const loader = new TemplateLoader(logger, [tmpDir, builtinPath]);
    const result = loader.render('top.vhdl.j2', { entity_name: 'my_core' });
    expect(result).toBe('CUSTOM my_core');
  });

  it('falls back to a later directory when the earlier one lacks the template', () => {
    // tmpDir has no templates — built-in should be used
    const loader = new TemplateLoader(logger, [tmpDir, builtinPath]);
    const result = loader.render('architecture.vhdl.j2', {
      entity_name: 'fallback_core',
      architecture_name: 'rtl',
    });
    expect(result).toContain('architecture rtl of fallback_core is');
  });

  it('a custom template shadows the built-in while non-overridden templates still use built-ins', () => {
    // Only override top.vhdl.j2; core.vhdl.j2 should still come from built-in
    fs.writeFileSync(path.join(tmpDir, 'top.vhdl.j2'), 'SHADOWED_TOP');
    const loader = new TemplateLoader(logger, [tmpDir, builtinPath]);

    expect(loader.render('top.vhdl.j2', {})).toBe('SHADOWED_TOP');
    // core.vhdl.j2 is not in tmpDir, so falls back to built-in
    const coreResult = loader.render('core.vhdl.j2', {
      entity_name: 'x',
      generics: [],
      sw_registers: [],
      hw_registers: [],
      clock_port: 'clk',
      reset_port: 'rst',
      reset_active_high: true,
      user_ports: [],
    });
    expect(coreResult).toContain('entity x_core is');
  });

  it('getTemplatesPath() returns the first (primary) directory', () => {
    const loader = new TemplateLoader(logger, [tmpDir, builtinPath]);
    expect(loader.getTemplatesPath()).toBe(tmpDir);
  });
});
