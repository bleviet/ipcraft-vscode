# Security Policy

## Supported Versions

IPCraft is distributed as a single rolling release through the VS Code
Marketplace and Open VSX. There are no maintained LTS branches — only the
**latest published version** receives security fixes. Upgrade to the latest
release before reporting an issue to confirm it is still present.

## Reporting a Vulnerability

Report suspected vulnerabilities privately using GitHub's **Private
vulnerability reporting**, not a public issue:

1. Go to the [Security tab](https://github.com/bleviet/ipcraft-vscode/security).
2. Click **Report a vulnerability**.
3. Describe the issue, affected version, and reproduction steps.

This opens a private draft security advisory visible only to you and the
maintainers, so the report is never public before a fix ships.

If you cannot access the Security tab, email the maintainer directly at
**vietbach.le@bahonavi.de** with the same details.

### What to include

- Affected version (`Help > About` in VS Code, or the `version` field in
  `package.json`)
- Steps to reproduce, and the smallest `.ip.yml` / `.mm.yml` spec or generated
  output that demonstrates the issue
- Impact assessment: what an attacker can do and under what conditions
  (e.g., only when generating from an untrusted spec, only in a trusted
  workspace, requires a malicious Vivado/Quartus toolchain path, etc.)

### What not to disclose publicly

Do not open a public GitHub issue, discussion, or pull request that describes
the vulnerability, includes a proof-of-concept exploit, or names the flaw
before a fix is released. Do not post details on social media, forums, or the
VS Code Marketplace review section. Public disclosure before a coordinated fix
puts every current user of the extension at risk, since IPCraft runs inside a
developer's VS Code process and can invoke local FPGA toolchains and generate
files onto disk.

## Response Process

- **Acknowledgement**: within 5 business days of the report.
- **Triage**: the maintainer confirms the issue, assesses severity, and
  requests any missing reproduction details.
- **Fix**: a patched version is prepared and published to the Marketplace and
  Open VSX. Timeline depends on severity and complexity; the reporter is kept
  updated through the private advisory thread.
- **Disclosure**: once a fix is released, the advisory is published (with
  credit to the reporter, unless anonymity is requested) and the fix is noted
  in [CHANGELOG.md](CHANGELOG.md).

## Scope

In scope: the IPCraft VS Code extension itself (`src/`), its code generation
templates (`src/generator/templates/`), and the bundled CLI package
(`scripts/pack-cli.js` output). Vulnerabilities in third-party FPGA vendor
toolchains (Vivado, Quartus) that IPCraft merely invokes are out of scope and
should be reported to the respective vendor.
