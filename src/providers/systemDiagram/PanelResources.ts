/**
 * The resource usage of one System Viewer panel: finds and attaches reports, remembers the chosen
 * one, maps it onto each final graph and posts the result. Nothing is read until the webview
 * asks (`loadResources`). The provider publishes graphs; this controller decides what the
 * numbers are.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { ResourceReport } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import { AttachedReports } from '../../services/resources/attachedReports';
import { CompareSource } from '../../services/resources/compareSource';
import {
  loadCandidate,
  mapLoaded,
  type LoadedSource,
} from '../../services/resources/loadResourceSource';
import { discoverIpBuilds } from '../../services/resources/ipBuildCandidates';
import { discoverProjectReports } from '../../services/resources/reportDiscovery';
import {
  attachedEntries,
  defaultSource,
  projectEntries,
  type SourceEntry,
} from '../../services/resources/resourceSources';
import type {
  DiagramResources,
  SystemDiagramToWebviewMessage,
} from '../../shared/messages/systemDiagram';
import { Logger } from '../../utils/Logger';
import { extractWithVivado, type ExtractionOutcome } from './resourceExtraction';
import { sourceNotice } from './resourceNotice';
import { pickFolderReports, pickReportFiles } from './resourcePickers';

export interface PanelResourcesOptions {
  document: vscode.TextDocument;
  context: Pick<vscode.ExtensionContext, 'workspaceState' | 'storageUri' | 'globalStorageUri'>;
  post: (message: SystemDiagramToWebviewMessage) => void;
}

const ATTACH_PREFIX = 'attached:';
const UNTRUSTED_MESSAGE = 'Extracting a report runs Vivado, which needs a trusted workspace.';

export class PanelResources {
  private readonly logger = new Logger('PanelResources');
  private readonly memento: vscode.Memento;
  private readonly attached: AttachedReports;
  private readonly selectedKey: string;
  private readonly rootKey: string;
  private entries: SourceEntry[] = [];
  private searched: string[] = [];
  private selectedId: string | undefined;
  private loaded: LoadedSource | undefined;
  private graph: SystemGraph | undefined;
  private rootCandidates: string[] = [];
  private current: ResourceReport | undefined;
  private readonly compare = new CompareSource();
  /** The id of the source a checkpoint extraction runs for, and the way to cancel it. */
  private extracting: { id: string; abort: AbortController } | undefined;
  private watchers: vscode.Disposable[] = [];
  /** Turned on by the webview; before that no report is read. */
  private on = false;
  private discovered = false;
  private pending: 'discover' | 'remap' | undefined;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  /** The next `resources` message turns Resources on in the webview (the command path). */
  private showNext = false;

  constructor(private readonly options: PanelResourcesOptions) {
    const uri = options.document.uri.toString();
    this.memento = options.context.workspaceState;
    this.selectedKey = `ipcraft.resources.selected:${uri}`;
    this.rootKey = `ipcraft.resources.root:${uri}`;
    this.attached = new AttachedReports(
      this.memento,
      uri,
      (file) => vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)) !== undefined
    );
  }

  /** The chosen report as last mapped onto the design and posted; undefined before the reports are loaded or when there is none. */
  currentReport(): ResourceReport | undefined {
    return this.current;
  }

  /** A final graph was published: the selected report is mapped onto it, without a new discovery. */
  onGraph(graph: SystemGraph): void {
    this.graph = graph;
    if (this.on) {
      this.request(this.discovered ? 'remap' : 'discover');
    }
  }

  /** Resources was turned on: find the reports. */
  load(): Promise<void> {
    this.on = true;
    return this.enqueue(() => (this.discovered ? this.postCurrent() : this.discover()));
  }

  select(id: string): Promise<void> {
    return this.act(async () => {
      if (this.entries.some((entry) => entry.option.id === id)) {
        await this.memento.update(this.selectedKey, id);
        await this.choose(id);
      }
    });
  }

  chooseRoot(root: string): Promise<void> {
    return this.act(async () => {
      if (this.rootCandidates.includes(root)) {
        await this.memento.update(this.rootKey, root);
        await this.postCurrent();
      }
    });
  }

  /**
   * Opens the file dialog and attaches the chosen reports; also turns resources on. `show` is for
   * the command, which has the webview turn Resources on with the first message; the webview's
   * own gesture has it on already.
   */
  async attachReport(show = false): Promise<void> {
    if (show) {
      this.showNext = true;
    }
    await this.load();
    await this.act(async () => {
      const sets =
        this.graph && (await pickReportFiles(this.options.document.fileName, this.graph));
      if (sets) {
        await this.attachAll(sets);
      }
    });
  }

  chooseFolder(): Promise<void> {
    return this.act(async () => {
      const sets =
        this.graph && (await pickFolderReports(this.options.document.fileName, this.graph));
      if (sets) {
        await this.attachAll(sets);
      }
    });
  }

  remove(id: string): Promise<void> {
    return this.act(async () => {
      if (id.startsWith(ATTACH_PREFIX)) {
        await this.attached.remove(id.slice(ATTACH_PREFIX.length));
        await this.discover();
      }
    });
  }

  /** Shows another source next to the chosen one; no id clears it. */
  compareResourceSource(id?: string): Promise<void> {
    return this.act(async () => {
      await this.compare.set(this.entries, id, this.selectedId);
      await this.postCurrent();
    });
  }

  /**
   * Opens the checkpoint of a source in Vivado and writes its report to the extension's storage,
   * then chooses the extracted source. The run does not hold the queue: the panel stays usable.
   */
  async extractResources(id: string): Promise<void> {
    const targets = this.entries.find((e) => e.option.id === id)?.candidate?.extract;
    if (!targets || this.extracting || this.disposed) {
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showInformationMessage(UNTRUSTED_MESSAGE);
      return;
    }
    const storage = this.storage();
    if (storage === undefined) {
      void vscode.window.showErrorMessage('Resources: there is no extension storage to write to.');
      return;
    }
    const abort = new AbortController();
    this.extracting = { id, abort };
    let outcome: ExtractionOutcome = { status: 'failed' };
    try {
      await this.enqueue(() => this.postCurrent());
      outcome = await extractWithVivado(targets, storage, abort.signal);
    } catch (error) {
      this.logger.error('Checkpoint extraction failed', error as Error);
      void vscode.window.showErrorMessage(
        `Resources: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.extracting = undefined;
      await this.act(async () => {
        const extracted = outcome.status === 'done' ? outcome.reports[0].hierarchical : undefined;
        // A project checkpoint turns into the report extracted from it; the others keep their id.
        const preferred =
          extracted !== undefined && id.startsWith('project:') ? `project:${extracted}` : id;
        await (outcome.status === 'done' ? this.discover([preferred]) : this.postCurrent());
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.extracting?.abort.abort();
    this.unwatch();
  }

  private storage(): string | undefined {
    return (this.options.context.storageUri ?? this.options.context.globalStorageUri)?.fsPath;
  }

  /**
   * Attaches one record per file set and selects the first usable new source. A set that cannot
   * be attached (a file that cannot be copied) is reported; the others still are attached.
   */
  private async attachAll(fileSets: string[][]): Promise<void> {
    const ids: string[] = [];
    const failures: string[] = [];
    for (const files of fileSets) {
      try {
        const record = await this.attached.attachFiles([...new Set(files)], this.storage());
        ids.push(`${ATTACH_PREFIX}${record.id}`);
      } catch (error) {
        this.logger.error(`Cannot attach ${path.basename(files[0])}`, error as Error);
        failures.push(path.basename(files[0]));
      }
    }
    await this.discover(ids);
    if (failures.length > 0) {
      void vscode.window.showErrorMessage(`Could not attach: ${failures.join(', ')}`);
    }
  }

  /**
   * Looks for the reports again and chooses a source: the first usable of `preferred` (else the
   * first of them), the remembered one, or the default.
   */
  private async discover(preferred: string[] = []): Promise<void> {
    const graph = this.graph;
    if (!graph) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(this.options.document.uri)?.uri.fsPath;
    const storage = this.storage();
    const found = await discoverProjectReports(
      this.options.document.fileName,
      graph,
      folder,
      storage
    );
    const attached = await attachedEntries(this.attached.list(), graph, relativeName, storage);
    this.entries = [
      ...projectEntries([...found.candidates, ...(await discoverIpBuilds(graph))], relativeName),
      ...attached,
    ];
    this.searched = found.searched.map(relativeName);
    this.discovered = true;
    const fresh = this.entries.filter((entry) => preferred.includes(entry.option.id));
    const picked = (fresh.find((e) => e.option.usable) ?? fresh[0])?.option.id;
    if (picked) {
      await this.memento.update(this.selectedKey, picked);
    }
    const remembered = this.memento.get<string>(this.selectedKey);
    await this.choose(
      picked ??
        (this.entries.some((e) => e.option.id === remembered)
          ? remembered
          : defaultSource(this.entries))
    );
  }

  /** Reads the chosen source, watches its files and posts the numbers. */
  private async choose(id: string | undefined): Promise<void> {
    this.unwatch();
    this.selectedId = id;
    this.loaded = undefined;
    const entry = this.selected();
    if (entry?.candidate && entry.option.usable) {
      try {
        this.loaded = await loadCandidate(entry.candidate, entry.option.fileName);
      } catch (error) {
        this.fail(entry, error);
      }
    }
    if (this.disposed) {
      return;
    }
    if (entry?.linked && this.loaded) {
      this.watch(entry);
    }
    await this.compare.refresh(this.entries, id);
    await this.postCurrent();
  }

  private selected(): SourceEntry | undefined {
    return this.entries.find((entry) => entry.option.id === this.selectedId);
  }

  /** A source that cannot be read stays in the list, with the reason. */
  private fail(entry: SourceEntry, error: unknown): void {
    this.logger.error(`Cannot read ${entry.option.fileName}`, error as Error);
    this.loaded = undefined;
    entry.option = {
      ...entry.option,
      usable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  private async postCurrent(): Promise<void> {
    const graph = this.graph;
    const entry = this.selected();
    if (!graph || this.disposed) {
      return;
    }
    let report: ResourceReport | undefined;
    let notice: DiagramResources['notice'];
    if (this.loaded && entry) {
      try {
        report = mapLoaded(this.loaded, graph, this.memento.get<string>(this.rootKey));
        notice = await sourceNotice(
          entry,
          this.loaded,
          report,
          graph,
          this.options.document.fileName
        );
      } catch (error) {
        this.fail(entry, error);
      }
    }
    // A checkpoint is not refused: it can be extracted.
    if (entry && !entry.option.usable && !entry.option.extractable) {
      notice = { kind: 'refused', message: entry.option.reason ?? 'This report cannot be used.' };
    }
    this.rootCandidates = report?.rootCandidates ?? [];
    this.current = report;
    const compare = this.compare.report(graph, this.memento.get<string>(this.rootKey));
    if (this.disposed) {
      return;
    }
    const show = this.showNext;
    this.showNext = false;
    this.options.post({
      type: 'resources',
      ...(show && { show: true as const }),
      resources: {
        sources: this.entries.map((e) => e.option),
        ...(this.selectedId !== undefined && { selected: this.selectedId }),
        ...(report && { report }),
        searched: this.searched,
        ...(notice && { notice }),
        hierarchicalTcl: `report_utilization -hierarchical -file ${graph.name}_utilization_hier.rpt`,
        ...(this.extracting && { extracting: this.extracting.id }),
        ...(compare && { compare }),
      },
    });
  }

  /** Watches the linked report files of the chosen source: a change reads the reports again. */
  private watch(entry: SourceEntry): void {
    const candidate = entry.candidate;
    if (!candidate) {
      return;
    }
    const files = [...candidate.files, ...(candidate.capacityFile ? [candidate.capacityFile] : [])];
    for (const file of files) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file))
      );
      const changed = () => this.request('discover');
      watcher.onDidChange(changed);
      watcher.onDidCreate(changed);
      watcher.onDidDelete(changed);
      this.watchers.push(watcher);
    }
  }

  private unwatch(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  /** Several requests while one runs become one run; a discovery covers a remap. */
  private request(kind: 'discover' | 'remap'): void {
    const idle = this.pending === undefined;
    if (this.pending !== 'discover') {
      this.pending = kind;
    }
    if (idle) {
      void this.enqueue(async () => {
        const next = this.pending;
        this.pending = undefined;
        await (next === 'discover' || !this.discovered ? this.discover() : this.postCurrent());
      });
    }
  }

  /** Runs tasks one after the other; a failure is logged, never thrown into the router. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => {
      this.logger.error('Resource usage failed', error as Error);
    });
    this.queue = next;
    return next;
  }

  /** A user gesture: like `enqueue`, and the failure is shown. */
  private act(task: () => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      try {
        await task();
      } catch (error) {
        this.logger.error('Resource usage failed', error as Error);
        void vscode.window.showErrorMessage(
          `Resources: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }
}

const relativeName = (file: string): string =>
  vscode.workspace.asRelativePath(vscode.Uri.file(file), false);
