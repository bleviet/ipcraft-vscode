# Marketplace Release Pipeline Implementation Plan

**Status:** Done — merged in PR #201, closes issue #131.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dry-run-capable, manually approved Azure Pipeline that verifies and publishes one immutable IPCraft VSIX to the Visual Studio Marketplace with Microsoft Entra workload identity.

**Architecture:** Keep release policy in a small CommonJS module with injectable data so Node's built-in test runner can exercise it without network access. Thin CLI wrappers query the public Marketplace and inspect its downloadable VSIX. One Azure Pipeline builds the VSIX once, passes it through smoke tests as a pipeline artifact, publishes that exact path from a protected deployment job, and verifies the public copy afterward.

**Tech Stack:** Node.js 20, CommonJS, `node:test`, `@vscode/vsce` 3.9.x, `yauzl`, Azure Pipelines YAML, AzureCLI with Microsoft Entra workload identity, existing Jest/E2E/VSIX tooling.

## Global Constraints

- Preserve the existing GitHub Actions workflows as pull-request and branch CI.
- Source code uses relative imports; do not add TypeScript path aliases.
- TypeScript, React, and JSON properties remain camelCase.
- The release identity is `bahonavi.ipcraft-vscode`; publisher ID is `68ba6820-f472-413e-8a4f-4be6765ede40`; extension ID is `98c7d872-c2ba-4955-8ee5-5bf5e193ef78`.
- The protected Azure environment is `vscode-marketplace`; the Entra service connection is `vscode-marketplace-entra`.
- Publication must use `npx vsce publish --packagePath "$VSIX_PATH" --azure-credential`, without `--skip-duplicate`.
- Build one versioned VSIX per run. Later stages may download and verify it but must never rebuild it.
- Dry runs require no Marketplace credential and are the default.
- Do not add, commit, or push automatically. Each task ends with a reviewable working-tree checkpoint.
- Run `npm run lint` with zero warnings before handoff.

## File Structure

- `scripts/marketplace-release-contract.js`: pure identity, version, changelog, Marketplace metadata, and published-package validation.
- `scripts/check-marketplace-release.js`: preflight CLI that reads repository files, obtains `vsce show --json`, and rejects invalid or already-published releases.
- `scripts/verify-marketplace-release.js`: bounded post-publish poller and Marketplace VSIX downloader/inspector.
- `scripts/test/marketplace-release-contract.test.js`: pure release-contract tests.
- `scripts/test/check-marketplace-release.test.js`: CLI tests with an injected metadata file and environment.
- `scripts/test/verify-marketplace-release.test.js`: public-listing and downloaded-package validation tests.
- `scripts/test/marketplace-pipeline.test.js`: structural regression tests for the Azure YAML.
- `azure-pipelines/marketplace-release.yml`: manual dry-run/publish pipeline and protected deployment.
- `package.json`, `package-lock.json`: license declaration and release-tool scripts.
- `docs/how-to/build-vsix.md`: operator setup, dry-run, publish, listing review, and recovery runbook.
- `docs/architecture/vsix-packaging.md`: single-artifact release boundary.

---

### Task 1: Release Preflight Contract

