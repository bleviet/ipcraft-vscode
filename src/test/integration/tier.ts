/**
 * Test-tier helpers for the integration suite.
 *
 * Tier 0 — pure Node, no tools needed (snapshot tests, round-trip tests).
 * Tier 1 — open-source tools required in CI (GHDL, iverilog, Docker/Quartus).
 *           FAILS loudly when the tool is absent, unless SKIP_<TOOL>=1 is set.
 * Tier 2 — licensed tools (Vivado). Skip is allowed but never silent.
 *           FAILS only when REQUIRE_<TOOL>=1 is set.
 *
 * Usage:
 *
 *   // In a tier-1 test body:
 *   if (guardTier1('ghdl', () => toolOnPath('ghdl'))) return;
 *
 *   // In a tier-2 test body:
 *   if (guardTier2('vivado', () => fs.existsSync(VIVADO_BIN), `not found at ${VIVADO_BIN}`)) return;
 */

import * as fs from 'fs';
import { spawnSync } from 'child_process';

export function toolOnPath(name: string): boolean {
  return spawnSync('which', [name], { encoding: 'utf8' }).status === 0;
}

/**
 * Guard for Tier 1 (open-source, required in CI).
 *
 * - If the tool is present: returns false (proceed).
 * - If SKIP_<TOOL>=1 is set: warns and returns true (caller returns early, test passes).
 * - Otherwise: throws, making the test fail loudly.
 */
export function guardTier1(toolName: string, available: () => boolean): boolean {
  if (available()) {
    return false;
  }

  const skipKey = `SKIP_${toolName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  if (process.env[skipKey] === '1') {
    // Explicit opt-out: developer chose to skip even though this is required by default

    console.warn(
      `[tier 1] SKIPPING ${toolName}: ${skipKey}=1 (explicit opt-out).\n` +
        `  Remove this env var on CI where the tool must be present.`
    );
    return true;
  }

  throw new Error(
    `[tier 1] Required tool '${toolName}' is not available.\n` +
      `  Install it in CI, or set ${skipKey}=1 to explicitly opt out (not recommended in CI).`
  );
}

/**
 * Guard for Tier 2 (licensed tools; skip is allowed).
 *
 * - If the tool is present: returns false (proceed).
 * - If REQUIRE_<TOOL>=1: throws (CI host has declared the tool must be present).
 * - Otherwise: warns visibly, records a skip entry, and returns true.
 *
 * Skip telemetry: when SKIP_TELEMETRY_FILE is set, appends a NDJSON record so
 * dashboards can track coverage gaps rather than seeing green-by-omission.
 */
export function guardTier2(toolName: string, available: () => boolean, reason?: string): boolean {
  if (available()) {
    return false;
  }

  const requireKey = `REQUIRE_${toolName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  if (process.env[requireKey] === '1') {
    throw new Error(
      `[tier 2] '${toolName}' is required (${requireKey}=1) but was not found.\n` +
        `  ${reason ?? 'Tool not available.'}`
    );
  }

  const skipReason = reason ?? 'tool not found';
  console.warn(
    `\n[tier 2] SKIPPING ${toolName}: ${skipReason}.\n` +
      `  Set ${requireKey}=1 to fail instead of skipping.\n`
  );

  recordSkip(toolName, skipReason);
  return true;
}

/**
 * Append a skip record to SKIP_TELEMETRY_FILE (NDJSON) if the env var is set.
 * Each line is a self-contained JSON object so the file can be streamed by CI dashboards.
 */
function recordSkip(toolName: string, reason: string): void {
  const telemetryFile = process.env['SKIP_TELEMETRY_FILE'];
  if (!telemetryFile) {
    return;
  }
  const record = JSON.stringify({
    tool: toolName,
    tier: 2,
    reason,
    timestamp: new Date().toISOString(),
  });
  try {
    fs.appendFileSync(telemetryFile, record + '\n', 'utf8');
  } catch {
    // Non-fatal: telemetry write failures must not break the test run.
  }
}
