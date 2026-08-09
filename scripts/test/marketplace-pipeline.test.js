const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');

const workflowPath = path.resolve(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'marketplace-release.yml'
);
const workflow = parse(fs.readFileSync(workflowPath, 'utf8'));
const githubCiPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
const githubCi = parse(fs.readFileSync(githubCiPath, 'utf8'));

function job(name) {
  const result = workflow.jobs[name];
  assert.ok(result, `missing ${name} job`);
  return result;
}

function usesStep(steps, uses) {
  const result = steps.find((step) => step.uses === uses);
  assert.ok(result, `missing ${uses} step`);
  return result;
}

function assertOrderedSteps(steps, orderedSteps) {
  const indexes = orderedSteps.map((step) => steps.indexOf(step));
  assert.equal(
    indexes.every((index) => index >= 0),
    true,
    'an ordered step is missing'
  );
  assert.deepEqual(
    indexes,
    [...indexes].sort((left, right) => left - right)
  );
}

function assertFailFastPrologue(step, label) {
  assert.equal(
    step.run.split('\n')[0],
    'set -euo pipefail',
    `${label} must fail fast and propagate piped command failures`
  );
}

function assertArtifactConsumer(steps) {
  assert.deepEqual(usesStep(steps, 'actions/download-artifact@v4').with, {
    name: 'ipcraft-vscode-vsix',
    path: 'artifacts',
  });

  const checksum = steps.find((step) => step.name === 'Verify release artifact checksum');
  assert.ok(checksum, 'missing artifact checksum verification');
  assert.equal(checksum['working-directory'], 'artifacts');
  assert.equal(
    checksum.run,
    'sha256sum --check "ipcraft-vscode-${{ needs.verify.outputs.release-version }}.vsix.sha256"'
  );
}

function assertCommonSetup(steps) {
  assert.deepEqual(steps[0], {
    uses: 'actions/checkout@v4',
    with: { submodules: 'recursive' },
  });
  assert.deepEqual(usesStep(steps, 'actions/setup-node@v4').with, {
    'node-version': 20,
    cache: 'npm',
  });
  assert.ok(
    steps.some((step) => step.run === 'npm ci'),
    'missing pinned dependency install'
  );
}

describe('GitHub CI release contract', () => {
  it('runs release contract tests in the test job after the build', () => {
    const steps = githubCi.jobs.test.steps;
    const build = steps.find((step) => step.name === 'Build');
    const releaseTests = steps.find((step) => step.name === 'Release contract tests');

    assert.ok(releaseTests, 'missing release contract tests in the GitHub CI test job');
    assert.equal(releaseTests.run, 'npm run test:release');
    assertOrderedSteps(steps, [build, releaseTests]);
  });
});

