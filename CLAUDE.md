# CLAUDE.md

@AGENTS.md

## Claude Code: delegation workflow

Non-trivial production changes (multi-file, new behavior, bug fixes touching
logic) follow plan → implement → audit via `/orchestrate`: the main session
plans and verifies, the `coder` subagent implements, and the `reviewer`
subagent audits `git diff` and classifies findings as `[BLOCKER]`/`[MAJOR]`/`[NIT]`.
Small or mechanical edits (typos, docs, config) are done directly. Subagent
tools and models are in `.claude/agents/`; the lifecycle is in
`.claude/commands/orchestrate.md`. The working rules in `AGENTS.md` apply to
the main session and every subagent.
