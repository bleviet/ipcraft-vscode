#!/usr/bin/env sh
#
# Pre-commit safety net: block real-world parser fixtures from ever being
# committed. Invoked by .husky/pre-commit (husky owns .git/hooks here).
#
# Aborts the commit if any staged path is:
#   - under .test-fixtures/
#   - a loose `*_hw.tcl` file
#   - a loose `component.xml` file
#
# These are fetched at test time from public repos and must remain untracked.

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

offenders=$(printf '%s\n' "$staged" | grep -E '(^|/)\.test-fixtures/|(^|/)[^/]*_hw\.tcl$|(^|/)component\.xml$')

if [ -n "$offenders" ]; then
  echo "ERROR: refusing to commit real-world parser fixtures."
  echo "The following staged paths are blocked:"
  printf '%s\n' "$offenders" | sed 's/^/  - /'
  echo ""
  echo "These files are fetched at test time and must never be committed."
  echo "Unstage them with:  git restore --staged <path>"
  exit 1
fi

exit 0
