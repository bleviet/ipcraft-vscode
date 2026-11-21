import { parseArgs, usageText } from '../../../cli/argv';

describe('ipcraft resources argv', () => {
  it('parses a design and a report with the Markdown default', () => {
    expect(parseArgs(['resources', 'sys.bd', 'util.rpt'])).toEqual({
      kind: 'resources',
      args: { design: 'sys.bd', reports: ['util.rpt'], format: 'markdown' },
    });
  });

  it('takes several reports and every option', () => {
    expect(
      parseArgs([
        'resources',
        'sys.bd',
        'a.rpt',
        'b.rpt',
        '--capacity',
        'flat.rpt',
        '--root',
        'wrapper/sys_i',
        '--format',
        'json',
        '--out',
        'out.json',
      ])
    ).toEqual({
      kind: 'resources',
      args: {
        design: 'sys.bd',
        reports: ['a.rpt', 'b.rpt'],
        capacity: 'flat.rpt',
        root: 'wrapper/sys_i',
        format: 'json',
        out: 'out.json',
      },
    });
  });

  it.each([
    [['resources'], 'Missing required arguments: <design> <report>...'],
    [['resources', 'sys.bd'], 'Missing required argument: <report>...'],
    [['resources', 'sys.bd', 'a.rpt', '--format', 'xml'], "Invalid --format 'xml'"],
    [['resources', 'sys.bd', 'a.rpt', '--root'], 'Missing value for --root'],
    [['resources', 'sys.bd', 'a.rpt', '--capacity', '--out', 'x'], 'Missing value for --capacity'],
    [['resources', 'sys.bd', 'a.rpt', '--clocks'], "Unknown option '--clocks' for 'resources'"],
  ])('rejects %j with exit code 2', (argv, message) => {
    const parsed = parseArgs(argv);
    expect(parsed.kind).toBe('error');
    expect(parsed).toMatchObject({ exitCode: 2 });
    expect((parsed as { message: string }).message).toContain(message);
  });

  it('keeps exit code 1 (no exitCode) for the other commands', () => {
    expect(parseArgs(['diff'])).toEqual({
      kind: 'error',
      message: 'Missing required argument: <design>',
    });
  });

  it('documents the command and its options', () => {
    const usage = usageText();
    expect(usage).toContain('ipcraft resources <design> <report>...');
    expect(usage).toContain('--resources <report>...');
    expect(usage).not.toContain('--resources-color');
  });
});

describe('ipcraft render --resources argv', () => {
  const render = (...extra: string[]) =>
    parseArgs(['render', 'sys.bd', '--out', 'a.svg', ...extra]);

  it('draws no usage without --resources', () => {
    const parsed = render();
    expect(parsed.kind).toBe('render');
    expect(parsed).not.toHaveProperty('args.resources');
  });

  it('takes the reports after --resources up to the next option', () => {
    expect(render('--resources', 'a.rpt', 'b.rpt', '--capacity', 'flat.rpt')).toMatchObject({
      kind: 'render',
      args: { resources: { reports: ['a.rpt', 'b.rpt'], capacity: 'flat.rpt' } },
    });
  });

  it('collects a repeated --resources', () => {
    expect(render('--resources', 'a.rpt', '--resources', 'b.rpt')).toMatchObject({
      args: { resources: { reports: ['a.rpt', 'b.rpt'] } },
    });
  });

  it.each([
    [['--resources'], 'Missing value for --resources'],
    [['--resources', '--clocks'], 'Missing value for --resources'],
    [['--capacity', 'flat.rpt'], '--capacity needs --resources'],
    [
      ['--resources', 'a.rpt', '--resources-color', 'lut'],
      "Unknown option '--resources-color' for 'render'",
    ],
  ])('rejects %j', (extra, message) => {
    expect(render(...extra)).toEqual({ kind: 'error', message });
  });

  it('refuses --resources for an .ip.yml', () => {
    expect(
      parseArgs(['render', 'a.ip.yml', '--out', 'a.svg', '--resources', 'a.rpt'])
    ).toMatchObject({ kind: 'error', message: expect.stringContaining('--resources') });
  });
});
