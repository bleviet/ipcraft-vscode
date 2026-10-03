---
description: Execute a complete 3-phase cycle (Plan with Opus -> Code with Sonnet -> Audit with Opus)
argument-hint: <task description>
---

Execute the standard 3-phase engineering workflow for the following request:

$ARGUMENTS

Apply the working rules and architecture rules in AGENTS.md throughout. Follow these phases sequentially:

### Phase 1: Architecture & Planning (main session)
1. Explore with `Read`, `Grep`, `Glob`, and read-only `Bash` (e.g. `git log`, running existing tests). Do not edit source code.
2. If the contract is ambiguous or conflicts with the architecture in AGENTS.md, ask the user before planning.
3. Write a concise implementation spec:
   - Target files and functions, including changes the architecture rules require (parallel table editors, extract-before-extend, characterization tests).
   - Required inputs, outputs, and edge cases (from the spec or schema, not speculative guards).
   - Exact verification commands: targeted tests, `npm run lint`, `npm run type-check`.
   - Minimal surface area: no speculative abstractions.

### Phase 2: Implementation (`coder` subagent)
Dispatch `coder` via the Agent tool with this handoff:

```text
TASK: <actionable task name>
SPEC:
- Modify `path/to/file` to implement <concrete logic>
CONSTRAINTS:
- Do not modify interfaces outside the listed files.
- Follow existing patterns in <reference file>.
- If the spec is ambiguous or conflicts with the code, stop and report back; do not guess.
VERIFICATION:
- Run: <test command>, `npm run lint`, `npm run type-check`
- Success criteria: all pass with zero warnings.
```

Before dispatching, record `git status --short` as the baseline; the working tree may already hold unrelated uncommitted changes.

`coder` must run the verification and report the result, plus the list of files it created, modified, or deleted, before returning.

### Phase 3: Audit (`reviewer` subagent)
Dispatch `reviewer` with the Phase 1 spec, the baseline `git status --short`, and `coder`'s file list. The reviewer audits exactly those files (tracked changes via `git diff -- <files>`, new untracked files read in full) and flags any entry in the current `git status --short` that is neither in the baseline nor in the list. It checks for:
- Diff creep (lines or formatting edits not traceable to the spec).
- Over-engineering or unnecessary defensive code.
- Edge cases from the spec that are not handled.
- Missing regression tests.

`[BLOCKER]` and `[MAJOR]` findings go back to `coder` to fix, then re-audit. Report `[NIT]`s to the user without fixing them. Once clean, summarize the final diff and verification outcome for the user.
