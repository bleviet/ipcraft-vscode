import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder, applyExecutableMode } from '../generator/IpCoreScaffolder';
import { ResourceRoots } from './ResourceRoots';
import { updateFileSets } from './FileSetUpdater';
import type { GenerateOptions } from '../generator/types';
import { readGenerationIndentation } from '../generator/generationSettings';
import { StagingPanel } from '../providers/StagingPanel';
import type { StagedFile, StagingAction } from '../providers/StagingPanel';
import { classifyModifiedFile } from '../generator/staging/classifyStagedFile';
import { readBaseline, writeBaselines } from '../generator/generationBaseline';
import { WebviewStagingBridge } from '../providers/WebviewStagingBridge';
import { getGeneratedArtifactsEmitter } from './GeneratedArtifactsEmitter';
import { CONFIG_KEY_IPCRAFT_GENERATE } from '../utils/configKeys';
import type { IpcraftIssue } from '../shared/issues';

const logger = new Logger('GenerationEngine');

export type GenerationRunResult =
  | { success: true; ipCoreName: string }
  | { success: false; issues?: readonly IpcraftIssue[] };

/** Compose the failure toast: the error plus the first (error-first) conformance issue. */
export function formatGenerationFailure(
  error: string | undefined,
  issues: readonly IpcraftIssue[] | undefined
): string {
  const base = `Generation failed: ${error ?? 'Unknown error'}`;
  if (!issues || issues.length === 0) {
    return base;
  }
  const first = issues.find((issue) => issue.severity === 'error') ?? issues[0];
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${base} ${first.message}${more}`;
}

/**
 * Read the active scaffold pack name from settings. Returns undefined when the
 * YAML's own scaffold_pack field should take precedence (i.e. when the setting is empty).
 */
export function readScaffoldPackSetting(genCfg: vscode.WorkspaceConfiguration): string | undefined {
  const explicit = genCfg.get<string>('scaffoldPack', '');
  return explicit || undefined;
}

async function categorizeFiles(
  generatedContents: Record<string, string>,
  outputDir: string,
  protectedPaths: string[],
  frameworkTestbenchPaths: string[] = []
): Promise<StagedFile[]> {
  const protectedSet = new Set(protectedPaths);
  const frameworkSet = new Set(frameworkTestbenchPaths);
  return Promise.all(
    Object.entries(generatedContents).map(async ([relativePath, content]) => {
      const diskPath = path.join(outputDir, relativePath);
      const isProtected = protectedSet.has(relativePath);
      const origin = frameworkSet.has(relativePath) ? 'framework-testbench' : undefined;
      const baseline = await readBaseline(outputDir, relativePath);
      try {
        const existing = await readFile(diskPath, 'utf8');
        if (existing === content) {
          return {
            relativePath,
            status: 'unchanged',
            content,
            diskPath,
            protected: isProtected,
            origin,
            baseline,
            actions: [],
          };
        }
        return {
          relativePath,
          status: 'modified',
          content,
          diskPath,
          protected: isProtected,
          origin,
          baseline,
          ...classifyModifiedFile({
            relativePath,
            isProtected,
            current: existing,
            incoming: content,
            baseline,
          }),
        };
      } catch {
        // File does not exist yet — treat it as a new file to be created.
        return {
          relativePath,
          status: 'new',
          content,
          diskPath,
          protected: false,
          origin,
          baseline,
          actions: [],
        };
      }
    })
  );
}

/** Content to write for a modified file under the chosen action; undefined means skip. */
function contentForAction(f: StagedFile, action: StagingAction | undefined): string | undefined {
  switch (action) {
    case 'overwrite':
      return f.content;
    case 'auto-merge':
      return f.autoMergeContent;
    case 'sync-interface':
      return f.syncedContent;
    default:
      return undefined;
  }
}

export async function runGenerator(
  resourceRoots: ResourceRoots,
  context: vscode.ExtensionContext,
  ipCoreUri: vscode.Uri,
  outputDir: string,
  options: GenerateOptions & { updateYaml?: boolean; silent?: boolean },
  progressTitle: string
): Promise<GenerationRunResult> {
  const sourceDocument = await vscode.workspace.openTextDocument(ipCoreUri);
  const sourceText = sourceDocument.getText();
  const workspaceIndentation = readGenerationIndentation(
    vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE)
  );

  // Phase 1: Generate all file content in memory (no disk writes).
  // Use a neutral label — the operation title is reserved for Phase 4 when files are written.
  let dryResult:
    | Awaited<ReturnType<InstanceType<typeof IpCoreScaffolder>['generateAll']>>
    | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Analyzing…', cancellable: false },
    async () => {
      const generator = new IpCoreScaffolder(
        logger,
        new TemplateLoader(logger, resourceRoots.templatesDir),
        resourceRoots
      );
      dryResult = await generator.generateAll(ipCoreUri.fsPath, outputDir, {
        workspaceIndentation,
        ...options,
        sourceText,
        dryRun: true,
      });
    }
  );

  if (!dryResult?.success || !dryResult.generatedContents || !dryResult.ipCoreName) {
    void vscode.window.showErrorMessage(
      formatGenerationFailure(dryResult?.error, dryResult?.issues)
    );
    return { success: false, issues: dryResult?.issues };
  }

  // Phase 2: Categorise generated files against what is currently on disk
  const staged = await categorizeFiles(
    dryResult.generatedContents,
    outputDir,
    dryResult.protectedPaths ?? [],
    dryResult.frameworkTestbenchPaths ?? []
  );

  // Phase 3: Show the staging overlay in the canvas webview when possible; fall back to
  // a separate StagingPanel when the canvas webview is not registered (e.g. command run
  // while the editor is not open, or from the Source Control / Explorer view).
  // Files the user reconciled in the merge editor — the merge editor writes them
  // on completion, so the bulk write below must skip them.
  let mergedPaths = new Set<string>();
  // Chosen action per modified file; falls back to each file's default action
  // (locked managed:false -> keep; unlocked hand-edited -> auto-merge when clean, else
  // keep; otherwise overwrite). The lock in the .ip.yml itself is left untouched.
  let chosenActions: Record<string, StagingAction> = {};
  if (staged.length > 0) {
    const bridge = WebviewStagingBridge.getInstance();
    const bridgeResult = await bridge.showInWebview(
      ipCoreUri.fsPath,
      staged,
      path.basename(outputDir),
      dryResult.warnings ?? []
    );
    const decision = bridgeResult ?? (await StagingPanel.show(staged, dryResult.warnings ?? []));
    if (!decision.confirmed) {
      return { success: false };
    }
    mergedPaths = new Set(decision.mergedPaths);
    chosenActions = decision.actions;
  }

  // Phase 4: Write new files unconditionally; write modified files according to
  // the chosen per-file action (overwrite / auto-merge / sync-interface; keep
  // skips) unless the file was sent to the merge editor instead. Skip unchanged
  // files.
  // Pre-compute the write list so we only show the progress notification when
  // there is real disk work to do — avoiding a misleading "Generating…" flash
  // otherwise.
  const protectedExisting = new Set(dryResult.protectedPaths ?? []);
  const executablePaths = new Set(dryResult.executablePaths ?? []);
  const actionOf = (f: StagedFile): StagingAction | undefined =>
    chosenActions[f.relativePath] ?? f.defaultAction;
  const filesToWrite = staged
    .filter((f) => f.status !== 'unchanged' && !mergedPaths.has(f.relativePath))
    .map((f) => ({
      file: f,
      content: f.status === 'new' ? f.content : contentForAction(f, actionOf(f)),
    }))
    .filter((w): w is { file: StagedFile; content: string } => w.content !== undefined);
  const writtenRelPaths: string[] = [];
  let writeError: string | undefined;

  if (filesToWrite.length > 0) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
      async () => {
        try {
          await Promise.all(
            filesToWrite.map(async ({ file: f, content }) => {
              await mkdir(path.dirname(f.diskPath), { recursive: true });
              await writeFile(f.diskPath, content, 'utf8');
              writtenRelPaths.push(f.relativePath);
              if (executablePaths.has(f.relativePath)) {
                await applyExecutableMode(f.diskPath, logger);
              }
            })
          );
        } catch (err) {
          writeError = err instanceof Error ? err.message : String(err);
        }
      }
    );
  }

  if (writeError) {
    void vscode.window.showErrorMessage(`Failed to write files: ${writeError}`);
    return { success: false };
  }

  // The baseline records what IPCraft generated, so a later 3-way merge can tell
  // hand edits from generator changes. Kept and merge-editor files are left alone.
  await updateBaselines(outputDir, staged, new Set(filesToWrite.map((w) => w.file.relativePath)));

  if (options.updateYaml) {
    await updateFileSetsInYaml(ipCoreUri, outputDir, writtenRelPaths);
    if (dryResult.resolvedPackName) {
      await updateScaffoldPackInYaml(ipCoreUri, dryResult.resolvedPackName);
    }
  }

  if (!options.silent) {
    const mergeNote =
      mergedPaths.size > 0
        ? `; ${mergedPaths.size} opened in the merge editor (resolve and save)`
        : '';
    // Only count the meaningful cases: locked (managed: false) files the user
    // explicitly wrote, and locked files whose interface is still out of date.
    const overwrittenCount = writtenRelPaths.filter((p) => protectedExisting.has(p)).length;
    const overwriteNote =
      overwrittenCount > 0 ? `; ${overwrittenCount} user-managed file(s) updated` : '';
    const staleLockedCount = staged.filter(
      (f) =>
        f.protected && f.interfaceDrift !== undefined && !writtenRelPaths.includes(f.relativePath)
    ).length;
    const staleNote =
      staleLockedCount > 0
        ? `; ${staleLockedCount} locked file(s) still have an out-of-date interface`
        : '';
    const action = await vscode.window.showInformationMessage(
      `✓ Generated ${writtenRelPaths.length} file(s)${mergeNote}${overwriteNote}${staleNote}`,
      'Open Folder'
    );
    if (action === 'Open Folder') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
    }
  }

  if (writtenRelPaths.length > 0) {
    getGeneratedArtifactsEmitter().fire(ipCoreUri);
  }

  return { success: true, ipCoreName: dryResult.ipCoreName };
}

/**
 * Writes baselines for files written this run (new / overwrite / auto-merge /
 * sync-interface) and seeds or refreshes them for unchanged files. Failures are
 * logged, never fatal. Baseline files are not part of fileSets.
 */
async function updateBaselines(
  outputDir: string,
  staged: StagedFile[],
  writtenPaths: Set<string>
): Promise<void> {
  const entries = staged
    .filter(
      (f) =>
        writtenPaths.has(f.relativePath) || (f.status === 'unchanged' && f.baseline !== f.content)
    )
    .map((f) => ({ relativePath: f.relativePath, content: f.content }));
  if (entries.length === 0) {
    return;
  }
  try {
    await writeBaselines(outputDir, entries);
  } catch (err) {
    logger.warn(
      `Failed to write generation baselines: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function updateFileSetsInYaml(
  ipCoreUri: vscode.Uri,
  outputBaseDir: string,
  writtenFiles: string[]
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(ipCoreUri);
    const baseDir = path.dirname(ipCoreUri.fsPath);
    const doc = YAML.parseDocument(document.getText());
    const yamlRelativeFiles = writtenFiles.map((file) => {
      const absolutePath = path.join(outputBaseDir, file);
      return path.relative(baseDir, absolutePath);
    });

    const currentData = doc.toJSON() as Record<string, unknown>;
    let fileSets = (currentData.fileSets ?? []) as Array<{
      name?: string;
      description?: string;
      files?: Array<{ path?: string; type?: string }>;
    }>;
    if (!Array.isArray(fileSets)) {
      fileSets = [];
    }
    fileSets = updateFileSets(fileSets, yamlRelativeFiles);

    doc.setIn(['fileSets'], fileSets);
    const newText = doc.toString();
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
      newText
    );
    await vscode.workspace.applyEdit(edit);
  } catch (error) {
    logger.error('Failed to update fileSets', error as Error);
  }
}

async function updateScaffoldPackInYaml(ipCoreUri: vscode.Uri, packName: string): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(ipCoreUri);
    const doc = YAML.parseDocument(document.getText());
    doc.set('scaffold_pack', packName);
    const newText = doc.toString();
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
      newText
    );
    await vscode.workspace.applyEdit(edit);
  } catch (error) {
    logger.error('Failed to update scaffold_pack', error as Error);
  }
}
