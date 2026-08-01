# Marketplace Release Review Hardening Implementation Plan

**Status:** Done — all five tasks landed and merged in PR #201 (checkboxes below were never ticked in this file, but `license: "MIT"`, `readVsixArchive`, `MAX_POLL_ATTEMPTS = 60`, and the manifest-derived description are all present on `main`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve PR #201 review findings without weakening the release artifact, identity, or post-publication verification contracts.

**Architecture:** Keep `package.json` as the canonical source for SPDX license and description metadata. Move ZIP traversal into one Node helper consumed by both VSIX gates, and retain bounded Marketplace polling with a longer fixed default while tests inject zero-delay timing.

**Tech Stack:** Node.js CommonJS scripts, Node `--test`, `yauzl`, `@vscode/vsce`, npm, GitHub pull requests.

## Global Constraints

- Preserve the four-stage Azure release flow and exact-artifact checksum boundary.
- Keep the root license declaration as the SPDX identifier `MIT` and require `extension/LICENSE.txt` in every VSIX.
- Poll Marketplace every 10 seconds for at most 60 attempts by default.
- Use one archive reader for both pre-publish and post-publish validation.
- Derive expected Marketplace description from the packaged manifest.
- Use camelCase in JavaScript and do not introduce credentials or network access into pure contract tests.
- Run `npm run lint` before committing and do not rewrite unrelated files.

---

### Task 1: Restore SPDX License Metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/check-vsix.js`
- Modify: `scripts/marketplace-release-contract.js`
- Test: `scripts/test/check-vsix.test.js`
- Test: `scripts/test/marketplace-release-contract.test.js`
- Test: `scripts/test/verify-marketplace-release.test.js`

**Interfaces:**
- Consumes: `validateManifest(manifest, archiveFiles)`, `validateReleaseContract(input)`, and `validatePublishedPackage(input)`.
- Produces: release gates that require `manifest.license === 'MIT'` while independently requiring `extension/LICENSE.txt`.

- [ ] **Step 1: Change tests to require MIT**

Update valid fixtures to use:

```js
{ license: 'MIT' }
```

