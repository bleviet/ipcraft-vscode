'use strict';

/**
 * Fixture fetcher for the real-world parser harness.
 *
 * Downloads `_hw.tcl` (Qsys/Platform Designer) and `component.xml` (IP-XACT)
 * files from public GitHub repositories and caches them under `.test-fixtures/`.
 * These files are used ONLY at test time to exercise the parsers against
 * real-world syntax. They are never committed (see `.gitignore` + the
 * pre-commit guard in `scripts/check-no-fixtures.sh`).
 *
 * Design notes (adapted to this repo):
 *   - Plain CommonJS, run with `node scripts/fetchFixtures.js`. No ts-node.
 *   - Uses Node 18+ native `fetch` (this repo targets Node 18+; CI runs newer).
 *     No external HTTP dependency.
 *   - Lists each repo's tree via the Git Trees API (one request per repo) and
 *     downloads matching blobs via raw.githubusercontent.com. This avoids the
 *     restrictive `/search/code` endpoint and works with a plain read token.
 *   - Idempotent: a file already present on disk is never re-downloaded.
 *   - GITHUB_TOKEN is optional but strongly recommended (60 req/h anonymous
 *     vs 5000 req/h authenticated).
 *
 * Environment variables:
 *   GITHUB_TOKEN          GitHub PAT (read-only/public is enough). Optional.
 *   SKIP_FETCH=1          Do not hit the network; only report what is cached.
 *   MAX_FILES_PER_REPO    Cap files fetched per repo (default 25).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_ROOT = path.join(ROOT, '.test-fixtures');

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const MAX_RETRIES = 3;
const MAX_FILES_PER_REPO = Number(process.env.MAX_FILES_PER_REPO || 25);

/** @type {{ kind: string, dir: string, match: (p: string) => boolean, repos: string[] }[]} */
const SOURCES = [
  {
    kind: 'hw_tcl',
    dir: path.join(FIXTURE_ROOT, 'hw_tcl'),
    match: (p) => p.endsWith('_hw.tcl'),
    repos: [
      'analogdevicesinc/hdl',
      'intel/supplemental-reset-components-for-qsys',
      'Nuand/bladeRF',
      'machinekit/mksocfpga',
    ],
  },
  {
    kind: 'component_xml',
    dir: path.join(FIXTURE_ROOT, 'component_xml'),
    match: (p) => p.endsWith('/component.xml') || p === 'component.xml',
    repos: [
      'Digilent/vivado-library',
      'Xilinx/axi_1wire_host-design',
      'jkorinth/chisel-packaging',
    ],
  },
];

function authHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ipcraft-fixture-fetcher',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with exponential backoff on rate limiting / transient errors.
 * Retries on 429, on 403 with exhausted rate limit, and on 5xx.
 */
async function fetchWithRetry(url, opts = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(url, opts);
    if (res.ok) {
      return res;
    }

    const remaining = res.headers.get('x-ratelimit-remaining');
    const rateLimited =
      res.status === 429 || (res.status === 403 && remaining === '0');
    const transient = res.status >= 500;

    if ((rateLimited || transient) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** attempt;
      attempt += 1;
      console.warn(
        `  rate-limited/transient (HTTP ${res.status}) on ${url} — ` +
          `retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`
      );
      await sleep(backoff);
      continue;
    }

    return res; // non-retryable, or retries exhausted — caller inspects status
  }
}

