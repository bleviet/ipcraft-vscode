# Contributing Guidelines

## Workflow

1. Create a branch from your target base branch
2. Make focused changes
3. Add/update tests
4. Run lint/type-check/tests
5. Open a PR with a clear summary

## Local Validation Checklist

Run before opening a PR:

```bash
npm run lint
npm run type-check
npm run test:unit
npm run compile
```

If your change affects extension-host behavior, also run `npm run test`.

## Commit Messages

Use concise, action-focused messages with conventional prefixes:

| Prefix | Purpose |
|--------|---------|
| `feat:` | New functionality |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `test:` | Test additions/updates |
| `refactor:` | Code reshaping without behavior change |
| `chore:` | Maintenance/tooling |

Examples:

- `fix: clear field table drafts after reorder`
- `test: add useFieldEditor reorder synchronization regression`

## Code Guidelines

- Keep changes scoped to the problem
- Prefer pure functions for algorithms/services
- Preserve existing naming and style conventions
- Avoid `any`; use `unknown` + type guards when needed
- Update docs if behavior or workflow changes

### Frontend Patterns

- Keep components focused and composable
- Move complex interaction logic into hooks/services
- Keep YAML mutation path centralized through resolver/service flow

### Extension Host Patterns

- Use provider/service boundaries
- Keep message contracts explicit and simple
- Avoid direct webview/business coupling in providers

## Testing Expectations

Add or update tests for:

- Bug fixes (regression test preferred)
- Algorithm behavior changes
- Hook/service behavior changes

Test directories:

- `src/test/suite/algorithms/`
- `src/test/suite/services/`
- `src/test/suite/hooks/`
- `src/test/suite/components/`

## Pull Requests

Include in PR description:

1. What changed
2. Why it changed
3. How it was validated (commands + results)
4. Any known follow-up work
