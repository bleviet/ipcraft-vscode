import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { getIpcraftConfigDir } from '../utils/configDir';
import type { ToolVersionChoice } from '../utils/pickToolVersion';

export type VivadoCacheKind = 'catalog' | 'interfaces';

interface VivadoCacheSelection {
  formatVersion: 1;
  scope: string;
  kind: VivadoCacheKind;
  selectedVersion: string | null;
  pinnedVersion: string;
}

function getScope(resourceUri?: vscode.Uri): string {
  if (!resourceUri) {
    return 'global';
  }
  const workspaceUri = vscode.workspace.getWorkspaceFolder?.(resourceUri)?.uri;
  return (workspaceUri ?? resourceUri).toString();
}

function selectionPath(kind: VivadoCacheKind, resourceUri?: vscode.Uri): string {
  const scope = getScope(resourceUri);
  const scopeHash = createHash('sha256').update(scope).digest('hex');
  return path.join(
    getIpcraftConfigDir(),
    'vivado',
    'cache-selections',
    `${scopeHash}.${kind}.json`
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Writes metadata through a sibling file so a failed write cannot corrupt a prior selection. */
async function replaceSelectionFile(filePath: string, contents: string): Promise<void> {
  const parentDir = path.dirname(filePath);
  const name = path.basename(filePath);
  const suffix = `${process.pid}-${Date.now()}`;
  const temporaryPath = path.join(parentDir, `.${name}.tmp-${suffix}`);
  const backupPath = path.join(parentDir, `.${name}.backup-${suffix}`);
  let previousSelectionMoved = false;

  await fs.mkdir(parentDir, { recursive: true });
  await fs.rm(temporaryPath, { force: true });
  try {
    await fs.writeFile(temporaryPath, contents, 'utf8');
    if (await pathExists(filePath)) {
      await fs.rename(filePath, backupPath);
      previousSelectionMoved = true;
    }
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      if (previousSelectionMoved) {
        try {
          await fs.rename(backupPath, filePath);
          previousSelectionMoved = false;
        } catch {
          // Do not delete the backup: it is the only valid prior selection.
        }
      }
      throw error;
    }
    if (previousSelectionMoved) {
      await fs.rm(backupPath, { force: true });
      previousSelectionMoved = false;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
    if (!previousSelectionMoved) {
      await fs.rm(backupPath, { force: true });
    }
  }
}

/**
 * Returns the explicit resource-scoped Vivado cache selection.
 * An absent pin deliberately selects the legacy unversioned cache; readers must
 * never guess a version from configured installs or cache directory contents.
 */
export function getPinnedVivadoCacheVersion(
  config: vscode.WorkspaceConfiguration
): string | undefined {
  const pinnedVersion = config.get<string>('vivado.pinnedVersion', '').trim();
  return pinnedVersion || undefined;
}

/** Records the version whose cache was successfully produced for this resource scope. */
export async function recordVivadoCacheSelection(
  config: vscode.WorkspaceConfiguration,
  kind: VivadoCacheKind,
  choice: ToolVersionChoice | null,
  resourceUri?: vscode.Uri
): Promise<void> {
  const filePath = selectionPath(kind, resourceUri);
  const selection: VivadoCacheSelection = {
    formatVersion: 1,
    scope: getScope(resourceUri),
    kind,
    selectedVersion: choice?.version ?? null,
    pinnedVersion: getPinnedVivadoCacheVersion(config) ?? '',
  };
  await replaceSelectionFile(filePath, JSON.stringify(selection, null, 2));
}

/**
 * Resolves the cache produced for this resource without guessing among installs.
 * A successful scan selection remains authoritative while the pin observed by
 * that scan is unchanged. Changing the pin invalidates old selection metadata.
 */
export async function resolveVivadoCacheVersion(
  config: vscode.WorkspaceConfiguration,
  kind: VivadoCacheKind,
  resourceUri?: vscode.Uri
): Promise<string | undefined> {
  const pinnedVersion = getPinnedVivadoCacheVersion(config) ?? '';
  const expectedScope = getScope(resourceUri);
  try {
    const raw = await fs.readFile(selectionPath(kind, resourceUri), 'utf8');
    const selection = JSON.parse(raw) as VivadoCacheSelection;
    if (
      selection.formatVersion === 1 &&
      selection.scope === expectedScope &&
      selection.kind === kind &&
      selection.pinnedVersion === pinnedVersion
    ) {
      return selection.selectedVersion ?? undefined;
    }
  } catch {
    // Missing or invalid metadata falls back only to the explicit resource pin.
  }
  return pinnedVersion || undefined;
}