**Files:**
- Create: `scripts/marketplace-release-contract.js`
- Create: `scripts/check-marketplace-release.js`
- Create: `scripts/test/marketplace-release-contract.test.js`
- Create: `scripts/test/check-marketplace-release.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `MARKETPLACE_IDENTITY`, `validateReleaseContract(input)`, and `parseVersionTag(sourceBranch)` from `scripts/marketplace-release-contract.js`.
- `validateReleaseContract` consumes `{ sourceBranch, extensionManifest, cliManifest, changelog, marketplace }` and returns `{ version, extensionId }` or throws one error containing every violated invariant.
- Produces CLI command `npm run check:marketplace-release`; it consumes `BUILD_SOURCEBRANCH` and optional `MARKETPLACE_METADATA_FILE`.

- [ ] **Step 1: Write pure failing tests for the accepted contract and each rejection class**

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  MARKETPLACE_IDENTITY,
  parseVersionTag,
  validateReleaseContract,
} = require('../marketplace-release-contract');

const extensionManifest = {
  name: 'ipcraft-vscode',
  publisher: 'bahonavi',
  version: '1.2.3',
  license: 'SEE LICENSE IN LICENSE',
};
const cliManifest = { version: '1.2.3' };
const marketplace = {
  publisher: { publisherId: MARKETPLACE_IDENTITY.publisherId, publisherName: 'bahonavi' },
  extensionId: MARKETPLACE_IDENTITY.extensionId,
  extensionName: 'ipcraft-vscode',
  versions: [{ version: '1.2.2' }],
};

describe('validateReleaseContract', () => {
  it('accepts an unpublished version selected by an exact tag', () => {
    assert.deepEqual(
      validateReleaseContract({
        sourceBranch: 'refs/tags/v1.2.3',
        extensionManifest,
        cliManifest,
        changelog: '## [1.2.3] - 2026-07-31\n',
        marketplace,
      }),
      { version: '1.2.3', extensionId: 'bahonavi.ipcraft-vscode' }
    );
  });

  it('rejects a non-tag ref', () => {
    assert.throws(() => parseVersionTag('refs/heads/main'), /exact v<major>.<minor>.<patch> tag/);
  });

  it('reports tag, CLI, identity, license, changelog, and duplicate failures together', () => {
    assert.throws(
      () =>
        validateReleaseContract({
          sourceBranch: 'refs/tags/v1.2.4',
          extensionManifest: { ...extensionManifest, publisher: 'wrong', license: 'MIT' },
          cliManifest: { version: '1.2.2' },
          changelog: '# Changelog\n',
          marketplace: { ...marketplace, versions: [{ version: '1.2.3' }] },
        }),
      (error) => {
        assert.match(error.message, /tag version 1.2.4/);
        assert.match(error.message, /CLI version 1.2.2/);
        assert.match(error.message, /publisher/);
        assert.match(error.message, /SEE LICENSE IN LICENSE/);
        assert.match(error.message, /CHANGELOG/);
        assert.match(error.message, /already exists/);
        return true;
      }
    );
  });
});
```

- [ ] **Step 2: Run the pure test and confirm it fails because the module is missing**

Run: `node --test scripts/test/marketplace-release-contract.test.js`

Expected: FAIL with `Cannot find module '../marketplace-release-contract'`.

- [ ] **Step 3: Implement the minimal pure preflight contract**

```js
const MARKETPLACE_IDENTITY = Object.freeze({
  publisher: 'bahonavi',
  name: 'ipcraft-vscode',
  publisherId: '68ba6820-f472-413e-8a4f-4be6765ede40',
  extensionId: '98c7d872-c2ba-4955-8ee5-5bf5e193ef78',
});

function parseVersionTag(sourceBranch) {
  const match = /^refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(sourceBranch ?? '');
  if (!match) throw new Error('Build.SourceBranch must be an exact v<major>.<minor>.<patch> tag');
  return match[1];
}

function validateReleaseContract(input) {
  const errors = [];
  const version = parseVersionTag(input.sourceBranch);
  const manifest = input.extensionManifest;
  if (manifest.version !== version) errors.push(`tag version ${version} does not match extension version ${manifest.version}`);
  if (input.cliManifest.version !== manifest.version) errors.push(`CLI version ${input.cliManifest.version} does not match extension version ${manifest.version}`);
  if (manifest.publisher !== MARKETPLACE_IDENTITY.publisher) errors.push(`publisher must be ${MARKETPLACE_IDENTITY.publisher}`);
  if (manifest.name !== MARKETPLACE_IDENTITY.name) errors.push(`extension name must be ${MARKETPLACE_IDENTITY.name}`);
  if (manifest.license !== 'SEE LICENSE IN LICENSE') errors.push('license must be SEE LICENSE IN LICENSE');
  if (!new RegExp(`^## \\[${version.replaceAll('.', '\\.') }\\] - `, 'm').test(input.changelog)) errors.push(`CHANGELOG must contain a ${version} release heading`);
  if (input.marketplace.publisher?.publisherId !== MARKETPLACE_IDENTITY.publisherId) errors.push('Marketplace publisher ID does not match the release contract');
  if (input.marketplace.extensionId !== MARKETPLACE_IDENTITY.extensionId) errors.push('Marketplace extension ID does not match the release contract');
  if (input.marketplace.versions?.some((item) => item.version === version)) errors.push(`Marketplace version ${version} already exists`);
  if (errors.length) throw new Error(errors.join('\n'));
  return { version, extensionId: `${manifest.publisher}.${manifest.name}` };
}

module.exports = { MARKETPLACE_IDENTITY, parseVersionTag, validateReleaseContract };
```

Keep the implementation readable; extract the changelog-heading predicate if the inline expression becomes unclear.

- [ ] **Step 4: Run the pure tests and confirm they pass**

Run: `node --test scripts/test/marketplace-release-contract.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Write failing CLI tests**

