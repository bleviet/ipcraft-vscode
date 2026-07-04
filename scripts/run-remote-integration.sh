#!/usr/bin/env bash
#
# run-remote-integration.sh
#
# Syncs the local working tree to the remote workstation and runs the requested
# integration test suites there.  Results stream back to the local terminal.
#
# Usage:
#   scripts/run-remote-integration.sh [--vivado] [--quartus] [--hdl]
#                                     [--no-compile] [--help]
#
#   With no suite flags, all three suites are run.
#
# Environment (override if paths change):
#   REMOTE_HOST         SSH host alias (default: workstation-proxmox-ubuntu)
#   REMOTE_REPO         Absolute path on remote (default: ~/workspace/opensource/ipcraft-vscode)
#   REMOTE_NODE_BIN     Directory containing node/npm/npx (default: ~/.nvm/versions/node/v24.18.0/bin)
#   REMOTE_VIVADO_BIN   Vivado binary path (default: /home/bale/tools/Xilinx/2026.1/Vivado/bin/vivado)
#   REMOTE_TCLSH_BIN    Quartus tclsh path (default: /home/bale/tools/altera_lite/25.1std/quartus/bin/tclsh)
#   REMOTE_QUARTUS_SH   quartus_sh path    (default: /home/bale/tools/altera_lite/25.1std/quartus/bin/quartus_sh)

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-workstation-proxmox-ubuntu}"
REMOTE_REPO="${REMOTE_REPO:-~/workspace/opensource/ipcraft-vscode}"
REMOTE_NODE_BIN="${REMOTE_NODE_BIN:-/home/bale/.nvm/versions/node/v24.18.0/bin}"
REMOTE_VIVADO_BIN="${REMOTE_VIVADO_BIN:-/home/bale/tools/Xilinx/2026.1/Vivado/bin/vivado}"
REMOTE_TCLSH_BIN="${REMOTE_TCLSH_BIN:-/home/bale/tools/altera_lite/25.1std/quartus/bin/tclsh}"
REMOTE_QUARTUS_SH="${REMOTE_QUARTUS_SH:-/home/bale/tools/altera_lite/25.1std/quartus/bin/quartus_sh}"

RUN_VIVADO=0
RUN_QUARTUS=0
RUN_HDL=0
RUN_ALL=1
NO_COMPILE=0

for arg in "$@"; do
  case "$arg" in
    --vivado)     RUN_VIVADO=1;  RUN_ALL=0 ;;
    --quartus)    RUN_QUARTUS=1; RUN_ALL=0 ;;
    --hdl)        RUN_HDL=1;     RUN_ALL=0 ;;
    --no-compile) NO_COMPILE=1 ;;
    --help)
      sed -n '3,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$RUN_ALL" == "1" ]]; then
  RUN_VIVADO=1
  RUN_QUARTUS=1
  RUN_HDL=1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Syncing local working tree to ${REMOTE_HOST}:${REMOTE_REPO} ..."

rsync -az --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='out/' \
  --exclude='build/' \
  --exclude='coverage/' \
  --exclude='test-results/' \
  --exclude='.git/' \
  --exclude='*.vsix' \
  --exclude='vivado*.jou' \
  --exclude='vivado*.log' \
  --exclude='vivado*.backup.*' \
  --exclude='.vscode-test/' \
  "$REPO_ROOT/" \
  "${REMOTE_HOST}:${REMOTE_REPO}/"

echo "==> Sync complete."

# Build the remote commands: local variables (REMOTE_*, NO_COMPILE, RUN_*) are
# expanded now; remote shell variables are escaped with \$ to survive locally.
ssh "$REMOTE_HOST" bash <<REMOTE_SCRIPT
set -euo pipefail
export PATH="${REMOTE_NODE_BIN}:\$PATH"
cd ${REMOTE_REPO}

echo "==> Remote: initialising submodules ..."
git submodule update --init --recursive 2>&1

echo "==> Remote: checking node_modules ..."
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json 2>/dev/null ]; then
  echo "==> Remote: running npm ci ..."
  npm ci --prefer-offline
else
  echo "==> Remote: node_modules up-to-date, skipping npm ci."
fi

if [[ "${NO_COMPILE}" == "0" ]]; then
  echo "==> Remote: compiling ..."
  npm run compile
fi

FAILED_SUITES=()

if [[ "${RUN_VIVADO}" == "1" ]]; then
  echo ""
  echo "==> Remote: running Vivado integration tests ..."
  VIVADO_BIN="${REMOTE_VIVADO_BIN}" \
  REQUIRE_VIVADO=1 \
  npx jest --config config/jest.integration.js --testPathPatterns=vivado \
    || FAILED_SUITES+=("vivado")
fi

if [[ "${RUN_QUARTUS}" == "1" ]]; then
  echo ""
  echo "==> Remote: running Quartus integration tests (native mode) ..."
  QUARTUS_TCLSH_BIN="${REMOTE_TCLSH_BIN}" \
  QUARTUS_SH_BIN="${REMOTE_QUARTUS_SH}" \
  SKIP_DOCKER=1 \
  npx jest --config config/jest.integration.js --testPathPatterns=quartus \
    || FAILED_SUITES+=("quartus")
fi

if [[ "${RUN_HDL}" == "1" ]]; then
  echo ""
  echo "==> Remote: running HDL integration tests ..."
  npx jest --config config/jest.integration.js --testPathPatterns=hdl \
    || FAILED_SUITES+=("hdl")
fi

echo ""
if [[ \${#FAILED_SUITES[@]} -gt 0 ]]; then
  echo "FAILED suites: \${FAILED_SUITES[*]}"
  exit 1
else
  echo "All requested integration suites PASSED."
fi
REMOTE_SCRIPT
