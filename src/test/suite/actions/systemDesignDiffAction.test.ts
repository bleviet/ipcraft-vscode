import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
}

interface Action {
  inputs: Record<string, { default?: string; required?: boolean }>;
  outputs: Record<string, { value: string }>;
  runs: { using: string; steps: Step[] };
}

const actionPath = path.resolve(__dirname, '../../../../actions/system-design-diff/action.yml');
const actionText = fs.readFileSync(actionPath, 'utf8');
const action = yaml.load(actionText) as Action;
const runSteps = action.runs.steps.filter((step) => step.run !== undefined);

describe('system-design-diff action.yml', () => {
  it('is a composite action with the specified inputs', () => {
    expect(action.runs.using).toBe('composite');
    expect(Object.keys(action.inputs).sort()).toEqual(
      [
        'base',
        'cli',
        'comment',
        'designs',
        'fail-on',
        'github-token',
        'head',
        'ignore-version-only',
      ].sort()
    );
    expect(action.inputs.designs.required).toBe(true);
    expect(action.inputs.cli.required).toBe(true);
  });

  it('never puts an expression inside a run script', () => {
    expect(runSteps.length).toBeGreaterThan(0);
    for (const step of runSteps) {
      expect(step.run).not.toContain('${{');
    }
  });

  it('hands every input used by a run step over through env', () => {
    const used = new Set<string>();
    for (const step of runSteps) {
      for (const value of Object.values(step.env ?? {})) {
        for (const match of value.matchAll(/inputs\.([\w-]+)/g)) {
          used.add(match[1]);
        }
      }
    }
    expect([...used].sort()).toEqual(
      ['base', 'cli', 'designs', 'fail-on', 'github-token', 'head', 'ignore-version-only'].sort()
    );
    for (const name of used) {
      expect(Object.keys(action.inputs)).toContain(name);
    }
  });

  it('runs every script with bash', () => {
    for (const step of runSteps) {
      expect(step.shell).toBe('bash');
    }
  });

  it('declares the outputs and writes them from the diff step', () => {
    expect(Object.keys(action.outputs).sort()).toEqual(['failed', 'report-dir']);
    const diff = action.runs.steps.find((step) => step.id === 'diff');
    expect(diff?.run).toContain('echo "failed=$failed" >> "$GITHUB_OUTPUT"');
    expect(diff?.run).toContain('echo "report-dir=$REPORT_DIR" >> "$GITHUB_OUTPUT"');
    expect(action.outputs.failed.value).toBe('${{ steps.diff.outputs.failed }}');
    expect(action.outputs['report-dir'].value).toBe('${{ steps.diff.outputs.report-dir }}');
  });

  it('uses no npm package and no Node setup step', () => {
    expect(actionText).not.toContain('npx');
    expect(action.runs.steps.some((step) => step.uses !== undefined)).toBe(false);
  });

  it('posts the comment and fails the job even after a failed diff', () => {
    const names = action.runs.steps.map((step) => step.name);
    expect(names).toEqual([
      'Run ipcraft diff',
      'Post the pull request comment',
      'Fail when a run failed',
    ]);
    expect(action.runs.steps[1].if).toContain('!cancelled()');
    expect(action.runs.steps[2].if).toContain('!cancelled()');
  });
});

describe('system-design-diff run step under the GitHub bash options', () => {
  const diffRun = action.runs.steps.find((step) => step.id === 'diff')?.run ?? '';
  let dir: string;
  let stub: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-action-'));
    stub = path.join(dir, 'stub-cli.js');
    // Stand-in for `ipcraft`: `diff <design> ... --out <file>`; the design name picks the outcome.
    fs.writeFileSync(
      stub,
      `const a = process.argv.slice(2);
const design = a[1];
const out = a[a.indexOf('--out') + 1];
if (design === 'ok') { require('fs').writeFileSync(out, '## report ok\\n'); process.exit(0); }
if (design === 'chk') {
  require('fs').writeFileSync(out, '## report chk\\n');
  console.error('Diff check failed: 3 changes (--fail-on changes)');
  process.exit(1);
}
console.error('line1\\nline2 with \\\`tick\\\`');
process.exit(2);
`
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(env: Record<string, string>) {
    const out = path.join(dir, 'out');
    const summary = path.join(dir, 'summary');
    fs.writeFileSync(out, '');
    fs.writeFileSync(summary, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', diffRun], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: out,
        GITHUB_STEP_SUMMARY: summary,
        CLI: stub,
        BASE_REF: 'abc123',
        HEAD_REF: '',
        FAIL_ON: '',
        IGNORE_VERSION_ONLY: 'false',
        ...env,
      },
    });
    const outputs = Object.fromEntries(
      fs
        .readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
    );
    return { result, outputs, summary: fs.readFileSync(summary, 'utf8') };
  }

  it('runs every design after a failure and records one exit code per design', () => {
    const { result, outputs, summary } = run({ DESIGNS: 'chk\nbad ok' });

    expect(result.status).toBe(0);
    expect(outputs.failed).toBe('true');
    const reportDir = outputs['report-dir'];
    expect(path.dirname(reportDir)).toBe(dir);
    const read = (file: string) => fs.readFileSync(path.join(reportDir, file), 'utf8').trim();
    expect([1, 2, 3].map((n) => read(`${n}.exit`))).toEqual(['1', '2', '0']);
    expect(read('1.md')).toBe('## report chk');
    expect(fs.existsSync(path.join(reportDir, '2.md'))).toBe(false);
    expect(read('2.err')).toContain('line1');
    expect(read('3.md')).toBe('## report ok');

    expect(summary).toContain(
      '## report chk\n\n`Diff check failed: 3 changes (--fail-on changes)`\n'
    );
    expect(summary).toContain('## System design changes: bad');
    expect(summary).toContain(
      "exited with code 2 and wrote no report.\n\n```\nline1\nline2 with 'tick'\n```\n"
    );
    expect(summary).toContain('## report ok\n\n');
  });

  it('reports failed=false when every design passes', () => {
    const { result, outputs } = run({ DESIGNS: 'ok' });

    expect(result.status).toBe(0);
    expect(outputs.failed).toBe('false');
  });

  it('passes the options to the CLI only when they are set', () => {
    const argvStub = path.join(dir, 'argv-cli.js');
    fs.writeFileSync(
      argvStub,
      "const a = process.argv.slice(2); require('fs').writeFileSync(a[a.indexOf('--out') + 1], a.join(' '));"
    );
    const { outputs } = run({
      DESIGNS: 'x.bd',
      CLI: argvStub,
      HEAD_REF: 'feature',
      FAIL_ON: 'changes',
      IGNORE_VERSION_ONLY: 'true',
    });

    const report = fs.readFileSync(path.join(outputs['report-dir'], '1.md'), 'utf8');
    expect(report).toMatch(
      /^diff x\.bd --base abc123 --out \S+ --head feature --ignore-version-only --fail-on changes$/
    );
  });

  it('fails early without a base', () => {
    const { result, outputs } = run({ DESIGNS: 'ok', BASE_REF: '' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::Set the base input');
    expect(outputs['report-dir']).toBeUndefined();
  });

  it('fails early when the cli is not a file', () => {
    const { result } = run({ DESIGNS: 'ok', CLI: path.join(dir, 'missing.js') });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::The cli input is not a file');
  });

  it('gives each run its own report folder', () => {
    const first = run({ DESIGNS: 'ok' }).outputs['report-dir'];
    const second = run({ DESIGNS: 'ok' }).outputs['report-dir'];

    expect(first).not.toBe(second);
    expect(fs.existsSync(first)).toBe(true);
  });
});
