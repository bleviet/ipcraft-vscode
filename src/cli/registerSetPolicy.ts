/**
 * Register-set versioning for the headless CLI: decides, without any flag, whether a design's
 * versioned memory maps are up to date, and with `--register-set-policy` plans the
 * `versionHistory` writes. Kept free of the generator entry points so it is testable on its own.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  buildMapReleases,
  describeRecorded,
  historyEdits,
  invalidCoreVersionMessage,
  readCoreReleaseInfo,
  type MapRelease,
} from '../services/versioning/releaseFiles';
import { hasVersionGateErrors } from '../services/versioning/versionGate';
import { planRelease, releaseStates } from '../shared/versioning/planRelease';
import type { ReleaseState } from '../shared/versioning/versionHistory';
import { applyPathEdits } from '../yamledit';

export type RegisterSetPolicy = 'adopt' | 'overwrite';

export interface RegisterSetPlan {
  /** Per-map reasons generation must not proceed; empty when it can. */
  problems: string[];
  /** The new text of each `.mm.yml` that changes, one entry per file. */
  writes: Array<{ filePath: string; text: string }>;
  /** What the writes record, one line per map. */
  recorded: string[];
}

interface MapFileText {
  filePath: string;
  text: string;
  releases: MapRelease[];
}

/** Why a map blocks generation under `policy` (undefined = no flag), or undefined if it does not. */
function problemFor(
  name: string,
  state: ReleaseState,
  coreVersion: string,
  policy: RegisterSetPolicy | undefined
): string | undefined {
  if (state.kind === 'up-to-date') {
    return undefined;
  }
  if (state.kind === 'pending' && !state.coreVersionRecorded && policy === 'overwrite') {
    return `${name}: version ${coreVersion} is not recorded; use --register-set-policy adopt`;
  }
  if (policy === 'adopt' && state.kind === 'pending' && state.coreVersionRecorded) {
    return `${name}: version ${coreVersion} is already recorded; bump vlnv.version or use --register-set-policy overwrite`;
  }
  if (policy !== undefined) {
    return undefined;
  }
  switch (state.kind) {
    case 'pending': {
      const policies = state.coreVersionRecorded ? 'adopt|overwrite' : 'adopt';
      return `${name}: register layout changed since version ${state.reference.version}; re-run with --register-set-policy ${policies}`;
    }
    case 'version-bump-only':
      return `${name}: version ${coreVersion} is not recorded yet; re-run with --register-set-policy adopt`;
    case 'empty':
      return `${name}: no version recorded yet; re-run with --register-set-policy adopt`;
  }
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Reads the IP core and its imported memory maps and plans the release for `policy`. Reads only:
 * `writeRegisterSets` applies the result. While the `$version` gate blocks generation the plan is
 * empty (no problems, no writes): generation then reports its errors. A design without a
 * versioned map is never gated or planned. A file that cannot be read or parsed is left to
 * generation to report.
 */
export async function planRegisterSets(
  ipYamlPath: string,
  policy?: RegisterSetPolicy
): Promise<RegisterSetPlan> {
  const plan: RegisterSetPlan = { problems: [], writes: [], recorded: [] };
  const ipText = await readIfPresent(ipYamlPath);
  const info =
    ipText === undefined ? undefined : readCoreReleaseInfo(ipText, path.dirname(ipYamlPath));
  if (ipText === undefined || !info || info.version === '') {
    return plan;
  }

  const files: MapFileText[] = [];
  for (const { absPath, entryOverrides } of info.imports) {
    const text = await readIfPresent(absPath);
    if (text === undefined) {
      continue;
    }
    try {
      files.push({ filePath: absPath, text, releases: buildMapReleases(text, entryOverrides) });
    } catch {
      // Not valid YAML: generation reports it.
    }
  }
  const inputs = files.flatMap((file) => file.releases.map((release) => release.input));
  // A design without a versioned map behaves as before register-set versioning existed: no gate
  // call, nothing planned. Generation reports whatever is wrong with it.
  if (!inputs.some((input) => input.versioned)) {
    return plan;
  }
  // A design the `$version` gate blocks cannot be generated, so register-set problems (which ask
  // for a flag that cannot help) are not reported and nothing is recorded: generation (and
  // `verify`) then reports the gate errors themselves.
  if (await hasVersionGateErrors(ipText, ipYamlPath)) {
    return plan;
  }
  const states = releaseStates(inputs, info.version);

  const versionError = invalidCoreVersionMessage(info.scheme, info.version);
  inputs.forEach((input, index) => {
    const state = states[index];
    if (!state || state.kind === 'up-to-date') {
      return;
    }
    const problem = versionError
      ? `${input.mapName}: ${versionError}`
      : problemFor(input.mapName, state, info.version, policy);
    if (problem) {
      plan.problems.push(problem);
    }
  });
  if (plan.problems.length > 0 || policy === undefined) {
    return plan;
  }
  const plans = planRelease(inputs, info.version, info.scheme, policy);
  let offset = 0;
  for (const file of files) {
    const filePlans = plans.slice(offset, offset + file.releases.length);
    offset += file.releases.length;
    const edits = historyEdits(file.releases, filePlans);
    const text = edits.length > 0 ? applyPathEdits(file.text, edits) : file.text;
    if (text !== file.text) {
      plan.writes.push({ filePath: file.filePath, text });
      plan.recorded.push(
        ...filePlans.flatMap((filePlan) => describeRecorded(filePlan, info.version, policy))
      );
    }
  }
  return plan;
}

/** Writes each changed `.mm.yml` once. */
export async function writeRegisterSets(plan: RegisterSetPlan): Promise<void> {
  for (const { filePath, text } of plan.writes) {
    await fs.writeFile(filePath, text, 'utf8');
  }
}
