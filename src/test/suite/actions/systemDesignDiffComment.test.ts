import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  composeComment,
  upsertComment,
  readReports,
  main,
  MARKER,
} from '../../../../actions/system-design-diff/comment';

interface FakeComment {
  id: number;
  body: string;
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fetch double that serves `comments` page by page and records every call. */
function fakeGithub(comments: FakeComment[], failWith?: number) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const status = failWith ?? 200;
    const json = async (): Promise<unknown> => {
      if (init.method === 'GET') {
        const page = Number(new URL(url).searchParams.get('page'));
        return comments.slice((page - 1) * 100, page * 100);
      }
      return { id: 999 };
    };
    return { ok: status < 400, status, json };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const options = {
  token: 'secret-token',
  repo: 'owner/repo',
  issueNumber: 7,
  body: `${MARKER}\n\nreport`,
};

describe('composeComment', () => {
  it('starts with the hidden marker line', () => {
    const body = composeComment([{ design: 'a.bd', markdown: '## Changes: a', exitCode: 0 }]);
    expect(body.split('\n')[0]).toBe('<!-- ipcraft-system-design-diff -->');
    expect(body).toContain('## Changes: a');
  });

  it('keeps the reports of several designs in order', () => {
    const body = composeComment([
      { design: 'a.bd', markdown: '## Changes: a\n', exitCode: 0 },
      { design: 'b.qsys', markdown: '## Changes: b\n', exitCode: 1 },
    ]);
    expect(body.indexOf('## Changes: a')).toBeGreaterThan(body.indexOf(MARKER));
    expect(body.indexOf('## Changes: b')).toBeGreaterThan(body.indexOf('## Changes: a'));
  });

  it('says so for a run that failed without a report', () => {
    const body = composeComment([
      { design: 'a.bd', markdown: '## Changes: a', exitCode: 0 },
      { design: 'missing.bd', markdown: '', exitCode: 1 },
    ]);
    expect(body).toContain('missing.bd');
    expect(body).toContain('## System design changes: missing.bd');
    expect(body).toContain('exited with code 1 and wrote no report');
  });

  it('shows the last lines of stderr in a fenced block for a run without a report', () => {
    const stderr = ['a', 'b', 'c', 'd', 'e', 'f', 'g with `tick`'].join('\n');
    const body = composeComment([{ design: 'x.bd', markdown: '', exitCode: 2, stderr }]);
    expect(body).toContain("```\nc\nd\ne\nf\ng with 'tick'\n```");
    expect(body).not.toContain('\nb\n');
  });

  it('adds the reason after a report whose run failed its check', () => {
    const body = composeComment([
      {
        design: 'x.bd',
        markdown: '## Changes: x\n',
        exitCode: 1,
        stderr: 'Image failed: boom\nDiff check failed: 3 changes (--fail-on changes)\n',
      },
      { design: 'y.bd', markdown: '## Changes: y\n', exitCode: 0, stderr: 'warning' },
    ]);
    expect(body).toContain(
      '## Changes: x\n\n`Diff check failed: 3 changes (--fail-on changes)`\n\n## Changes: y'
    );
    expect(body).not.toContain('Image failed');
    expect(body).not.toContain('warning');
  });

  it('truncates a body over the comment limit and keeps the marker and a note', () => {
    const body = composeComment([{ design: 'a.bd', markdown: 'x'.repeat(70000), exitCode: 0 }]);
    expect(body.length).toBeLessThanOrEqual(65536);
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('cut to fit the size limit');
  });

  it('does not split a surrogate pair when it truncates', () => {
    for (const offset of [0, 1]) {
      const markdown = 'x'.repeat(65000 + offset) + '\u{1F600}'.repeat(2000);
      const body = composeComment([{ design: 'a.bd', markdown, exitCode: 0 }]);
      const note = body.indexOf('\n\n_The report was cut');
      const kept = body.slice(0, note);
      const last = kept.charCodeAt(kept.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(body.length).toBeLessThanOrEqual(65536);
    }
  });

  it('leaves a body under the limit untouched', () => {
    const body = composeComment([{ design: 'a.bd', markdown: 'x'.repeat(1000), exitCode: 0 }]);
    expect(body).not.toContain('cut to fit');
  });
});

describe('upsertComment', () => {
  it('updates the marked comment found on page 2', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: `other ${i}` }));
    const comments = [...page1, { id: 500, body: `${MARKER}\n\nold` }];
    const { calls, fetchImpl } = fakeGithub(comments);

    const result = await upsertComment({ ...options, fetchImpl });

    expect(result).toEqual({ action: 'updated', id: 500 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.github.com/repos/owner/repo/issues/7/comments?per_page=100&page=1',
      'GET https://api.github.com/repos/owner/repo/issues/7/comments?per_page=100&page=2',
      'PATCH https://api.github.com/repos/owner/repo/issues/comments/500',
    ]);
    expect(JSON.parse(calls[2].body ?? '')).toEqual({ body: options.body });
  });

  it('posts a new comment when none starts with the marker', async () => {
    const { calls, fetchImpl } = fakeGithub([{ id: 1, body: `quoted ${MARKER}` }]);

    const result = await upsertComment({ ...options, fetchImpl });

    expect(result).toEqual({ action: 'created', id: 999 });
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toBe('https://api.github.com/repos/owner/repo/issues/7/comments');
    expect(JSON.parse(calls[1].body ?? '')).toEqual({ body: options.body });
  });

  it('sends the token as a bearer header and honours a custom API URL', async () => {
    const { calls, fetchImpl } = fakeGithub([]);

    await upsertComment({ ...options, fetchImpl, apiUrl: 'https://ghe.example/api/v3' });

    for (const call of calls) {
      expect(call.headers.Authorization).toBe('Bearer secret-token');
      expect(call.url.startsWith('https://ghe.example/api/v3/repos/owner/repo/')).toBe(true);
    }
  });

  it('throws with the status when the API answers with an error', async () => {
    const { fetchImpl } = fakeGithub([], 403);

    await expect(upsertComment({ ...options, fetchImpl })).rejects.toThrow('status 403');
  });
});

