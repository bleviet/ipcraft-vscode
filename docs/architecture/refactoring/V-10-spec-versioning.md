# V-10 — Spec Versioning (`ipcraft-spec`)

> Status: proposed · Severity: Medium (silent drift between spec and implementation) · Effort: S (1 day + a process decision)
> Enables: [V-1](V-01-unified-domain-model.md) (schema-generated types need a pinned schema)
> Source finding: [architecture.md §7 V-10](../architecture.md#v-10--ipcraft-spec-is-an-untracked-nested-repo)

## Why

`ipcraft-spec/` — the directory holding the JSON schemas (`ip_core.schema.json`,
`memory_map.schema.json`), the file-format templates (`templates/*.mm.yml`, `*.ip.yml`),
and spec documentation — is a **nested git repository that the extension repo does not
track** (it shows as `?`/untracked in `git status`; it is not registered as a submodule in
any `.gitmodules`).

Concretely, the extension depends on it at three binding points:

1. **Build**: webpack copies `ipcraft-spec/schemas/ip_core.schema.json` into
   `dist/resources/schemas/` — the AJV validation source at generation time
   (`IpCoreScaffolder.loadIpCore`).
2. **Dev/test fallbacks**: `IP_CORE_SCHEMA_PATH` resolves into `ipcraft-spec/` directly when
   running unbundled (see V-9).
3. **Conceptually**: every parser tolerance, sanitizer, and importer in the codebase claims
   to implement "the spec."

Consequences of not pinning it:

- **Unreproducible builds.** Two checkouts of the same extension commit can package
  different schemas — whatever happened to sit in the contributor's `ipcraft-spec/` working
  tree, including uncommitted local edits. A VSIX built today and one built next month from
  the same tag may validate user files differently.
- **Silent drift, both directions.** A schema change (new field, tightened enum) lands in
  the spec repo with no signal in the extension repo: no diff, no failing CI, no review
  surface. The reverse too — extension code can start emitting keys the schema doesn't
  know (the `monitorChangeOf` field is exactly such an extension-specific addition; today
  nothing forces that conversation).
- **Fresh clones break subtly.** A new contributor cloning only `ipcraft-vscode` gets no
  `ipcraft-spec/`; the V-9 fallback chains then walk to wrong directories or fail at test
  time with no actionable message.
- **V-1 is blocked.** Generating TypeScript types from the schemas only makes sense when
  "which schema version" is answerable from the extension repo's history.

## Design goals

1. **Reproducibility:** an extension commit fully determines the schema bytes that ship.
2. **Reviewable evolution:** a spec change appears as a diff in extension-repo review
   (a bumped pin), with CI proving the implementation still conforms.
3. **Low friction:** contributors who never touch the spec shouldn't need extra tooling
   knowledge beyond one documented command.

## How

### Decision: pinning mechanism

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Git submodule** (recommended) | Native pinning to an exact spec commit; `git submodule status` is the audit trail; spec stays an independent repo with its own history/issues | Submodule UX (clone `--recursive`, easy-to-forget update commits) — mitigated by CI checks |
| B. npm package (`@bleviet/ipcraft-spec`) | Versioned by semver, lockfile-pinned, no submodule UX | Publish pipeline overhead for a two-person spec; schema iteration during development becomes painful (link/pack dance) |
| C. Vendor (copy schemas in, spec repo is upstream) | Simplest clone story | Manual sync = the current problem with extra steps |

**A** fits the current stage: the spec is co-developed with the extension, changes need to
be cheap, but every change must be visible in extension history. Moving to B later (when the
spec stabilizes or grows external consumers, e.g. a Python backend) remains open — the
binding points don't change.

### Implementation

1. Register the existing directory as a submodule pointing at the spec repo's remote, pinned
   to the current commit. The working tree barely changes; `.gitmodules` and a gitlink entry
   appear.
2. **CI guards** (the actual value of this item):
   - checkout with submodules; fail with a clear message if the submodule is missing or
     dirty;
   - **conformance job**: validate the fixture corpus (`src/test/fixtures/`,
     `ipcraft-spec/templates/*.yml`, the comprehensive examples) against the pinned schemas
     with AJV — this is the tripwire that makes schema/implementation drift loud;
   - (after V-1 task 1) regenerate types and fail on diff — pins types ↔ schema.
3. **Build hardening**: webpack copy step fails the build if the schema files are absent
   (today it likely copies nothing silently — verify and fix while here; overlaps V-9's
   packaging smoke test).
4. **Docs**: CONTRIBUTING note — clone command, how to propose a spec change (PR to spec
   repo → land → bump pin in extension PR with the conformance run green), and the rule that
   extension-specific fields (`monitorChangeOf`, `scaffold_pack`) must be added to the
   schema, not just to code.

### Spec-change workflow (the process this buys)

```
spec PR (schemas + templates)        extension PR (pin bump + impl + fixtures)
        │                                     │
        └── merged ──► submodule bump ────────┘
                       CI: conformance + type-regen + round-trip corpus
```

A schema field that no extension code handles now fails the conformance/type-regen jobs in
the bump PR — drift becomes a red check instead of a latent bug.

## Tasks

1. **Decide A/B/C** (XS — this doc recommends A; needs maintainer sign-off since it changes
   contributor workflow).
2. **Register submodule + fix clone docs** (S). Includes verifying fresh-clone + `npm test`
   works with `--recursive` and fails *informatively* without it (a tiny pretest check:
   "ipcraft-spec missing — run `git submodule update --init`").
3. **CI conformance job** (S). AJV over the fixture/template corpus against pinned schemas.
   Expect this to surface existing nonconformances (e.g. snake_case fixtures vs camelCase
   schema if the schema lacks the aliases) — triage each: fix fixture, or codify the
   tolerance in the schema (`anyOf` alias support), feeding V-1's "tolerant reader" rule.
4. **Webpack copy hardening** (XS). Fail build on missing schema source (coordinate with
   V-9 task 1's smoke test).

## Acceptance criteria

- `git clone --recursive && npm ci && npm test` green on a fresh machine; plain `clone`
  fails with the actionable pretest message.
- Extension repo history shows an exact spec commit for every extension commit
  (`git submodule status`).
- CI conformance job exists and is green — with every fixture triaged, none skipped.
- Building a VSIX with a locally-dirty `ipcraft-spec/` is either blocked or loudly flagged
  in the package step.

## Risks

- Submodule friction is real for contributors unfamiliar with them — contained by the
  pretest check (task 2) and CI messages; revisit option B if friction dominates.
- The conformance job may reveal that current user files in the wild rely on tolerances the
  schema doesn't document. That's a feature of this work, not a blocker: each becomes an
  explicit schema decision instead of an accident of `DataNormalizer`.
