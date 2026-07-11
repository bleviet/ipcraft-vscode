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
#
# Exception: examples/ -- the `*_hw.tcl`/`component.xml` files there are
# IPCraft's OWN generated output for the hardware-validated example
# projects (see examples/README.md), hand-integrated and committed on
# purpose, not fixtures fetched from a public repo. .test-fixtures/ is
# still blocked everywhere, including under examples/.

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

test_fixture_offenders=$(printf '%s\n' "$staged" | grep -E '(^|/)\.test-fixtures/')
loose_file_offenders=$(printf '%s\n' "$staged" | grep -E '(^|/)[^/]*_hw\.tcl$|(^|/)component\.xml$' | grep -v '^examples/')
offenders=$(printf '%s\n%s\n' "$test_fixture_offenders" "$loose_file_offenders" | grep -v '^$')

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