Use `spawnSync(process.execPath, ['scripts/check-marketplace-release.js'], ...)`, a temporary metadata JSON file, and explicit `BUILD_SOURCEBRANCH`. Assert a valid fixture exits `0` and prints `Release contract valid for bahonavi.ipcraft-vscode 1.2.3`; assert an existing version exits nonzero and prints `already exists` to stderr. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-release-test-'))` and remove only that resolved temporary directory in test cleanup.

- [ ] **Step 6: Run the CLI tests and confirm they fail because the wrapper is missing**

Run: `node --test scripts/test/check-marketplace-release.test.js`

Expected: FAIL because `scripts/check-marketplace-release.js` does not exist.

- [ ] **Step 7: Implement the thin CLI and package scripts**

The CLI must:

```js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { MARKETPLACE_IDENTITY, validateReleaseContract } = require('./marketplace-release-contract');

function loadMarketplace() {
  if (process.env.MARKETPLACE_METADATA_FILE) {
    return JSON.parse(fs.readFileSync(process.env.MARKETPLACE_METADATA_FILE, 'utf8'));
  }
  return JSON.parse(
    execFileSync('npx', ['vsce', 'show', `${MARKETPLACE_IDENTITY.publisher}.${MARKETPLACE_IDENTITY.name}`, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  );
}
```

Read `package.json`, `packages/ipcraft/package.json`, and `CHANGELOG.md` from the repository root, call `validateReleaseContract`, print the success line, and use a top-level `try/catch` that writes a concise error to stderr and sets exit code `1`.

Add these scripts to `package.json` and refresh the lockfile with `npm install --package-lock-only --ignore-scripts`:

```json
"check:marketplace-release": "node scripts/check-marketplace-release.js",
"test:release": "node --test scripts/test/*.test.js"
```

- [ ] **Step 8: Verify Task 1**

Run: `npm run test:release`

Expected: release-contract and CLI tests PASS. Do not run the live preflight against `v0.9.9`, because the correct result for the already-published current version is failure.

### Task 2: Published Marketplace Package Verification

**Files:**
- Modify: `scripts/marketplace-release-contract.js`
- Create: `scripts/verify-marketplace-release.js`
- Create: `scripts/test/verify-marketplace-release.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `getMarketplacePackageUrl(version)` and `validatePublishedPackage(input)`.
- `validatePublishedPackage` consumes `{ version, listing, packagedManifest, archiveFiles }` and returns `{ version, extensionId }` or throws aggregated validation errors.
- Produces CLI command `npm run verify:marketplace-release -- --version 1.2.3 --out artifacts/marketplace-1.2.3.vsix`.

- [ ] **Step 1: Write failing pure tests for listing and VSIX validation**

```js
it('accepts the expected public listing and packaged manifest', () => {
  const result = validatePublishedPackage({
    version: '1.2.3',
    listing: {
      publisher: { publisherId: MARKETPLACE_IDENTITY.publisherId, publisherName: 'bahonavi' },
      extensionId: MARKETPLACE_IDENTITY.extensionId,
      extensionName: 'ipcraft-vscode',
      displayName: 'IPCraft for VS Code',
      versions: [{ version: '1.2.3' }],
      categories: ['Programming Languages', 'Visualization'],
    },
    packagedManifest: {
      name: 'ipcraft-vscode',
      publisher: 'bahonavi',
      version: '1.2.3',
      license: 'SEE LICENSE IN LICENSE',
      icon: 'resources/icon.png',
      repository: { url: 'git+https://github.com/bleviet/ipcraft-vscode.git' },
      homepage: 'https://github.com/bleviet/ipcraft-vscode#readme',
      bugs: { url: 'https://github.com/bleviet/ipcraft-vscode/issues' },
      categories: ['Programming Languages', 'Visualization', 'Other'],
      contributes: { commands: [{ command: 'fpga-ip-core.createIpCore' }] },
    },
    archiveFiles: new Set([
      'extension/LICENSE.txt',
      'extension/readme.md',
      'extension/changelog.md',
      'extension/resources/icon.png',
    ]),
  });
  assert.deepEqual(result, { version: '1.2.3', extensionId: 'bahonavi.ipcraft-vscode' });
});

it('reports missing listing content and manifest assets together', () => {
  assert.throws(() => validatePublishedPackage(invalidInput), /README[\s\S]*license[\s\S]*commands/);
});