async function getDefaultBranch(owner, repo) {
  const res = await fetchWithRetry(`${API}/repos/${owner}/${repo}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`GET repo ${owner}/${repo} failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  return body.default_branch || 'master';
}

async function listTree(owner, repo, branch) {
  const res = await fetchWithRetry(
    `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`GET tree ${owner}/${repo}@${branch} failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  return (body.tree || []).filter((n) => n.type === 'blob').map((n) => n.path);
}

async function downloadRaw(owner, repo, branch, repoPath) {
  const url = `${RAW}/${owner}/${repo}/${branch}/${repoPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  const res = await fetchWithRetry(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`download ${repoPath} failed: HTTP ${res.status}`);
  }
  return res.text();
}

/** Local cache path: `<dir>/<owner>-<repo>/<sanitized repo path>`. */
function localPathFor(baseDir, owner, repo, repoPath) {
  const repoDir = `${owner}-${repo}`.replace(/[^\w.-]/g, '_');
  const safeRel = repoPath.replace(/[^\w./-]/g, '_');
  return path.join(baseDir, repoDir, safeRel);
}

/**
 * Fetch all configured fixtures. Returns a per-repo summary.
 * Safe to call from a Jest beforeAll hook. Respects SKIP_FETCH.
 *
 * @returns {Promise<{ repo: string, kind: string, fetched: number, cached: number, errors: number }[]>}
 */
async function fetchFixtures() {
  const summary = [];

  for (const source of SOURCES) {
    for (const fullRepo of source.repos) {
      const [owner, repo] = fullRepo.split('/');
      const row = { repo: fullRepo, kind: source.kind, fetched: 0, cached: 0, errors: 0 };

      if (process.env.SKIP_FETCH === '1') {
        row.cached = countCached(source.dir, owner, repo);
        summary.push(row);
        continue;
      }

      try {
        const branch = await getDefaultBranch(owner, repo);
        const paths = (await listTree(owner, repo, branch))
          .filter(source.match)
          .slice(0, MAX_FILES_PER_REPO);

        for (const repoPath of paths) {
          const dest = localPathFor(source.dir, owner, repo, repoPath);
          if (fs.existsSync(dest)) {
            row.cached += 1;
            continue;
          }
          try {
            const content = await downloadRaw(owner, repo, branch, repoPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, 'utf8');
            row.fetched += 1;
          } catch (err) {
            row.errors += 1;
            console.warn(`  ! ${fullRepo}/${repoPath}: ${err.message}`);
          }
        }
      } catch (err) {
        row.errors += 1;
        console.warn(`  ! ${fullRepo}: ${err.message}`);
      }

      summary.push(row);
    }
  }

  return summary;
}

function countCached(baseDir, owner, repo) {
  const repoDir = path.join(baseDir, `${owner}-${repo}`.replace(/[^\w.-]/g, '_'));
  if (!fs.existsSync(repoDir)) {
    return 0;
  }
  let count = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else {
        count += 1;
      }
    }
  };
  walk(repoDir);
  return count;
}

function printSummary(summary) {
  const width = Math.max(4, ...summary.map((r) => r.repo.length));
  const pad = (s, n) => String(s).padEnd(n);
  console.log('');
  console.log(
    `${pad('repo', width)}  ${pad('kind', 14)}  fetched  cached  errors`
  );
  console.log('-'.repeat(width + 14 + 27));
  for (const r of summary) {
    console.log(
      `${pad(r.repo, width)}  ${pad(r.kind, 14)}  ${pad(r.fetched, 7)}  ${pad(
        r.cached,
        6
      )}  ${r.errors}`
    );
  }
  const totals = summary.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      cached: acc.cached + r.cached,
      errors: acc.errors + r.errors,
    }),
    { fetched: 0, cached: 0, errors: 0 }
  );
  console.log('-'.repeat(width + 14 + 27));
  console.log(
    `${pad('TOTAL', width)}  ${pad('', 14)}  ${pad(totals.fetched, 7)}  ${pad(
      totals.cached,
      6
    )}  ${totals.errors}`
  );
  console.log('');
}

module.exports = { fetchFixtures, FIXTURE_ROOT, SOURCES };

// Run directly: `node scripts/fetchFixtures.js`
if (require.main === module) {
  if (process.env.SKIP_FETCH === '1') {
    console.log('SKIP_FETCH=1 — reporting cached fixtures only (no network).');
  } else if (!process.env.GITHUB_TOKEN) {
    console.warn(
      'GITHUB_TOKEN not set — using anonymous GitHub API (60 req/h). ' +
        'Set a token to avoid rate limiting.'
    );
  }
  fetchFixtures()
    .then((summary) => {
      printSummary(summary);
      const hadErrors = summary.some((r) => r.errors > 0);
      process.exit(hadErrors ? 1 : 0);
    })
    .catch((err) => {
      console.error('fetchFixtures failed:', err);
      process.exit(1);
    });
}
