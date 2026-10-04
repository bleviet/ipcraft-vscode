---
name: orchestrate
description: Plan -> implement -> audit workflow for non-trivial IPCraft production changes (multi-file edits, new behavior, bug fixes touching logic). Use when the user invokes /orchestrate or asks for a change to be planned, implemented, and independently audited.
---

# Orchestrate: plan, implement, audit

Execute the standard 3-phase engineering workflow for the request that invoked
this skill. Apply the working rules and architecture rules in AGENTS.md
throughout. Follow the phases sequentially.

## Roles

| Role | Who | Role prompt |
|---|---|---|
| Planner | the main session | this file |
| `coder` | implementation subagent | `references/coder.md` |
| `reviewer` | read-only audit subagent | `references/reviewer.md` |

How to dispatch a role depends on the tool:

- **Claude Code:** use the Agent tool with `subagent_type` `coder` or
  `reviewer`. Both are defined in `.claude/agents/` (coder on Sonnet,
  reviewer on Opus) and load their role prompt from this folder.
- **Tools with subagents or custom agents** (e.g. GitHub Copilot, Antigravity):
  start a subagent with fresh context. Pass it the role prompt file plus the
  handoff described below.
- **No subagent support:** do the phase yourself, following the role prompt
  exactly. For Phase 3, start a separate read-only pass: re-read the diff from
  scratch against the spec, and do not edit files while auditing.

## Phase 1: Architecture and planning (main session)

1. Explore with read-only tools (file reads, search, `git log`, running
   existing tests). Do not edit source code.
2. If the contract is ambiguous or conflicts with the architecture in
   AGENTS.md, ask the user before planning.
3. Write a concise implementation spec:
   - Target files and functions, including changes the architecture rules
     require (parallel table editors, extract-before-extend, characterization
     tests).
   - Required inputs, outputs, and edge cases (from the spec or schema, not
     speculative guards).
   - Exact verification commands: targeted tests, `npm run lint`,
     `npm run type-check`.
   - Minimal surface area: no speculative abstractions.

## Phase 2: Implementation (`coder`)

Before dispatching, record `git status --short` as the baseline; the working
tree may already hold unrelated uncommitted changes.

Dispatch `coder` with this handoff:

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

`coder` must run the verification and report the result, plus the list of
files it created, modified, or deleted, before returning.

## Phase 3: Audit (`reviewer`)

Dispatch `reviewer` with the Phase 1 spec, the baseline `git status --short`,
and `coder`'s file list. The reviewer audits exactly those files (tracked
changes via `git diff -- <files>`, new untracked files read in full) and flags
any entry in the current `git status --short` that is neither in the baseline
nor in the list. It checks for:

- Diff creep (lines or formatting edits not traceable to the spec).
- Over-engineering or unnecessary defensive code.
- Edge cases from the spec that are not handled.
- Missing regression tests.

`[BLOCKER]` and `[MAJOR]` findings go back to `coder` to fix, then re-audit.
Report `[NIT]`s to the user without fixing them. Once clean, summarize the
final diff and verification outcome for the user.
