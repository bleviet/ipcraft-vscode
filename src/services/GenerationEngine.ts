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
import type { StagedFile } from '../providers/StagingPanel';
import { WebviewStagingBridge } from '../providers/WebviewStagingBridge';
import { CONFIG_KEY_IPCRAFT_GENERATE } from '../utils/configKeys';

const logger = new Logger('GenerationEngine');

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
      try {
        const existing = await readFile(diskPath, 'utf8');
        const status = existing === content ? 'unchanged' : 'modified';
        return {
          relativePath,
          status,
          content,
          diskPath,
          protected: isProtected,
          origin,
        } as StagedFile;
      } catch {
        // File does not exist yet — treat it as a new file to be created.
        return {
          relativePath,
          status: 'new',
          content,
          diskPath,
          protected: false,
          origin,
        } as StagedFile;
      }
    })
  );
}

export async function runGenerator(
  resourceRoots: ResourceRoots,
  context: vscode.ExtensionContext,
  ipCoreUri: vscode.Uri,
  outputDir: string,
  options: GenerateOptions & { updateYaml?: boolean; silent?: boolean },
  progressTitle: string
): Promise<boolean> {
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
        dryRun: true,
      });
    }
  );

  if (!dryResult?.success || !dryResult.generatedContents) {
    void vscode.window.showErrorMessage(
      `Generation failed: ${dryResult?.error ?? 'Unknown error'}`
    );
    return false;
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
  // Modified files that will actually be written — defaults to every normal
  // modified file (today's implicit behavior) plus any protected (managed:
  // false) file the user explicitly opted in; the lock in the .ip.yml itself
  // is left untouched either way.
  let overwritePaths = new Set<string>();
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
      return false;
    }
    mergedPaths = new Set(decision.mergedPaths);
    overwritePaths = new Set(decision.overwritePaths);
  }

  // Phase 4: Write new files unconditionally; write modified files only when
  // the user's per-file Overwrite toggle is on (defaults to on for normal
  // files and off for locked ones — see the staging UI's default seeding) and
  // the file wasn't sent to the merge editor instead. Skip unchanged files.
  // Pre-compute the write list so we only show the progress notification when
  // there is real disk work to do — avoiding a misleading "Generating…" flash
  // otherwise.
  const protectedExisting = new Set(dryResult.protectedPaths ?? []);
  const executablePaths = new Set(dryResult.executablePaths ?? []);
  const filesToWrite = staged.filter(
    (f) =>
      f.status !== 'unchanged' &&
      !mergedPaths.has(f.relativePath) &&
      (f.status === 'new' || overwritePaths.has(f.relativePath))
  );
  const writtenRelPaths: string[] = [];
  let writeError: string | undefined;

  if (filesToWrite.length > 0) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
      async () => {
        try {
          await Promise.all(
            filesToWrite.map(async (f) => {
              await mkdir(path.dirname(f.diskPath), { recursive: true });
              await writeFile(f.diskPath, f.content, 'utf8');
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
    return false;
  }

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
    // Only count the meaningful case — a locked (managed: false) file the
    // user explicitly opted to overwrite — not every normal file that was
    // written because its default-on toggle was simply left alone.
    const overwrittenCount = writtenRelPaths.filter(
      (p) => protectedExisting.has(p) && overwritePaths.has(p)
    ).length;
    const overwriteNote =
      overwrittenCount > 0 ? `; ${overwrittenCount} user-managed file(s) overwritten` : '';
    const action = await vscode.window.showInformationMessage(
      `✓ Generated ${writtenRelPaths.length} file(s)${mergeNote}${overwriteNote}`,
      'Open Folder'
    );
    if (action === 'Open Folder') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
    }
  }

  return true;
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
    let fileSets = (currentData.fileSets ?? currentData.file_sets ?? []) as Array<{
      name?: string;
      description?: string;
      files?: Array<{ path?: string; type?: string }>;
    }>;
    const key = currentData.fileSets
      ? 'fileSets'
      : currentData.file_sets
        ? 'file_sets'
        : 'fileSets';

    if (!Array.isArray(fileSets)) {
      fileSets = [];
    }
    fileSets = updateFileSets(fileSets, yamlRelativeFiles);

    doc.setIn([key], fileSets);
    const newText = doc.toString();
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
      newText
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();
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
    await document.save();
  } catch (error) {
    logger.error('Failed to update scaffold_pack', error as Error);
  }
}
