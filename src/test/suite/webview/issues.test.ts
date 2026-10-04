import type { IpcraftIssue } from '../../../shared/issues';
import {
  deduplicateAndOrderIssues,
  issueKey,
  issuesToCanvasAnnotations,
} from '../../../webview/ipcore/types/issues';

const issue = (partial: Partial<IpcraftIssue>): IpcraftIssue => ({
  code: 'TEST',
  severity: 'warning',
  source: 'protocol',
  path: [],
  message: 'test',
  ...partial,
});

describe('unified issue projections', () => {
  it('maps a bus issue to its bundle and a logical width issue to bundle plus subport', () => {
    const annotations = issuesToCanvasAnnotations([
      issue({ path: ['busInterfaces', 1] }),
      issue({
        code: 'EMPTY_WIDTH',
        path: ['busInterfaces', 1, 'portWidthOverrides', 'empty'],
      }),
    ]);

    expect(annotations['bus:1']).toHaveLength(2);
    expect(annotations['bus:1:empty']).toEqual([expect.objectContaining({ severity: 'warning' })]);
  });

  it('deduplicates by source, code, and array path while preserving group order', () => {
    const protocol = issue({ code: 'P', source: 'protocol', path: ['busInterfaces', 0] });
    const ordered = deduplicateAndOrderIssues([
      issue({ code: 'V', source: 'componentXml' }),
      protocol,
      issue({ code: 'S', source: 'schema' }),
      { ...protocol, message: 'duplicate text' },
      issue({ code: 'R', source: 'references' }),
      issue({ code: 'H', source: 'hdl' }),
    ]);

    expect(ordered.map((item) => item.source)).toEqual([
      'schema',
      'protocol',
      'references',
      'hdl',
      'componentXml',
    ]);
    expect(issueKey(protocol)).toBe('protocol|P|["busInterfaces",0]');
  });
});
