# Building a VSIX Package

A VSIX file is an installable VS Code extension package. This guide builds one
from the repository source.

## Prerequisites

- **Node.js 20+** and **npm**
- All dependencies installed (`npm install`)

`@vscode/vsce` is already listed as a dev dependency — no global installation is required.

## Steps

### 1. Install dependencies

```bash
npm install
```

### 2. Run the production build

The `package` script compiles both the extension host and the webview bundles in production mode (minified, no source maps exposed):

```bash
npm run package
```

This runs webpack with `--mode production --devtool hidden-source-map` and outputs artefacts to `dist/`.

### 3. Package as VSIX

```bash
npx vsce package
```

This produces a file named `ipcraft-vscode-<version>.vsix` in the project root (e.g. `ipcraft-vscode-0.8.6.vsix`).

!!! tip
Steps 2 and 3 can be combined since `vscode:prepublish` automatically runs `npm run package` before `vsce package`:
`bash
    npx vsce package   # triggers vscode:prepublish → npm run package first
    `

## Installing the VSIX

Install directly in VS Code:

=== "VS Code UI" 1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`). 2. Click the **`···`** menu (top-right of the panel). 3. Choose **Install from VSIX…** and select the generated file.

=== "Command line"
`bash
    code --install-extension ipcraft-vscode-0.8.6.vsix
    `

## Verifying the package contents

Inspect what files are included without installing:

```bash
npx vsce ls
```

Files excluded by `.vscodeignore` (source files, `node_modules`, `docs`, `src`, etc.) will not appear in the output.

## Bumping the version

Use npm to update the extension version without creating a commit or tag:

```bash
npm version patch --no-git-tag-version   # or minor / major
```

This updates `package.json` and `package-lock.json`; retain the lockfile update.
Then update `packages/ipcraft/package.json` to the same version and add the
matching release heading to `CHANGELOG.md`. The CLI packaging and release checks
reject mismatched versions or a missing changelog heading.

Only after all four release files are ready, commit the complete release change
and create its immutable tag:

```bash
git add package.json package-lock.json packages/ipcraft/package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push origin HEAD
git push origin vX.Y.Z
```

Do not move or replace the tag after a run has started.

Then re-run `npx vsce package`.

## Marketplace release runbook

The production Marketplace release is operated from the
[`Marketplace Release`](https://github.com/bleviet/ipcraft-vscode/blob/main/.github/workflows/marketplace-release.yml)
GitHub Actions workflow, not from a developer workstation. It is manually
dispatched against an exact release tag and builds the VSIX once, uploads it as
a versioned workflow artifact with a SHA-256 sidecar, smoke-tests that exact
artifact on VS Code 1.80.0 and stable, and only then permits a protected
publication.

### One-time Azure and Marketplace setup

Complete and periodically re-check the following configuration before attempting
the first release:

- Confirm the public Marketplace identity is `bahonavi.ipcraft-vscode`: publisher
  name `bahonavi`, publisher ID `68ba6820-f472-413e-8a4f-4be6765ede40`, and
  extension ID `98c7d872-c2ba-4955-8ee5-5bf5e193ef78`. In Marketplace management,
  manually confirm that the release administrators own this publisher and its
  extension before granting automation access.
- In the GitHub repository, create an active **tag ruleset** targeting `v*`.
  Enable **Restrict updates** and **Restrict deletions**. Its bypass list must
  contain only explicitly designated, break-glass release administrators with
  **Always allow**; do not grant routine contributors, automation, or a broad
  administrator role a bypass. GitHub documents this as a **New tag ruleset**
  with a target pattern, protections, and a bypass list in its [repository
  ruleset guide](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).
  This protection is a release prerequisite: do not create or run a release tag
  until it is active.
- Create a user-assigned managed identity in Microsoft Entra ID, then add a
  **federated credential** on it scoped to a **GitHub Actions** issuer
  (`https://token.actions.githubusercontent.com`) with subject
  `repo:bleviet/ipcraft-vscode:environment:vscode-marketplace`. This lets the
  `publish` job authenticate to Azure with no stored secret — only workflow runs
  that pass the `vscode-marketplace` environment gate can mint a matching OIDC
  token.
- Store the managed identity's `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
  `AZURE_SUBSCRIPTION_ID` as **environment secrets** on the GitHub
  `vscode-marketplace` environment (Repository Settings → Environments), not as
  repository-wide secrets — this keeps them inaccessible to any job that doesn't
  target that environment.
- Add that managed identity to the Marketplace publisher as a **Contributor**.
  The workflow uses `vsce publish --azure-credential` via `azure/login`'s OIDC
  federation; it does not use a publisher personal access token (PAT).
- Create the protected `vscode-marketplace` GitHub **environment** used by the
  `publish` job. Add required reviewers so a release needs explicit human
  approval before it can publish.