describe('Marketplace release workflow', () => {
  it('is manual, dry-run by default, serialized, and uses the protected job graph', () => {
    assert.deepEqual(workflow.on, {
      workflow_dispatch: {
        inputs: {
          publish: {
            description: 'Publish to the VS Code Marketplace after verification',
            type: 'boolean',
            default: false,
          },
        },
      },
    });
    assert.deepEqual(workflow.concurrency, {
      group: 'marketplace-release',
      'cancel-in-progress': false,
    });
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(Object.keys(workflow.jobs), ['verify', 'smoke', 'publish', 'postpublish']);

    assert.equal(job('verify').needs, undefined);
    assert.equal(job('smoke').needs, 'verify');
    assert.deepEqual(job('publish').needs, ['verify', 'smoke']);
    assert.equal(job('publish').if, '${{ success() && inputs.publish }}');
    assert.deepEqual(job('postpublish').needs, ['verify', 'publish']);
    assert.equal(job('postpublish').if, undefined);
  });

  it('verifies the repository, packages once, and publishes the checksummed artifact', () => {
    const verify = job('verify');
    const steps = verify.steps;

    assert.deepEqual(steps[0], {
      uses: 'actions/checkout@v4',
      with: { submodules: 'recursive', 'fetch-depth': 0, 'fetch-tags': true },
    });
    assert.deepEqual(usesStep(steps, 'actions/setup-node@v4').with, {
      'node-version': 20,
      cache: 'npm',
    });

    const runs = steps
      .filter((step) => step.run && !step.run.includes('\n'))
      .map((step) => step.run);
    assert.deepEqual(runs.slice(0, 10), [
      'npm ci',
      'npm run check:marketplace-release',
      'npm run docs:links',
      'npm run lint',
      'npm run type-check',
      'npm run compile',
      'npm run compile-tests',
      'npm run check:cli-distribution',
      'npm run test:cli-package',
      'npm run test:unit -- --coverage',
    ]);

    const contractStep = steps.find((step) => step.run === 'npm run check:marketplace-release');
    assert.deepEqual(contractStep.env, { BUILD_SOURCEBRANCH: '${{ github.ref }}' });

    const releaseTests = steps.find((step) => step.run === 'npm run test:release');
    assert.equal(releaseTests.name, 'Release contract tests');

    const packageStep = steps.find((step) => step.id === 'release');
    assert.ok(packageStep, 'missing release output step');
    assertFailFastPrologue(packageStep, 'package step');
    assert.match(packageStep.run, /RELEASE_VERSION="\$\{GITHUB_REF#refs\/tags\/v\}"/);
    assert.match(
      packageStep.run,
      /VSIX_PATH="artifacts\/ipcraft-vscode-\$\{RELEASE_VERSION\}\.vsix"/
    );
    assertOrderedSteps(steps, [releaseTests, packageStep]);
    assert.match(packageStep.run, /npx vsce package "\$RELEASE_VERSION" --out "\$VSIX_PATH"/);
    assert.match(packageStep.run, /npm run check:vsix -- "\$VSIX_PATH"/);
    assert.match(
      packageStep.run,
      /sha256sum "ipcraft-vscode-\$\{RELEASE_VERSION\}\.vsix" > "ipcraft-vscode-\$\{RELEASE_VERSION\}\.vsix\.sha256"/
    );
    assert.match(packageStep.run, /echo "release-version=\$RELEASE_VERSION" >> "\$GITHUB_OUTPUT"/);

    const artifactPublisher = usesStep(steps, 'actions/upload-artifact@v4');
    assert.deepEqual(artifactPublisher.with, {
      name: 'ipcraft-vscode-vsix',
      path: 'artifacts/',
      'if-no-files-found': 'error',
      'retention-days': 14,
    });
    assertOrderedSteps(steps, [packageStep, artifactPublisher]);

    assert.deepEqual(verify.outputs, {
      'release-version': '${{ steps.release.outputs.release-version }}',
    });

    const allRunCommands = Object.values(workflow.jobs).flatMap((candidate) =>
      candidate.steps.map((step) => step.run).filter(Boolean)
    );
    assert.equal(
      allRunCommands.filter((command) => /\bnpx vsce package\b/.test(command)).length,
      1
    );
  });

  it('smoke-tests the same artifact against minimum and stable VS Code', () => {
    const smoke = job('smoke');
    assert.deepEqual(
      smoke.strategy.matrix.include.map((entry) => entry['vscode-version']),
      ['1.80.0', 'stable']
    );

    for (const steps of [smoke.steps]) {
      assertCommonSetup(steps);
      assertArtifactConsumer(steps);
    }

    const steps = smoke.steps;
    const install = steps.find((step) => step.run === 'npm ci');
    const download = usesStep(steps, 'actions/download-artifact@v4');
    const checksum = steps.find((step) => step.name === 'Verify release artifact checksum');
    const compatibility = steps.find((step) => step.run === 'npm run check:vscode-compatibility');
    const compile = steps.find((step) => step.run === 'npm run compile-tests');
    const e2e = steps.find((step) => step.run === 'xvfb-run -a npm run test:e2e');
    assert.ok(e2e, 'missing smoke E2E execution');
    assertOrderedSteps(steps, [install, download, checksum, compatibility, compile, e2e]);
    assert.deepEqual(e2e.env, {
      VSCODE_TEST_VERSION: '${{ matrix.vscode-version }}',
      VSIX_PATH: 'artifacts/ipcraft-vscode-${{ needs.verify.outputs.release-version }}.vsix',
    });
  });

  it('publishes the verified artifact through the protected, passwordless Azure deployment', () => {
    const publish = job('publish');
    assert.equal(publish.environment, 'vscode-marketplace');
    assert.deepEqual(publish.permissions, { contents: 'read', 'id-token': 'write' });
    const steps = publish.steps;
    assertCommonSetup(steps);
    assertArtifactConsumer(steps);

    const login = usesStep(steps, 'azure/login@v2');
    assert.deepEqual(login.with, {
      'client-id': '${{ secrets.AZURE_CLIENT_ID }}',
      'tenant-id': '${{ secrets.AZURE_TENANT_ID }}',
      'subscription-id': '${{ secrets.AZURE_SUBSCRIPTION_ID }}',
    });

    const publishStep = steps.find((step) => step.name === 'Publish verified VSIX');
    assert.deepEqual(publishStep.env, {
      VSIX_PATH: 'artifacts/ipcraft-vscode-${{ needs.verify.outputs.release-version }}.vsix',
    });
    assert.equal(publishStep.run, 'npx vsce publish --packagePath "$VSIX_PATH" --azure-credential');
    assertOrderedSteps(steps, [
      steps.find((step) => step.run === 'npm ci'),
      usesStep(steps, 'actions/download-artifact@v4'),
      steps.find((step) => step.name === 'Verify release artifact checksum'),
      login,
      publishStep,
    ]);

    const allCommands = Object.values(workflow.jobs).flatMap((candidate) =>
      candidate.steps.map((step) => step.run).filter(Boolean)
    );
    assert.equal(
      allCommands.some((command) => command.includes('--skip-duplicate')),
      false
    );
  });

  it('downloads, verifies, and smoke-tests the Marketplace copy with diagnostics', () => {
    const postPublish = job('postpublish');
    const steps = postPublish.steps;
    assertCommonSetup(steps);
    assert.ok(steps.some((step) => step.run === 'npm run compile-tests'));

    const verifier = steps.find((step) => step.name === 'Download and verify Marketplace VSIX');
    assert.ok(verifier, 'missing post-publish Marketplace verifier');
    assertFailFastPrologue(verifier, 'Marketplace verifier');
    assert.deepEqual(verifier.env, {
      RELEASE_VERSION: '${{ needs.verify.outputs.release-version }}',
    });
    assert.match(
      verifier.run,
      /npm run verify:marketplace-release -- \\\s*\n\s+--version "\$RELEASE_VERSION" \\\s*\n\s+--out "marketplace-verification\/ipcraft-vscode-\$RELEASE_VERSION\.vsix"/
    );
    assert.match(verifier.run, /tee marketplace-verification\/marketplace-verification\.log/);

    const e2e = steps.find((step) => step.name === 'Smoke-test published Marketplace VSIX');
    assert.ok(e2e, 'missing post-publish E2E execution');
    assertFailFastPrologue(e2e, 'Marketplace E2E smoke test');
    assert.match(e2e.run, /tee marketplace-verification\/marketplace-e2e\.log/);
    assert.deepEqual(e2e.env, {
      VSCODE_TEST_VERSION: 'stable',
      VSIX_PATH:
        'marketplace-verification/ipcraft-vscode-${{ needs.verify.outputs.release-version }}.vsix',
    });

    const diagnostics = usesStep(steps, 'actions/upload-artifact@v4');
    assert.equal(diagnostics.if, 'always()');
    assert.deepEqual(diagnostics.with, {
      name: 'marketplace-release-diagnostics',
      path: 'marketplace-verification/',
      'retention-days': 14,
    });
    assertOrderedSteps(steps, [
      steps.find((step) => step.run === 'npm ci'),
      steps.find((step) => step.run === 'npm run compile-tests'),
      verifier,
      e2e,
      diagnostics,
    ]);
  });
});
