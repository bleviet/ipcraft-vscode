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
