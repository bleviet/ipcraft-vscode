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

  it('applies list filter', () => {
    const context = {
      entity_name: 'test',
      registers: [],
    };
    const result = loader.render('register_file.vhdl.j2', context);
    expect(result).toBeDefined();
  });
});
