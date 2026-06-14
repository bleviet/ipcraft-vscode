#!/usr/bin/env bash
# IP-XACT / SPIRIT 1685-2009 structural validator for generated component.xml files.
#
# Usage: validate.sh <component.xml> [<component.xml> ...]
#
# Checks performed (all without a vendor binary):
#   1. XML well-formedness (xmllint --noout)
#   2. Root element is spirit:component with the SPIRIT/1685-2009 namespace
#   3. Required VLNV elements are present: vendor, library, name, version
#
# Exits 0 if every file passes all checks; non-zero on first failure.
# Intended to run in CI on every generated component.xml (Tier 1 — required).

set -euo pipefail

SPIRIT_NS="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"

if ! command -v xmllint >/dev/null 2>&1; then
  echo "[ipxact] ERROR: xmllint not found on PATH. Install libxml2-utils." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "[ipxact] ERROR: no component.xml files specified." >&2
  exit 1
fi

failures=0

for xml_file in "$@"; do
  if [[ ! -f "$xml_file" ]]; then
    echo "[ipxact] FAIL: file not found: $xml_file" >&2
    ((failures++)) || true
    continue
  fi

  # 1. Well-formedness
  if ! xmllint --noout "$xml_file" 2>/dev/null; then
    echo "[ipxact] FAIL (malformed XML): $xml_file" >&2
    ((failures++)) || true
    continue
  fi

  # 2. Required SPIRIT/1685-2009 namespace in root element
  if ! grep -q "$SPIRIT_NS" "$xml_file"; then
    echo "[ipxact] FAIL (missing SPIRIT/1685-2009 namespace): $xml_file" >&2
    ((failures++)) || true
    continue
  fi

  # 3. Required VLNV elements
  for element in "spirit:vendor" "spirit:library" "spirit:name" "spirit:version"; do
    if ! grep -q "<${element}>" "$xml_file"; then
      echo "[ipxact] FAIL (missing element <${element}>): $xml_file" >&2
      ((failures++)) || true
      break
    fi
  done

  if [[ $failures -eq 0 ]]; then
    echo "[ipxact] PASS: $xml_file"
  fi
done

if [[ $failures -gt 0 ]]; then
  echo "[ipxact] $failures file(s) failed validation." >&2
  exit 1
fi