it('constructs the exact public vspackage URL', () => {
  assert.equal(
    getMarketplacePackageUrl('1.2.3'),
    'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/bahonavi/vsextensions/ipcraft-vscode/1.2.3/vspackage'
  );
});
```

- [ ] **Step 2: Run the test and confirm the new exports are missing**

Run: `node --test scripts/test/verify-marketplace-release.test.js`

Expected: FAIL because `validatePublishedPackage` and `getMarketplacePackageUrl` are undefined.

- [ ] **Step 3: Implement pure published-package checks**

Validate the exact publisher/extension IDs and name, requested version, display name, required Marketplace categories, local manifest links, non-empty `contributes.commands`, `SEE LICENSE IN LICENSE`, and the four required archive files. Return the identity/version only after all checks pass. URL-encode publisher, name, and version segments in `getMarketplacePackageUrl`.

- [ ] **Step 4: Run pure tests and confirm they pass**

Run: `node --test scripts/test/verify-marketplace-release.test.js`

Expected: PASS.

- [ ] **Step 5: Add failing wrapper tests for retry, download, and archive inspection**

Export `pollForVersion`, `downloadFile`, and `readVsixManifest` from the CLI while guarding execution with `if (require.main === module)`. Test `pollForVersion` with an injected async loader returning absent, absent, then present metadata and assert three calls. Add `yazl` version `^3.3.1` as a direct dev dependency and use it in the test to write a minimal temporary VSIX containing `extension/package.json`, `extension/LICENSE.txt`, `extension/readme.md`, `extension/changelog.md`, and `extension/resources/icon.png`. Assert `readVsixManifest` parses the manifest and returns all five file names. Refresh the lockfile through `npm install --save-dev yazl@^3.3.1 --ignore-scripts`.

- [ ] **Step 6: Run wrapper tests and confirm they fail because the wrapper is missing**

Run: `node --test scripts/test/verify-marketplace-release.test.js`

Expected: FAIL because `scripts/verify-marketplace-release.js` does not exist.

- [ ] **Step 7: Implement bounded public verification**

The CLI accepts required `--version` and `--out`. It polls `npx vsce show bahonavi.ipcraft-vscode --json` up to 12 times with a 10-second interval, downloads the exact version from `getMarketplacePackageUrl(version)` using global `fetch`, writes it to the explicit output path, reads `extension/package.json` and archive entries with `yauzl`, calls `validatePublishedPackage`, and prints the downloaded path. Treat non-2xx HTTP responses, malformed archives, timeout, and validation mismatches as failures. Never delete or overwrite anything outside the explicit `--out` file.

Add:

```json
"verify:marketplace-release": "node scripts/verify-marketplace-release.js"
```

- [ ] **Step 8: Verify Task 2**

Run: `npm run test:release`

Expected: all release-tool tests PASS.

### Task 3: Manifest License and Packaging Contract

**Files:**
- Modify: `package.json:4`
- Modify: `package-lock.json`
- Modify: `scripts/check-vsix.js`
- Create: `scripts/test/check-vsix.test.js`

**Interfaces:**
- `scripts/check-vsix.js` continues accepting one VSIX path.
- It additionally exports `validateManifest(manifest, archiveFiles)` and only executes `main()` under `if (require.main === module)`.

- [ ] **Step 1: Write a failing manifest-contract test**

```js
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../check-vsix');