Retain a negative case with a non-MIT value and assert that its message identifies the required SPDX value. Keep the missing `extension/LICENSE.txt` assertion separate.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test scripts/test/check-vsix.test.js scripts/test/marketplace-release-contract.test.js scripts/test/verify-marketplace-release.test.js
```

Expected: FAIL because the current validators require `SEE LICENSE IN LICENSE`.

- [ ] **Step 3: Restore manifest metadata and update the gates**

Set the root entries in `package.json` and `package-lock.json` to:

```json
"license": "MIT"
```

Change all three validation paths to accept only `MIT`, with concise messages such as:

```js
if (manifest.license !== 'MIT') {
  errors.push('extension/package.json must declare the MIT SPDX license');
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 2: Derive the Marketplace Description from the Manifest

**Files:**
- Modify: `scripts/marketplace-release-contract.js`
- Test: `scripts/test/verify-marketplace-release.test.js`

**Interfaces:**
- Consumes: `packagedManifest.description` and `listing.shortDescription` inside `validatePublishedPackage`.
- Produces: description equality validation without a duplicated module-level literal.

- [ ] **Step 1: Write a manifest-owned-description test**

Create a valid package fixture whose two values are the same non-production literal:

```js
input.packagedManifest.description = 'Description supplied by the packaged manifest.';
input.listing.shortDescription = 'Description supplied by the packaged manifest.';
```

Assert `validatePublishedPackage(input)` does not throw. Retain the mismatch test with different values.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test scripts/test/verify-marketplace-release.test.js
```

Expected: FAIL because the validator compares the listing with the hard-coded production description.

- [ ] **Step 3: Remove the duplicated literal**

Delete `MARKETPLACE_SHORT_DESCRIPTION` and compare:

```js
if (listing.shortDescription !== packagedManifest.description) {
  errors.push('Marketplace short description must match the packaged manifest');
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 3: Extend the Marketplace Propagation Window

**Files:**
- Modify: `scripts/verify-marketplace-release.js`
- Test: `scripts/test/verify-marketplace-release.test.js`

**Interfaces:**
- Consumes: `pollForVersion(loadListing, version, options = {})`.
- Produces: a 60-attempt default with the existing 10-second interval; explicit test options remain supported.

- [ ] **Step 1: Write a default-budget behavior test**

Use a fake listing loader that exposes the version on attempt 13 and an injected no-op sleeper:

```js
let attempts = 0;
const listing = await pollForVersion(
  async () => ({ versions: ++attempts === 13 ? [{ version: '1.2.3' }] : [] }),
  '1.2.3',
  { sleep: async () => {} }
);
assert.equal(listing.versions[0].version, '1.2.3');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test scripts/test/verify-marketplace-release.test.js
```

Expected: FAIL after 12 attempts.

- [ ] **Step 3: Raise the bounded default**

Change:

```js
const MAX_POLL_ATTEMPTS = 60;
```

Keep `POLL_INTERVAL_MS = 10_000` and the existing injected options unchanged.

- [ ] **Step 4: Run the test and verify GREEN**

Run the command from Step 2. Expected: PASS without real waiting.

### Task 4: Consolidate VSIX Archive Reading

**Files:**
- Create: `scripts/vsix-archive.js`
- Modify: `scripts/check-vsix.js`
- Modify: `scripts/verify-marketplace-release.js`
- Test: `scripts/test/check-vsix.test.js`
- Test: `scripts/test/verify-marketplace-release.test.js`

**Interfaces:**
- Produces: `readVsixArchive(archivePath) -> Promise<{ entries, manifest, archiveFiles }>` where `entries` contains `{ name, size }`, `manifest` is parsed `extension/package.json`, and `archiveFiles` is a `Set` of file names.
- Consumes: `check-vsix.js` uses `entries` and `manifest`; `verify-marketplace-release.js` uses `manifest` and `archiveFiles`.

- [ ] **Step 1: Confirm characterization coverage**

Run:

```bash
node --test scripts/test/check-vsix.test.js scripts/test/verify-marketplace-release.test.js
```

Expected: PASS, including real ZIP parsing, missing-manifest rejection, packaged-license validation, and packaged-file exclusion.

- [ ] **Step 2: Extract the canonical reader**

Move the lazy `yauzl` traversal into `scripts/vsix-archive.js`. It must reject a missing `extension/package.json`, parse that entry once, collect every non-directory entry and size, and return:

```js
{ entries, manifest, archiveFiles: new Set(entries.map((entry) => entry.name)) }
```

Export `{ readVsixArchive }`.

- [ ] **Step 3: Replace both private implementations**

Import `readVsixArchive` in `scripts/check-vsix.js` and `scripts/verify-marketplace-release.js`. Remove their `yauzl` imports and duplicate readers. Preserve the published-verifier mapping:

```js
const { manifest: packagedManifest, archiveFiles } = await readVsixArchive(out);
```

- [ ] **Step 4: Run characterization tests**

Run the command from Step 1. Expected: PASS with the same observable behavior.

### Task 5: Verify and Update PR #201

**Files:**
- Verify all modified release files.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: a reviewed commit on `issue-131-marketplace-release` and updated PR checks.

- [ ] **Step 1: Run release and formatting checks**

```bash
npm run test:release
npx prettier --check scripts/check-vsix.js scripts/marketplace-release-contract.js scripts/verify-marketplace-release.js scripts/vsix-archive.js scripts/test/check-vsix.test.js scripts/test/marketplace-release-contract.test.js scripts/test/verify-marketplace-release.test.js
git diff --check
```

- [ ] **Step 2: Build and inspect a fresh VSIX**

```bash
npx vsce package --out /private/tmp/ipcraft-pr-201-review.vsix
npm run check:vsix -- /private/tmp/ipcraft-pr-201-review.vsix
```

Expected: the archive declares `MIT`, contains `extension/LICENSE.txt`, excludes `azure-pipelines/**`, and passes size/allowlist checks.

- [ ] **Step 3: Run the full repository suite**

```bash
npm test
npm run type-check
npm run docs:links
npm run docs:build
```

Expected: all commands exit zero. Existing Browserslist and MkDocs informational notices are non-failing.

- [ ] **Step 4: Review and commit only intended files**

```bash
git status --short
git diff --check
git add package.json package-lock.json scripts/check-vsix.js scripts/marketplace-release-contract.js scripts/verify-marketplace-release.js scripts/vsix-archive.js scripts/test/check-vsix.test.js scripts/test/marketplace-release-contract.test.js scripts/test/verify-marketplace-release.test.js
git commit -m "fix(release): harden Marketplace verification"
```

- [ ] **Step 5: Push and verify PR state**

```bash
git push
gh pr view 201 --json url,state,headRefOid,mergeable
gh pr checks 201
```

Expected: PR #201 points to the new commit and CI has started for that head.

