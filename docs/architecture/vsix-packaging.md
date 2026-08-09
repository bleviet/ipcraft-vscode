# VSIX packaging contract

The production VSIX is an allowlisted runtime artifact. CI creates it once with
`npx vsce package`, checks its archive contents, uploads that exact file, installs
it into VS Code, and runs the extension-host smoke test against the installed
copy.

The shipped content is limited to:

- the extension manifest, VSIX metadata, README, changelog, and MIT license;
- the production extension and webview JavaScript/CSS bundles, third-party
  bundle license notices, and the bundled UI font;
- every generator template and built-in scaffold pack copied from
  `src/generator/`;
- the three runtime JSON schemas and every built-in bus definition copied from
  `ipcraft-spec/`;
- the extension icon, concept resource, and walkthrough Markdown used by VS
  Code.

`scripts/check-vsix.js` rejects everything else, including source maps,
`node_modules`, source and test files, fixtures, secrets, development
configuration, and unreviewed new top-level content. It also requires every
runtime source asset to be represented in the archive.

The size budget is 2 MiB compressed and 5 MiB unpacked. This leaves room for
normal bundle growth while preventing source maps or another development tree
from returning unnoticed. Any budget increase requires updating both this
document and the constants in `scripts/check-vsix.js` with a reviewed reason.

## Marketplace release boundary

Marketplace release execution is a separate, manually dispatched GitHub Actions
contract (`.github/workflows/marketplace-release.yml`):
`verify -> smoke -> protected publish -> postpublish`. `verify` packages the
versioned VSIX once, validates it, and uploads the immutable workflow artifact
with its SHA-256 sidecar. Both smoke matrix legs download and checksum-verify
that exact artifact before installing it on the minimum supported and stable VS
Code versions. The protected `vscode-marketplace` GitHub environment downloads
and verifies the same artifact before `vsce` publishes it through OIDC-federated
Azure authentication (`azure/login`) — no Marketplace personal access token is
stored anywhere. `postpublish` independently downloads the Marketplace package,
validates its contents and metadata, then installs it for a stable smoke test.

The regular `CI` workflow deliberately does not publish: it validates changes on
every push and pull request but does not own the Marketplace Contributor
identity or the protected environment approval boundary. Only the manually
dispatched `Marketplace Release` workflow can publish, so an identity-based OIDC
credential, required environment reviewers, and a serialized concurrency group
govern the only operation that can make a version public.