it('requires the root license declaration and packaged license file', () => {
  assert.doesNotThrow(() =>
    validateManifest(
      { license: 'SEE LICENSE IN LICENSE' },
      new Set(['extension/LICENSE.txt'])
    )
  );
  assert.throws(
    () => validateManifest({ license: 'MIT' }, new Set(['extension/LICENSE.txt'])),
    /SEE LICENSE IN LICENSE/
  );
  assert.throws(
    () => validateManifest({ license: 'SEE LICENSE IN LICENSE' }, new Set()),
    /extension\/LICENSE.txt/
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails because `validateManifest` is not exported**

Run: `node --test scripts/test/check-vsix.test.js`

Expected: FAIL with `validateManifest is not a function`.

- [ ] **Step 3: Implement the check and update the manifest**

Refactor archive inspection just enough to read `extension/package.json`, parse it, and call `validateManifest`. Keep the existing allowlist, required trees, duplicate detection, and size budgets unchanged. Change only the extension root manifest to:

```json
"license": "SEE LICENSE IN LICENSE"
```

Refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`. Do not change `packages/ipcraft/package.json`; its npm package remains SPDX `MIT`.

- [ ] **Step 4: Run release tests and build a real VSIX**

Run:

```bash
npm run test:release
mkdir -p artifacts
npx vsce package --out artifacts/ipcraft-vscode-0.9.9.vsix
npm run check:vsix -- artifacts/ipcraft-vscode-0.9.9.vsix
```

Expected: tests PASS; the package check prints `VSIX contents and size are within the production contract.` The local artifact is disposable and must not be added to git.

### Task 4: Azure Release Pipeline

**Files:**
- Create: `azure-pipelines/marketplace-release.yml`
- Create: `scripts/test/marketplace-pipeline.test.js`

**Interfaces:**
- Manual parameter: `publish: boolean`, default `false`.
- Artifact: `ipcraft-vscode-vsix`, containing one `ipcraft-vscode-<version>.vsix` and its `.sha256` sidecar.
- Stages: `Verify`, `Smoke`, `Publish`, `PostPublish`.
- Output variable: `releaseVersion` from the package job.

- [ ] **Step 1: Write a failing structural pipeline test**

Parse the YAML with the existing `yaml` package and assert:

```js
assert.equal(pipeline.trigger, 'none');
assert.equal(pipeline.pr, 'none');
assert.deepEqual(pipeline.parameters[0], {
  name: 'publish',
  displayName: 'Publish after verification',
  type: 'boolean',
  default: false,
});
assert.deepEqual(pipeline.stages.map((stage) => stage.stage), [
  'Verify',
  'Smoke',
  'Publish',
  'PostPublish',
]);
```

Also recursively stringify the pipeline and assert it contains `check:marketplace-release`, `check:vsix`, both `VSCODE_TEST_VERSION` values, `environment: vscode-marketplace`, `azureSubscription: vscode-marketplace-entra`, `--packagePath`, `--azure-credential`, `sha256sum --check`, and `verify:marketplace-release`. Assert it does not contain `--skip-duplicate` or `vsce package` outside the `Verify` stage.

- [ ] **Step 2: Run the structural test and confirm the YAML is missing**

Run: `node --test scripts/test/marketplace-pipeline.test.js`

Expected: FAIL with `ENOENT` for `azure-pipelines/marketplace-release.yml`.

- [ ] **Step 3: Implement the manual verification stage**

Use `trigger: none`, `pr: none`, the boolean parameter above, `ubuntu-latest`, checkout with `submodules: recursive`, `fetchDepth: 0`, and `fetchTags: true`, then Node 20 and `npm ci`. Run, in order:

```text
npm run check:marketplace-release
npm run docs:links
npm run lint
npm run type-check
npm run compile
npm run compile-tests
npm run check:cli-distribution
npm run test:cli-package
npm run test:unit -- --coverage
```

Package exactly once to `$(Build.ArtifactStagingDirectory)/ipcraft-vscode-${RELEASE_VERSION}.vsix`, run `npm run check:vsix`, generate the sidecar with `sha256sum`, set `releaseVersion` as an output variable, and publish the staging directory as `ipcraft-vscode-vsix`.

Name the packaging job `Package` and the variable-setting step `release`. Emit:

```text
##vso[task.setvariable variable=releaseVersion;isOutput=true]$RELEASE_VERSION
```

In every dependent stage, bind it with:

```yaml
variables:
  releaseVersion: $[ stageDependencies.Verify.Package.outputs['release.releaseVersion'] ]
```

Add `Verify` to the explicit `dependsOn` list of later stages that consume this output.

- [ ] **Step 4: Add the two smoke jobs**

Both jobs depend on `Verify`, checkout source, run `npm ci`, download the current pipeline artifact, verify the sidecar, run `npm run check:vscode-compatibility`, and compile E2E tests. Use:

```yaml
env:
  VSCODE_TEST_VERSION: 1.80.0
  VSIX_PATH: $(Pipeline.Workspace)/ipcraft-vscode-vsix/ipcraft-vscode-$(releaseVersion).vsix
```

for the minimum job and `stable` for the stable job. Execute `xvfb-run -a npm run test:e2e`.

- [ ] **Step 5: Add the protected publish deployment**

Condition the stage on successful smoke jobs and `${{ eq(parameters.publish, true) }}`. Use a deployment job with `environment: vscode-marketplace`, download the current artifact, verify its sidecar, and run the publish command inside `AzureCLI@2` with `azureSubscription: vscode-marketplace-entra`. Install pinned repository dependencies before invoking `npx vsce`; do not package in this stage.

- [ ] **Step 6: Add post-publication verification**

Condition `PostPublish` on successful `Publish`. On a fresh Ubuntu agent, checkout, install dependencies, compile E2E tests, call:

```text
npm run verify:marketplace-release -- --version "$RELEASE_VERSION" --out "$MARKETPLACE_VSIX"
```

Then set `VSIX_PATH` to the downloaded Marketplace VSIX and run `xvfb-run -a npm run test:e2e` against stable. Publish the downloaded verification copy and logs as diagnostic artifacts even when the stage fails, without treating them as the release artifact.

- [ ] **Step 7: Verify the pipeline structure**

Run: `npm run test:release`

Expected: all pipeline and release-tool tests PASS. Review the rendered YAML conditions to confirm dry runs omit both `Publish` and `PostPublish`.

### Task 5: Release Runbook and Architecture Documentation

**Files:**
- Modify: `docs/how-to/build-vsix.md`
- Modify: `docs/architecture/vsix-packaging.md`

**Interfaces:**
- The how-to is the operator contract.
- The architecture document records why the artifact is built once and why publication is owned by Azure Pipelines.

- [ ] **Step 1: Add the Azure one-time setup section**

Document these exact resources and checks:

- public identity `bahonavi.ipcraft-vscode`, publisher ID, and extension ID;
- Azure Pipeline connected to this GitHub repository and YAML path;
- user-assigned managed identity and federated Azure service connection `vscode-marketplace-entra`;
- Marketplace Contributor membership for that managed identity;
- protected environment `vscode-marketplace` with named approvers and exclusive lock;
- no PAT secret in GitHub or Azure Pipeline variables; and
- manual confirmation of publisher ownership in Marketplace management.

Link to Microsoft's VS Code secure automated publishing, Azure workload identity, Azure environment approvals, and extension-manifest documentation.

- [ ] **Step 2: Add dry-run and publish procedures**

State that maintainers update both manifests and `CHANGELOG.md`, create and push an immutable `vX.Y.Z` tag, select that tag in Azure Pipelines, leave `publish: false` for dry run, and inspect the versioned VSIX/hash plus both smoke jobs. For publication, rerun the same tag with `publish: true`, review the artifact SHA-256 at the environment approval gate, approve, and wait for post-publication installation verification.

- [ ] **Step 3: Add the Marketplace listing checklist**

Require manual review of rendered icon, README, links, categories, commands, license, changelog/release notes, and installation. Distinguish automated archive/API checks from the human visual check. Record the extension and CLI sequencing: publish and verify the extension before running the existing npm CLI workflow.

- [ ] **Step 4: Add recovery policy**

Document: rerun pre-publish failures safely; never reuse or silently skip an existing version; diagnose retained artifact/hash after post-publish failures; prefer a corrected higher version; use Unpublish only when withdrawal is necessary; never use Remove or version deletion as routine rollback because those actions are irreversible and version numbers cannot be reused.

- [ ] **Step 5: Update the architecture contract**

Add a short release section describing `Verify -> Smoke -> protected Publish -> PostPublish`, the immutable pipeline artifact and SHA-256 boundary, and the reason GitHub CI does not publish.

- [ ] **Step 6: Verify documentation**

Run:

```bash
npm run docs:links
npm run docs:build
```

Expected: both commands PASS with no broken links or strict MkDocs errors.

### Task 6: Full Verification and Dry-run Readiness

**Files:**
- Review all files listed above; make no unrelated edits.

**Interfaces:**
- Produces a reviewable, uncommitted working tree ready for Azure resource setup and a dry run on the next unpublished version tag.

- [ ] **Step 1: Run release-specific checks**

Run:

```bash
npm run test:release
npm run check:vsix -- artifacts/ipcraft-vscode-0.9.9.vsix
```

Expected: all tests and the real archive contract PASS.

- [ ] **Step 2: Run project quality gates**

Run:

```bash
npm run lint
npm run type-check
npm run test:unit -- --runInBand
npm run compile
```

Expected: every command exits `0`; ESLint reports no warnings.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff -- package.json package-lock.json scripts azure-pipelines docs/how-to/build-vsix.md docs/architecture/vsix-packaging.md
```

Expected: no whitespace errors, no generated VSIX or temporary fixture is tracked, and no unrelated file is modified.

- [ ] **Step 4: Report the external setup boundary**

State clearly that code verification can finish locally, but the real dry run cannot occur until a maintainer creates the Azure Pipeline and external resources named in Task 5 and creates a new unpublished release tag. Provide the exact Azure YAML path and commands already verified; do not claim the remote dry run occurred if those resources are absent.
