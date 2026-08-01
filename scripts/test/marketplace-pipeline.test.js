const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');

const pipelinePath = path.resolve(
  __dirname,
  '..',
  '..',
  'azure-pipelines',
  'marketplace-release.yml'
);
const pipeline = parse(fs.readFileSync(pipelinePath, 'utf8'));
const githubWorkflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
const githubWorkflow = parse(fs.readFileSync(githubWorkflowPath, 'utf8'));

function stage(name) {
  const result = pipeline.stages.find((candidate) => candidate.stage === name);
  assert.ok(result, `missing ${name} stage`);
  return result;
}

function jobSteps(job) {
  return job.steps ?? job.strategy?.runOnce?.deploy?.steps ?? [];
}

function allStageSteps(pipelineStage) {
  return pipelineStage.jobs.flatMap(jobSteps);
}

function stepCommand(step) {
  return step.script ?? step.inputs?.inlineScript ?? '';
}

function taskStep(steps, taskName) {
  const result = steps.find((step) => step.task === taskName);
  assert.ok(result, `missing ${taskName} step`);
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
    stepCommand(step).split('\n')[0],
    'set -euo pipefail',
    `${label} must fail fast and propagate piped command failures`
  );
}

function assertArtifactConsumer(steps) {
  assert.deepEqual(taskStep(steps, 'DownloadPipelineArtifact@2').inputs, {
    buildType: 'current',
    artifactName: 'ipcraft-vscode-vsix',
    targetPath: '$(Pipeline.Workspace)/ipcraft-vscode-vsix',
  });

  const checksum = steps.find((step) => stepCommand(step).includes('sha256sum --check'));
  assert.ok(checksum, 'missing artifact checksum verification');
  assert.equal(checksum.workingDirectory, '$(Pipeline.Workspace)/ipcraft-vscode-vsix');
  assert.equal(checksum.script, 'sha256sum --check "ipcraft-vscode-$(releaseVersion).vsix.sha256"');
}

function assertCommonSetup(steps) {
  assert.deepEqual(steps[0], { checkout: 'self', submodules: 'recursive' });
  assert.deepEqual(taskStep(steps, 'NodeTool@0').inputs, { versionSpec: '20.x' });
  assert.ok(
    steps.some((step) => step.script === 'npm ci'),
    'missing pinned dependency install'
  );
}

describe('GitHub CI release contract', () => {
  it('runs release contract tests in the test job after the build', () => {
    const steps = githubWorkflow.jobs.test.steps;
    const build = steps.find((step) => step.name === 'Build');
    const releaseTests = steps.find((step) => step.name === 'Release contract tests');

    assert.ok(releaseTests, 'missing release contract tests in the GitHub CI test job');
    assert.equal(releaseTests.run, 'npm run test:release');
    assertOrderedSteps(steps, [build, releaseTests]);
  });
});

