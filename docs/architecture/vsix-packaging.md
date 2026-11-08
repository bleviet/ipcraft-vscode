# VSIX packaging contract

The production VSIX is an allowlisted runtime artifact. CI creates it once with
`npx vsce package`, checks its archive contents, uploads that exact file, installs
it into VS Code, and runs the extension-host smoke test against the installed
copy.

The shipped content is limited to:

- the extension manifest, VSIX metadata, README, changelog, MIT license, and
  `THIRD_PARTY_NOTICES.md` (the elkjs notice and EPL-2.0 text, and the IBM Plex notice
  and OFL-1.1 text);
- the production extension and webview JavaScript/CSS bundles, third-party
  bundle license notices, and the bundled UI font;
- every generator template and built-in scaffold pack copied from
  `src/generator/`;
- `dist/elk.bundled.js`, the one copy of the elkjs layout engine: the system
  viewer page loads it with a script tag before `systemDiagram.js` (webpack
  external `ELK`) and `dist/cli.js` requires it (webpack external
  `commonjs ./elk.bundled.js`), so neither bundle embeds it and the VSIX does not
  pay for it twice (the file is copied unminified so its licence header stays);
- the three IBM Plex WOFF (1.0) files (about 66 KB) under `dist/resources/fonts/`,
  which `ipcraft render` embeds in the SVG images it writes and, converted to
  TrueType in memory, hands to the rasterizer;
- `dist/resources/resvg.wasm`, the unmodified resvg WebAssembly module that
  `ipcraft render` uses for PNG and JPG output (its JavaScript glue and
  `jpeg-js` are bundled into `dist/cli.js`);
- the three runtime JSON schemas and every built-in bus definition copied from
  `ipcraft-spec/`;
- the extension icon, concept resource, and walkthrough Markdown used by VS
  Code.

`scripts/check-vsix.js` rejects everything else, including source maps,
`node_modules`, source and test files, fixtures, secrets, development
configuration, and unreviewed new top-level content. It also requires every
runtime source asset to be represented in the archive.

The size budget is 3.5 MiB compressed and 25 MiB unpacked. The budget was
raised from 2 MiB and 5 MiB for elkjs, the layout engine used by the
system diagram webview (issue #239; now the shared `dist/elk.bundled.js`), which brought the unpacked size to about
7 MB. The unpacked budget leaves headroom for further webview features. The
compressed budget was raised again from 2.5 MiB to 3.5 MiB when the PNG and
JPG rasterizer (resvg WebAssembly, about 2.4 MB, and jpeg-js) was shipped in the
VSIX by decision, so `ipcraft render --out x.png` works everywhere (issue #268;
VSIX 2168010 -> 3141774 bytes compressed, 7503857 -> 10033994 unpacked). The
compressed budget still catches source maps or another development tree
returning unnoticed. Any budget increase requires updating both this document
and the constants in `scripts/check-vsix.js` with a reviewed reason.

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
