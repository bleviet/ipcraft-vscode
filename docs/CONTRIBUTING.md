# Contributing

Thanks for contributing to `ipcraft-vscode`.

## Workflow

1. Create a branch from your target base branch.
2. Make focused changes.
3. Add/update tests.
4. Run lint/type-check/tests.
5. Open a PR with a clear summary.

---

## Local Validation Checklist

Run these before opening a PR:

```bash
npm run lint
npm run type-check
npm run test:unit
npm run compile
```

If your change affects extension-host behavior or custom editor integration, also run:

```bash
npm run test
```

---

## Commit Message Guidance

Use concise, action-focused messages. Conventional prefixes are recommended:

- `feat:` new functionality
- `fix:` bug fix
- `docs:` documentation only
- `test:` test additions/updates
- `refactor:` code reshaping without behavior change
- `chore:` maintenance/tooling

Examples:

- `fix: clear field table drafts after reorder`
- `test: add useFieldEditor reorder synchronization regression`
- `docs: refresh architecture and development guides`

---

## Code Guidelines

- Keep changes scoped to the problem.
- Prefer pure functions for algorithms/services.
- Preserve existing naming and style conventions.
- Avoid `any`; use `unknown` + type guards when needed.
- Update docs if behavior or workflow changes.

### Frontend patterns

- Keep components focused and composable.
- Move complex interaction logic into hooks/services.
- Keep YAML mutation path centralized through current resolver/service flow.

### Extension-host patterns

- Use provider/service boundaries.
- Keep message contracts explicit and simple.
- Avoid direct webview/business coupling in providers.

---

## Testing Expectations

Add or update tests for:

- bug fixes (regression test preferred)
- algorithm behavior changes
- hook/service behavior changes

Current unit test tree lives under:

- `src/test/suite/algorithms`
- `src/test/suite/services`
- `src/test/suite/hooks`
- `src/test/suite/components`

---

## Documentation Expectations

When relevant, update one or more of:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- interaction-specific docs in `docs/`

---

## Pull Request Notes

Include in PR description:

1. What changed
2. Why it changed
3. How it was validated (commands + results)
4. Any known follow-up work
