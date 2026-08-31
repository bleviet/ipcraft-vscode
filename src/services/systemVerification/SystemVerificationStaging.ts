import * as path from 'path';
import { constants } from 'fs';
import { lstat, mkdir, open, readFile, realpath } from 'fs/promises';
import { StagingPanel, type StagedFile } from '../../providers/StagingPanel';

export interface SystemVerificationStagingResult {
  accepted: boolean;
  writtenPaths: string[];
}

/**
 * Stages generated system-verification sources for review before applying the
 * approved changes to the verification directory.
 */
export async function stageSystemVerificationFiles(
  contents: Record<string, string>,
  outputDir: string
): Promise<SystemVerificationStagingResult> {
  const verificationDir = resolveVerificationDirectory(outputDir);
  const stagedFiles = await categorizeFiles(contents, verificationDir);

  if (stagedFiles.length === 0) {
    return { accepted: true, writtenPaths: [] };
  }

  const decision = await StagingPanel.show(stagedFiles, []);
  if (!decision.confirmed) {
    return { accepted: false, writtenPaths: [] };
  }

  const mergedPaths = new Set(decision.mergedPaths);
  const overwritePaths = new Set(decision.overwritePaths);
  const filesToWrite = stagedFiles.filter(
    (file) =>
      file.status !== 'unchanged' &&
      !mergedPaths.has(file.relativePath) &&
      (file.status === 'new' || overwritePaths.has(file.relativePath))
  );
  const writtenPaths: string[] = [];

  for (const file of filesToWrite) {
    await ensureSafeParentDirectory(verificationDir, file.diskPath);
    await assertNoSymlinkComponents(verificationDir, file.diskPath);
    await writeWithoutFollowingSymlink(verificationDir, file);
    writtenPaths.push(file.relativePath);
  }

  return { accepted: true, writtenPaths };
}

async function categorizeFiles(
  contents: Record<string, string>,
  verificationDir: string
): Promise<StagedFile[]> {
  return Promise.all(
    Object.entries(contents).map(async ([relativePath, content]) => {
      const diskPath = resolveGeneratedPath(verificationDir, relativePath);
      await assertNoSymlinkComponents(verificationDir, diskPath);
      try {
        const existing = await readFile(diskPath, 'utf8');
        return {
          relativePath,
          status: existing === content ? 'unchanged' : 'modified',
          protected: false,
          content,
          diskPath,
        };
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) {
          throw error;
        }
        return {
          relativePath,
          status: 'new',
          protected: false,
          content,
          diskPath,
        };
      }
    })
  );
}

function resolveVerificationDirectory(outputDir: string): string {
  if (!path.isAbsolute(outputDir)) {
    throw new Error('The verification directory must be an absolute path.');
  }
  return path.resolve(outputDir);
}

function resolveGeneratedPath(verificationDir: string, relativePath: string): string {
  const diskPath = path.resolve(verificationDir, relativePath);
  const relativeToVerificationDir = path.relative(verificationDir, diskPath);
  if (
    relativeToVerificationDir === '' ||
    relativeToVerificationDir === '..' ||
    relativeToVerificationDir.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToVerificationDir)
  ) {
    throw new Error(
      `Generated path ${relativePath} must remain within the verification directory.`
    );
  }
  return diskPath;
}

async function ensureSafeParentDirectory(verificationDir: string, diskPath: string): Promise<void> {
  const relativeParent = path.relative(verificationDir, path.dirname(diskPath));
  const directoryParts = relativeParent === '' ? [] : relativeParent.split(path.sep);
  let currentDirectory = verificationDir;

  await ensureDirectory(currentDirectory);
  for (const part of directoryParts) {
    currentDirectory = path.join(currentDirectory, part);
    await ensureDirectory(currentDirectory);
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    const status = await lstat(directory);
    if (status.isSymbolicLink()) {
      throw new Error(`Generated path contains a symbolic link: ${directory}`);
    }
    if (!status.isDirectory()) {
      throw new Error(`Verification path is not a directory: ${directory}`);
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error;
    }
    await mkdir(directory);
    await ensureDirectory(directory);
  }
}

async function assertNoSymlinkComponents(verificationDir: string, diskPath: string): Promise<void> {
  const relativePath = path.relative(verificationDir, diskPath);
  const parts = relativePath === '' ? [] : relativePath.split(path.sep);
  let currentPath = verificationDir;

  for (const part of ['', ...parts]) {
    if (part !== '') {
      currentPath = path.join(currentPath, part);
    }
    try {
      const status = await lstat(currentPath);
      if (status.isSymbolicLink()) {
        throw new Error(`Generated path contains a symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
  }
}

async function writeWithoutFollowingSymlink(
  verificationDir: string,
  file: StagedFile
): Promise<void> {
  const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;

  const canonicalRoot = await realpath(verificationDir);
  await assertCanonicalParent(verificationDir, canonicalRoot, file.diskPath);
  const fileHandle = await open(
    file.diskPath,
    constants.O_WRONLY |
      (noFollow ?? 0) |
      (file.status === 'new' ? constants.O_CREAT | constants.O_EXCL : 0),
    0o666
  );
  try {
    await assertCanonicalParent(verificationDir, canonicalRoot, file.diskPath);
    const openedStatus = await fileHandle.stat();
    const currentStatus = await lstat(file.diskPath);
    if (
      currentStatus.isSymbolicLink() ||
      openedStatus.dev !== currentStatus.dev ||
      openedStatus.ino !== currentStatus.ino
    ) {
      throw new Error(`Generated path changed while opening: ${file.diskPath}`);
    }
    await fileHandle.truncate(0);
    await fileHandle.writeFile(file.content, 'utf8');
  } finally {
    await fileHandle.close();
  }
}

async function assertCanonicalParent(
  verificationDir: string,
  canonicalRoot: string,
  diskPath: string
): Promise<void> {
  const currentRoot = await realpath(verificationDir);
  const canonicalParent = await realpath(path.dirname(diskPath));
  if (currentRoot !== canonicalRoot || !isPathWithin(canonicalRoot, canonicalParent)) {
    throw new Error(`Generated path must remain within the verification directory: ${diskPath}`);
  }
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