describe('readReports and main', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-comment-'));
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the report, exit code and stderr of each design in order', () => {
    fs.writeFileSync(path.join(dir, '1.md'), '## one');
    fs.writeFileSync(path.join(dir, '1.exit'), '0\n');
    fs.writeFileSync(path.join(dir, '2.exit'), '2\n');
    fs.writeFileSync(path.join(dir, '2.err'), 'boom\n');

    expect(readReports(dir, ['a.bd', 'b.bd'])).toEqual([
      { design: 'a.bd', markdown: '## one', exitCode: 0, stderr: '' },
      { design: 'b.bd', markdown: '', exitCode: 2, stderr: 'boom\n' },
    ]);
  });

  it('counts a missing exit file as 1', () => {
    expect(readReports(dir, ['a.bd'])[0].exitCode).toBe(1);
  });

  it('posts nothing for an event that is not a pull request', async () => {
    const fetchMock = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ ref: 'refs/heads/main' }));
    process.env.GITHUB_EVENT_PATH = event;
    process.env.REPORT_DIR = dir;
    process.env.DESIGNS = 'a.bd';

    await main();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the composed comment for a pull request and survives an API error', async () => {
    const calls: string[] = [];
    const respond = (status: number) =>
      jest.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`);
        return { ok: status < 400, status, json: async () => [] };
      });
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 12 } }));
    fs.writeFileSync(path.join(dir, '1.md'), '## one');
    fs.writeFileSync(path.join(dir, '1.exit'), '0');
    Object.assign(process.env, {
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 't',
      REPORT_DIR: dir,
      DESIGNS: 'a.bd',
    });

    (global as unknown as { fetch: unknown }).fetch = respond(200);
    await main();
    expect(calls).toEqual([
      'GET https://api.github.com/repos/o/r/issues/12/comments?per_page=100&page=1',
      'POST https://api.github.com/repos/o/r/issues/12/comments',
    ]);

    (global as unknown as { fetch: unknown }).fetch = respond(403);
    await expect(main()).resolves.toBeUndefined();
  });
});