describe('Marketplace release pipeline', () => {
  it('is manual, dry-run by default, and uses the protected stage graph', () => {
    assert.equal(pipeline.trigger, 'none');
    assert.equal(pipeline.pr, 'none');
    assert.deepEqual(pipeline.parameters, [
      {
        name: 'publish',
        displayName: 'Publish after verification',
        type: 'boolean',
        default: false,
      },
    ]);
    assert.deepEqual(pipeline.pool, { vmImage: 'ubuntu-latest' });
    assert.deepEqual(
      pipeline.stages.map((pipelineStage) => pipelineStage.stage),
      ['Verify', 'Smoke', 'Publish', 'PostPublish']
    );

    assert.equal(stage('Verify').dependsOn, undefined);
    assert.deepEqual(stage('Smoke').dependsOn, ['Verify']);
    assert.equal(stage('Smoke').condition, 'succeeded()');
    assert.deepEqual(stage('Publish').dependsOn, ['Verify', 'Smoke']);
    assert.equal(
      stage('Publish').condition,
      'and(succeeded(), ${{ eq(parameters.publish, true) }})'
    );
    assert.deepEqual(stage('PostPublish').dependsOn, ['Verify', 'Publish']);
    assert.equal(stage('PostPublish').condition, 'succeeded()');
  });

  it('verifies the repository, packages once, and publishes the checksummed artifact', () => {
    const verify = stage('Verify');
    assert.equal(verify.jobs.length, 1);
    const packageJob = verify.jobs[0];
    assert.equal(packageJob.job, 'Package');
    const steps = jobSteps(packageJob);

    assert.deepEqual(steps[0], {
      checkout: 'self',
      submodules: 'recursive',
      fetchDepth: 0,
      fetchTags: true,
    });
    assert.deepEqual(taskStep(steps, 'NodeTool@0').inputs, { versionSpec: '20.x' });

    const scripts = steps.filter((step) => step.script).map((step) => step.script);
    assert.deepEqual(scripts.slice(0, 11), [
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
      'npm run test:release',
    ]);

    const releaseTests = steps.find((step) => step.script === 'npm run test:release');
    assert.equal(releaseTests.displayName, 'Run release contract tests');

    const packageStep = steps.find((step) => step.name === 'release');
    assert.ok(packageStep, 'missing release output step');
    assertFailFastPrologue(packageStep, 'package step');
    assert.match(packageStep.script, /RELEASE_VERSION="\$\{BUILD_SOURCEBRANCH#refs\/tags\/v\}"/);
    assert.match(
      packageStep.script,
      /VSIX_PATH="\$\(Build\.ArtifactStagingDirectory\)\/ipcraft-vscode-\$\{RELEASE_VERSION\}\.vsix"/
    );
    assertOrderedSteps(steps, [releaseTests, packageStep]);
    assert.match(packageStep.script, /npx vsce package "\$RELEASE_VERSION" --out "\$VSIX_PATH"/);
    assert.match(packageStep.script, /npm run check:vsix -- "\$VSIX_PATH"/);
    assert.match(
      packageStep.script,
      /sha256sum "ipcraft-vscode-\$\{RELEASE_VERSION\}\.vsix" > "ipcraft-vscode-\$\{RELEASE_VERSION\}\.vsix\.sha256"/
    );
    assert.match(
      packageStep.script,
      /##vso\[task\.setvariable variable=releaseVersion;isOutput=true\]\$RELEASE_VERSION/
    );

    const artifactPublisher = taskStep(steps, 'PublishPipelineArtifact@1');
    assert.deepEqual(artifactPublisher.inputs, {
      targetPath: '$(Build.ArtifactStagingDirectory)',
      artifact: 'ipcraft-vscode-vsix',
      publishLocation: 'pipeline',
    });
    assertOrderedSteps(steps, [packageStep, artifactPublisher]);

    const packagingSteps = pipeline.stages.flatMap((pipelineStage) =>
      allStageSteps(pipelineStage)
        .filter((step) => /\bnpx vsce package\b/.test(stepCommand(step)))
        .map(() => pipelineStage.stage)
    );
    assert.deepEqual(packagingSteps, ['Verify']);
  });

  it('smoke-tests the same artifact against minimum and stable VS Code', () => {
    const smoke = stage('Smoke');
    assert.equal(
      smoke.variables.releaseVersion,
      "$[ stageDependencies.Verify.Package.outputs['release.releaseVersion'] ]"
    );
    assert.equal(smoke.jobs.length, 2);

    const environments = smoke.jobs.map((job) => {
      const steps = jobSteps(job);
      assertCommonSetup(steps);
      assertArtifactConsumer(steps);
      const install = steps.find((step) => step.script === 'npm ci');
      const download = taskStep(steps, 'DownloadPipelineArtifact@2');
      const checksum = steps.find((step) => stepCommand(step).includes('sha256sum --check'));
      const compatibility = steps.find(
        (step) => step.script === 'npm run check:vscode-compatibility'
      );
      const compile = steps.find((step) => step.script === 'npm run compile-tests');
      const e2e = steps.find((step) => step.script === 'xvfb-run -a npm run test:e2e');
      assert.ok(e2e, 'missing smoke E2E execution');
      assertOrderedSteps(steps, [install, download, checksum, compatibility, compile, e2e]);
      assert.equal(
        e2e.env.VSIX_PATH,
        '$(Pipeline.Workspace)/ipcraft-vscode-vsix/ipcraft-vscode-$(releaseVersion).vsix'
      );
      return e2e.env.VSCODE_TEST_VERSION;
    });

    assert.deepEqual(environments, ['1.80.0', 'stable']);
  });

  it('publishes the verified artifact through the protected Azure deployment', () => {
    const publish = stage('Publish');
    assert.equal(
      publish.variables.releaseVersion,
      "$[ stageDependencies.Verify.Package.outputs['release.releaseVersion'] ]"
    );
    assert.equal(publish.jobs.length, 1);
    const deployment = publish.jobs[0];
    assert.ok(deployment.deployment, 'publish job must be a deployment');
    assert.equal(deployment.environment, 'vscode-marketplace');
    const steps = jobSteps(deployment);
    assertCommonSetup(steps);
    assertArtifactConsumer(steps);

    const azureCli = taskStep(steps, 'AzureCLI@2');
    assert.deepEqual(azureCli.inputs, {
      azureSubscription: 'vscode-marketplace-entra',
      scriptType: 'bash',
      scriptLocation: 'inlineScript',
      inlineScript: 'npx vsce publish --packagePath "$VSIX_PATH" --azure-credential',
    });
    assert.deepEqual(azureCli.env, {
      VSIX_PATH: '$(Pipeline.Workspace)/ipcraft-vscode-vsix/ipcraft-vscode-$(releaseVersion).vsix',
    });
    assertOrderedSteps(steps, [
      steps.find((step) => step.script === 'npm ci'),
      taskStep(steps, 'DownloadPipelineArtifact@2'),
      steps.find((step) => stepCommand(step).includes('sha256sum --check')),
      azureCli,
    ]);
    assert.deepEqual(steps.slice(3), [
      {
        script: 'npm ci',
        displayName: 'Install pinned dependencies',
      },
      {
        task: 'DownloadPipelineArtifact@2',
        displayName: 'Download release artifact',
        inputs: {
          buildType: 'current',
          artifactName: 'ipcraft-vscode-vsix',
          targetPath: '$(Pipeline.Workspace)/ipcraft-vscode-vsix',
        },
      },
      {
        script: 'sha256sum --check "ipcraft-vscode-$(releaseVersion).vsix.sha256"',
        displayName: 'Verify release artifact checksum',
        workingDirectory: '$(Pipeline.Workspace)/ipcraft-vscode-vsix',
      },
      azureCli,
    ]);

    const allCommands = pipeline.stages.flatMap((pipelineStage) =>
      allStageSteps(pipelineStage).map((step) => ({
        stage: pipelineStage.stage,
        command: stepCommand(step),
      }))
    );
    assert.equal(
      allCommands.some(({ command }) => command.includes('--skip-duplicate')),
      false
    );
    assert.equal(
      allCommands.some(
        ({ stage: stageName, command }) =>
          stageName !== 'Verify' && /\bnpx vsce package\b/.test(command)
      ),
      false
    );
  });

  it('downloads, verifies, and smoke-tests the Marketplace copy with diagnostics', () => {
    const postPublish = stage('PostPublish');
    assert.equal(
      postPublish.variables.releaseVersion,
      "$[ stageDependencies.Verify.Package.outputs['release.releaseVersion'] ]"
    );
    assert.equal(postPublish.jobs.length, 1);
    const steps = jobSteps(postPublish.jobs[0]);
    assertCommonSetup(steps);
    assert.ok(steps.some((step) => step.script === 'npm run compile-tests'));

    const verifier = steps.find((step) =>
      stepCommand(step).includes('npm run verify:marketplace-release')
    );
    assert.ok(verifier, 'missing post-publish Marketplace verifier');
    assertFailFastPrologue(verifier, 'Marketplace verifier');
    assert.match(
      verifier.script,
      /npm run verify:marketplace-release -- --version "\$RELEASE_VERSION" --out "\$MARKETPLACE_VSIX"/
    );
    assert.match(verifier.script, /tee "\$DIAGNOSTICS_DIRECTORY\/marketplace-verification\.log"/);
    assert.deepEqual(verifier.env, {
      RELEASE_VERSION: '$(releaseVersion)',
      MARKETPLACE_VSIX:
        '$(Pipeline.Workspace)/marketplace-verification/ipcraft-vscode-$(releaseVersion).vsix',
      DIAGNOSTICS_DIRECTORY: '$(Pipeline.Workspace)/marketplace-verification',
    });

    const e2e = steps.find((step) => stepCommand(step).includes('xvfb-run -a npm run test:e2e'));
    assert.ok(e2e, 'missing post-publish E2E execution');
    assertFailFastPrologue(e2e, 'Marketplace E2E smoke test');
    assert.match(e2e.script, /tee "\$DIAGNOSTICS_DIRECTORY\/marketplace-e2e\.log"/);
    assert.deepEqual(e2e.env, {
      VSCODE_TEST_VERSION: 'stable',
      VSIX_PATH:
        '$(Pipeline.Workspace)/marketplace-verification/ipcraft-vscode-$(releaseVersion).vsix',
      DIAGNOSTICS_DIRECTORY: '$(Pipeline.Workspace)/marketplace-verification',
    });

    const diagnostics = taskStep(steps, 'PublishPipelineArtifact@1');
    assert.equal(diagnostics.condition, 'always()');
    assert.deepEqual(diagnostics.inputs, {
      targetPath: '$(Pipeline.Workspace)/marketplace-verification',
      artifact: 'marketplace-release-diagnostics',
      publishLocation: 'pipeline',
    });
    assertOrderedSteps(steps, [
      steps.find((step) => step.script === 'npm ci'),
      steps.find((step) => step.script === 'npm run compile-tests'),
      verifier,
      e2e,
      diagnostics,
    ]);
  });
});
