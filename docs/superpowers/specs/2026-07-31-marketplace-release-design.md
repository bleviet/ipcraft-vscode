# Marketplace Release Pipeline Design

**Status:** Done — implemented in PR #201, closes issue #131.

## Context

GitHub issue #131 was written before IPCraft's first Marketplace publication.
The extension is now public as `bahonavi.ipcraft-vscode`, with Marketplace
publisher ID `68ba6820-f472-413e-8a4f-4be6765ede40` and extension ID
`98c7d872-c2ba-4955-8ee5-5bf5e193ef78`. Versions through `0.9.9` have been
published, but publication is not represented by a reproducible repository
workflow.

The existing GitHub Actions CI already packages one VSIX, checks its allowlisted
contents and size, and installs that artifact for extension-host smoke tests.
The missing contract is the controlled path from a reviewed version to the
Marketplace, including current authentication, duplicate-version prevention,
release documentation, and post-publication verification.

Microsoft's current guidance recommends Microsoft Entra authentication through
workload identity federation and a managed identity for automated Marketplace
publishing. The documented implementation uses Azure Pipelines and `vsce
publish --azure-credential`. The release authority will therefore be an Azure
Pipeline connected to this GitHub repository. GitHub Actions remains the normal
pull-request and branch CI system.

## Goals

- Build one versioned VSIX and use that exact pipeline artifact for every
  pre-publication check and the publish command.
- Make dry-run verification safe and available without Marketplace credentials.
- Require both an immutable Git tag and an explicit protected-environment
  approval before publication.
- Publish without a stored PAT or other long-lived release credential.
- Reject a tag/version mismatch and reject a version already present in the
  Marketplace.
- Verify the published listing and installability, and document the remaining
  human checks and recovery policy.
- Preserve the extension manifest's SPDX `MIT` declaration and require the
  matching license text in the packaged VSIX.

## Non-goals

- Replacing GitHub Actions CI for pull requests and pushes.
- Publishing the standalone npm CLI; `.github/workflows/publish-cli.yml` remains
  a separate downstream release.
- Automating publisher creation, DNS domain verification, or Azure tenant
  administration.
- Deleting Marketplace extensions or versions. Destructive Marketplace actions
  remain manual.

## Considered Approaches

### One Azure Pipeline for build, verification, and publication

This is the selected approach. Azure Pipelines can use the documented Entra
workload identity flow directly. A pipeline artifact provides a clear boundary:
the VSIX is created once, hashed, smoke-tested, approved, and passed unchanged
to `vsce publish --packagePath`.

### GitHub Actions build followed by an Azure Pipelines publisher

This avoids repeating some CI work, but requires a cross-system artifact handoff
and additional authentication to retrieve a specific GitHub artifact. That
makes provenance, retention, and retry behavior harder to audit than a single
pipeline run.

### GitHub Actions with a PAT or manual Marketplace upload

This is simpler initially but retains a long-lived credential or a manual
artifact transfer. It does not meet the issue's current-authentication and
reproducibility goals.

## Pipeline Entry and Release Identity

The repository will contain `azure-pipelines/marketplace-release.yml`. The
pipeline has no automatic branch or pull-request trigger. An operator starts it
manually, selects an existing `v<major>.<minor>.<patch>` Git tag, and chooses a
boolean `publish` parameter. `publish` defaults to `false`, making every ordinary
run a dry run.

Both dry-run and publish runs require:

- `Build.SourceBranch` to be an exact version tag;
- the tag version to equal the root `package.json` version;
- the root extension version to equal `packages/ipcraft/package.json`;
- a matching top-level entry in `CHANGELOG.md`;
- `publisher` and `name` to equal `bahonavi` and `ipcraft-vscode`;
- `license` to equal the SPDX identifier `MIT`; and
- the selected version to be absent from the public Marketplace version list.

These checks make retries fail before publication once a version exists. The
publish command will not use `--skip-duplicate`.

## Build and Verification Flow

The pipeline uses Microsoft-hosted Ubuntu agents and checks out the selected tag
with recursive submodules and tag fetching enabled.

The verification stage installs Node.js 20 dependencies with `npm ci`, then runs
the deterministic release gates already used by CI:

1. local Markdown link validation;
2. ESLint with zero warnings;
3. TypeScript type checking;
4. production and test compilation;
5. CLI distribution and clean-install checks;
6. unit tests with coverage;
7. VSIX packaging through the existing `vscode:prepublish` contract; and
8. `scripts/check-vsix.js` against the resulting archive.

The archive name is `ipcraft-vscode-<version>.vsix`. The pipeline writes a
SHA-256 sidecar, publishes both files as one pipeline artifact, and never invokes
the package command again in later stages.

