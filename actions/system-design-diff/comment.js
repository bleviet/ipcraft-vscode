'use strict';

// Composes the pull request comment from the `ipcraft diff` reports and posts
// it, updating the comment of a previous run. Plain Node 20, no dependencies.

const fs = require('fs');
const path = require('path');

const MARKER = '<!-- ipcraft-system-design-diff -->';
const MAX_COMMENT_LENGTH = 65536;
const TRUNCATION_NOTE =
  '\n\n_The report was cut to fit the size limit of a comment. The job summary has the full report._';
const PAGE_SIZE = 100;

const plain = (text) => text.trim().replace(/`/g, "'");

function section({ design, markdown, exitCode, stderr = '' }) {
  const lines = plain(stderr).split('\n').filter(Boolean);
  if (markdown.trim()) {
    const reason = exitCode !== 0 && lines.length > 0 ? `\n\n\`${lines[lines.length - 1]}\`` : '';
    return markdown.trim() + reason;
  }
  const tail = lines.length > 0 ? `\n\n\`\`\`\n${lines.slice(-5).join('\n')}\n\`\`\`` : '';
  return `## System design changes: ${design}\n\n\`ipcraft diff\` exited with code ${exitCode} and wrote no report.${tail}`;
}

/** @param {{ design: string, markdown: string, exitCode: number, stderr?: string }[]} reports */
function composeComment(reports) {
  const body = [MARKER, ...reports.map(section)].join('\n\n');
  if (body.length <= MAX_COMMENT_LENGTH) {
    return body;
  }
  let end = MAX_COMMENT_LENGTH - TRUNCATION_NOTE.length;
  const last = body.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end--; // do not split a surrogate pair
  }
  return body.slice(0, end) + TRUNCATION_NOTE;
}

/**
 * Updates the comment of the pull request that starts with the marker, or
 * creates it. Throws when the API answers with an error status.
 * @param {{ token: string, repo: string, issueNumber: number, body: string, fetchImpl?: typeof fetch, apiUrl?: string }} options
 */
async function upsertComment({
  token,
  repo,
  issueNumber,
  body,
  fetchImpl = fetch,
  apiUrl = 'https://api.github.com',
}) {
  const request = async (method, url, payload) => {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ipcraft-system-design-diff',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${method} ${url} failed with status ${response.status}`);
    }
    return response.json();
  };

  const commentsUrl = `${apiUrl}/repos/${repo}/issues/${issueNumber}/comments`;
  for (let page = 1; ; page++) {
    const comments = await request('GET', `${commentsUrl}?per_page=${PAGE_SIZE}&page=${page}`);
    const existing = comments.find((comment) => comment.body?.startsWith(MARKER));
    if (existing) {
      await request('PATCH', `${apiUrl}/repos/${repo}/issues/comments/${existing.id}`, { body });
      return { action: 'updated', id: existing.id };
    }
    if (comments.length < PAGE_SIZE) {
      break;
    }
  }
  const created = await request('POST', commentsUrl, { body });
  return { action: 'created', id: created.id };
}

function readReports(reportDir, designs) {
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(reportDir, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  return designs.map((design, index) => {
    const exitCode = Number.parseInt(read(`${index + 1}.exit`) ?? '', 10);
    return {
      design,
      markdown: read(`${index + 1}.md`) ?? '',
      stderr: read(`${index + 1}.err`) ?? '',
      exitCode: Number.isNaN(exitCode) ? 1 : exitCode,
    };
  });
}

async function main() {
  const env = process.env;
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const issueNumber = event.pull_request?.number;
  if (!issueNumber) {
    console.log('Not a pull request: no comment posted.');
    return;
  }
  const designs = (env.DESIGNS ?? '').split(/\s+/).filter(Boolean);
  const body = composeComment(readReports(env.REPORT_DIR, designs));
  try {
    const result = await upsertComment({
      token: env.GITHUB_TOKEN,
      repo: env.GITHUB_REPOSITORY,
      issueNumber,
      body,
      apiUrl: env.GITHUB_API_URL || undefined,
    });
    console.log(`Comment ${result.action} (${result.id}).`);
  } catch (error) {
    // A pull request from a fork has a read-only token: the report stays in the job summary.
    console.log(`::warning::Could not post the comment: ${error.message}`);
  }
}

module.exports = { composeComment, upsertComment, readReports, main, MARKER };

if (require.main === module) {
  main();
}