- Do not store a Marketplace PAT in GitHub secrets, GitHub Actions variables, or
  anywhere else. The identity-based flow deliberately has no PAT secret to
  rotate or expose.

Microsoft documents [secure automated Marketplace
publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace),
[connecting GitHub Actions to Azure with
OpenID Connect](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect),
GitHub's [environment protection
rules](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment),
and the [VS Code extension
manifest](https://code.visualstudio.com/api/references/extension-manifest).

### Dry run

1. Confirm the active `v*` tag ruleset described above blocks updates and
   deletions, with only the controlled break-glass administrator bypass. Then
   follow the version procedure above so the release commit includes matching
   extension and CLI manifests, the `package-lock.json` update, and the
   `CHANGELOG.md` heading before the immutable exact SemVer tag, `vX.Y.Z` (for
   example, `v1.0.0`), is created and pushed.
2. Run the **Marketplace Release** workflow from the Actions tab (or
   `gh workflow run marketplace-release.yml --ref vX.Y.Z -f publish=false`),
   selecting that tag as the ref. `publish: false` is the default and performs
   no publication.
3. Inspect the `ipcraft-vscode-vsix` workflow artifact: it must contain the
   versioned `ipcraft-vscode-X.Y.Z.vsix` and its `.sha256` file. Review the
   `verify` job's checks and both `smoke` matrix legs, which install that
   artifact on VS Code 1.80.0 and stable after verifying its checksum.

### Publish

1. Re-run the workflow against the same tag protected by the active `v*`
   ruleset, with `publish: true`; do not create or package a different source
   revision between dry run and publication
   (`gh workflow run marketplace-release.yml --ref vX.Y.Z -f publish=true`).
2. At the `vscode-marketplace` environment approval, review the versioned VSIX
   artifact and SHA-256 sidecar that the workflow checksum-verifies before the
   publish step. A required reviewer then approves the protected deployment.
3. Wait for `postpublish` to finish. It polls the Marketplace for `X.Y.Z`,
   downloads the published VSIX, checks its Marketplace metadata and archive
   contents, and installs that downloaded package in a stable VS Code smoke test.
4. Perform the Marketplace listing review below. Only after the extension has
   published and been verified may the operator run the existing `Publish CLI to
npm` GitHub Actions workflow for the matching version.

### Marketplace listing review

The pipeline validates the archive and Marketplace API metadata, including the
required README, license, changelog, icon file, identity, links, categories, and
contributed commands. It cannot judge presentation. A release administrator must
open the public listing and manually review:

- rendered icon and README;
- homepage, repository, and issue links;
- categories and visible commands;
- license and changelog or release notes; and
- installation from the Marketplace in VS Code.

This human visual check is distinct from the automated archive/API checks and
the post-publication installation smoke test.

### Failure and recovery policy

- A failure before publication is safe to rerun after correcting the cause. Keep
  the same tag only while it still represents the intended, immutable release
  source.
- Never reuse an existing Marketplace version or silently skip a version. The
  release contract rejects a version that is already listed.
- If publication may have succeeded but `postpublish` fails, retain the workflow
  artifact, its SHA-256 sidecar, and diagnostics. Diagnose the published listing
  and downloaded VSIX against that retained evidence before taking another action.
- Prefer a corrected, higher version for a replacement release.
- Use **Unpublish** only when the published extension must be withdrawn. Do not
  use **Remove** or version deletion as routine rollback: those actions are
  irreversible and removed version numbers cannot be reused.

## Releasing the standalone CLI

The VSIX and npm CLI are separate artifacts. Installing the extension does not
add `ipcraft` to the user's shell `PATH`.

Build and test the npm archive locally without publishing it:

```bash
npm run package:cli
npm run test:cli-package
```

After the matching extension version has been published and verified through the
Marketplace release runbook, run the `Publish CLI to npm` GitHub Actions workflow
manually. Enter the matching version and confirm that the extension is already
published. The workflow checks the versions, rebuilds the production bundle,
installs the tarball in a clean temporary project, and only then runs `npm
publish`. The protected `npm` environment must provide `NPM_TOKEN`.

Direct publication is locked unless `IPCRAFT_PUBLISH=confirmed` is supplied,
so normal builds, tests, and `npm pack` cannot publish the package.

## Troubleshooting

| Problem                                                      | Solution                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `ERROR  Missing publisher name`                              | Ensure `publisher` is set in `package.json` (currently `bahonavi`).                         |
| `ERROR  It seems the README.md still contains template text` | Update `README.md` to remove placeholder content.                                           |
| Build fails before packaging                                 | Run `npm run package` separately first and resolve any webpack errors.                      |
| VSIX installs but extension does not activate                | Check `dist/extension.js` exists. Ensure `"main": "./dist/extension.js"` in `package.json`. |