Two dependent smoke jobs download that artifact and run the existing extension
smoke suite against VS Code 1.80.0 and current stable. This preserves the current
minimum-version and current-version installation contract while proving both
jobs consume the same recorded artifact.

Vendor-tool and hardware suites remain outside the release pipeline because
they run on specialized self-hosted infrastructure and are not part of the VSIX
installation contract. Their existing workflows continue to provide broader
integration evidence.

## Publication and Authentication

The publish stage exists only when the `publish` parameter is `true` and all
verification and smoke jobs have passed. It is a deployment job targeting an
Azure DevOps environment named `vscode-marketplace`. Repository documentation
requires that environment to have designated approvers and exclusive locking
configured in Azure DevOps. Those checks are owned outside YAML so a repository
change cannot remove its own approval gate.

The deployment uses an Azure service connection named
`vscode-marketplace-entra`. It represents a user-assigned managed identity
federated to Azure Pipelines. The identity is a Contributor on the `bahonavi`
Marketplace publisher and has no stored PAT. The deployment downloads the
pipeline artifact, verifies its SHA-256 sidecar, and runs:

```text
npx vsce publish --packagePath "$VSIX_PATH" --azure-credential
```

The command publishes the already-built archive. It does not modify versions,
create tags, rebuild output, or generate another VSIX.

## Post-publication Verification

Publication is followed by bounded polling because Marketplace indexing is not
instantaneous. The verifier polls every 10 seconds for up to 60 attempts, giving
Marketplace indexing approximately 10 minutes before failing. It waits for the
exact version to become visible and then checks the public Marketplace record
for:

- publisher and extension identity;
- version;
- display name and description;
- categories;
- repository, homepage, and issue links; and
- expected listing assets and manifest content, including the icon, README,
  changelog, commands, and license declaration.

It then installs `bahonavi.ipcraft-vscode@<version>` from the Marketplace into a
fresh VS Code user-data and extensions directory and runs the extension-host
smoke test. A timeout or mismatch fails the deployment while preserving the
pipeline artifact and hash for diagnosis.

The release guide includes a human listing review for rendered icon and README
quality because an API check cannot prove visual presentation. The operator
records completion in the pipeline approval or release notes.

## Repository Changes

- Keep the root manifest license as the SPDX identifier `MIT` and require the
  shipped `LICENSE` file in the VSIX allowlist.
- Add the Azure Pipeline YAML under `azure-pipelines/`.
- Add focused release-contract scripts under `scripts/` for local/testable
  validation and Marketplace metadata verification.
- Add unit tests for tag/version/changelog/identity validation and parsing of
  representative Marketplace responses. Network access is confined to the
  pipeline wrapper, not the pure validation logic.
- Extend `docs/how-to/build-vsix.md` with the release procedure, required Azure
  resources, dry-run instructions, ownership identifiers, first-run checklist,
  post-publication checks, and recovery policy.
- Extend `docs/architecture/vsix-packaging.md` to identify the Azure pipeline as
  the release authority and document the single-artifact boundary.

## Review Hardening

The pre-publish and post-publish archive checks use one shared
`scripts/vsix-archive.js` reader. It returns the parsed
`extension/package.json`, the archive's file set, and entry sizes so both gates
observe identical ZIP parsing and error behavior.

The published-listing validator compares `listing.shortDescription` with the
packaged manifest's `description` field. The root manifest remains the canonical
source; release validation and packaging already ensure that the published
manifest is the release manifest. No second description literal is maintained
in the release tooling.

## Failure and Recovery Policy

- A failure before publishing is safe to rerun against the same tag because no
  Marketplace state changed.
- A publish command that reports an existing version is treated as a hard
  failure and investigated; it is never converted to success.
- If publication succeeds but post-publication verification fails, do not
  publish another archive with the same version. Inspect the public listing and
  retained artifact, then either keep the valid release or publish a corrected
  higher version.
- For a harmful release, prefer publishing a corrected higher version. If the
  extension must be withdrawn, use Marketplace **Unpublish**, which preserves
  statistics. Do not use **Remove** or delete a version as routine rollback;
  those operations are irreversible and version numbers cannot be reused.

## Acceptance Verification

Before enabling publication, a maintainer will:

1. confirm ownership of the `bahonavi` publisher in Marketplace management;
2. confirm the documented publisher and extension IDs against the public
   listing;
3. configure the managed identity, federation, Marketplace Contributor role,
   service connection, and protected `vscode-marketplace` environment;
4. create a new, unpublished version tag and run the pipeline against it with
   `publish: false`;
5. download the retained artifact and compare its SHA-256 with the sidecar;
6. confirm both clean-profile smoke jobs passed; and
7. review the rendered Marketplace listing checklist.

The first publish-mode run then uses a new version tag and requires environment
approval. Completion means the exact artifact is visible and installable from
the Marketplace and all automated and human listing checks are recorded.
