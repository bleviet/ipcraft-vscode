/**
 * The second source of the resource view, shown next to the chosen one (for example the
 * post-synthesis numbers beside the post-route ones). It is read like the chosen source and mapped
 * onto the same graph; it is dropped when it is the chosen source or no longer listed.
 */

import type { ResourceReport } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import { Logger } from '../../utils/Logger';
import { loadCandidate, mapLoaded, type LoadedSource } from './loadResourceSource';
import type { SourceEntry } from './resourceSources';

export class CompareSource {
  private readonly logger = new Logger('CompareSource');
  private id: string | undefined;
  private loaded: LoadedSource | undefined;

  /** Compares with `id` (none clears it): read from `entries`, unless it is the chosen source. */
  async set(
    entries: SourceEntry[],
    id: string | undefined,
    selectedId: string | undefined
  ): Promise<void> {
    this.id = undefined;
    this.loaded = undefined;
    const entry = entries.find((e) => e.option.id === id);
    if (!entry?.candidate || !entry.option.usable || id === selectedId) {
      return;
    }
    try {
      this.loaded = await loadCandidate(entry.candidate, entry.option.fileName);
      this.id = id;
    } catch (error) {
      this.logger.error(`Cannot read ${entry.option.fileName}`, error as Error);
    }
  }

  /** Reads the compared source again, after a new discovery. */
  refresh(entries: SourceEntry[], selectedId: string | undefined): Promise<void> {
    return this.set(entries, this.id, selectedId);
  }

  /** The compared source mapped onto `graph`. */
  report(
    graph: SystemGraph,
    chosenRoot?: string
  ): { id: string; report: ResourceReport } | undefined {
    if (this.id === undefined || !this.loaded) {
      return undefined;
    }
    try {
      return { id: this.id, report: mapLoaded(this.loaded, graph, chosenRoot) };
    } catch (error) {
      this.logger.error('Cannot map the compared report', error as Error);
      return undefined;
    }
  }
}
