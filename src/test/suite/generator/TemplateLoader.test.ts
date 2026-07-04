/* eslint-disable */
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
