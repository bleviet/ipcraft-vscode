/**
 * The comparison of one System Viewer panel: the base design read once, the changes against
 * whatever the panel shows now. Not persisted; it ends with the panel.
 *
 * Both sides are always compared at the same stage: read against read while the panel shows
 * the early graph, enriched against enriched once it shows the enriched one. The base is
 * enriched once and the result is reused while the workspace definitions are unchanged (the
 * enricher's `revision`), so it sees the same definitions as the current side, also after
 * trust is granted or a definition changes, without being enriched anew for each edit.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../diff/diffSystemGraphs';
import { readSystemDesign } from '../readSystemDesign';

/** The part of `SystemDesignEnricher` the comparison uses. */
export interface GraphEnricher {
  /** Differs between two moments when what `enrich` reads may have changed in between. */
  readonly revision: string;
  enrich(read: SystemGraph, designFile: string): Promise<SystemGraph>;
}

export interface CompareResult {
  baseLabel: string;
  diff: SystemGraphDiff;
}

/** The current side: the graph as read, as enriched, and whether its enrichment failed (then both are the read graph). */
export interface CurrentSide {
  read: SystemGraph;
  enriched: SystemGraph;
  fellBack: boolean;
}

export class SystemDesignCompare {
  private base: { label: string; read: SystemGraph } | undefined;
  /** The enrichment of the base for one design file, as of one revision of the definitions. */
  private enrichedBase:
    | {
        base: object;
        designFile: string;
        revision: string;
        enriched: Promise<SystemGraph>;
      }
    | undefined;

  constructor(
    private readonly enricher: GraphEnricher,
    private readonly logError: (message: string, error: Error) => void
  ) {}

  get active(): boolean {
    return this.base !== undefined;
  }

  /**
   * Reads the base text as the document would be read (`documentFileName` decides the
   * format). Throws when the text is not a system design; a running comparison stays as it was.
   */
  start(baseText: string, baseDisplayName: string, label: string, documentFileName: string): void {
    const read = readSystemDesign(documentFileName, baseDisplayName, baseText);
    if (!read) {
      throw new Error(`'${label}' is not a recognized system design`);
    }
    this.base = { label, read };
    this.enrichedBase = undefined;
  }

  stop(): void {
    this.base = undefined;
    this.enrichedBase = undefined;
  }

  /** The changes from the base as read to `currentRead`, a graph as read; undefined without a comparison. */
  diffRead(currentRead: SystemGraph): CompareResult | undefined {
    return this.base && this.result(this.base, this.base.read, currentRead);
  }

  /**
   * The changes from the base, enriched for `designFile` like the current side, to the
   * current side as enriched. If either side fell back to its read graph (its enrichment
   * failed), both are compared as read, so no definition shows up as a change. A base replaced
   * while it was being enriched is compared again with the new one; undefined without a comparison.
   */
  async diffEnriched(current: CurrentSide, designFile: string): Promise<CompareResult | undefined> {
    for (;;) {
      const base = this.base;
      if (!base) {
        return undefined;
      }
      let fellBack = current.fellBack;
      const enriched = fellBack
        ? base.read
        : await this.enrich(base, designFile).catch((error: unknown) => {
            this.logError('Failed to enrich the base of the comparison', error as Error);
            fellBack = true;
            return base.read;
          });
      if (this.base === base) {
        return fellBack
          ? this.result(base, base.read, current.read)
          : this.result(base, enriched, current.enriched);
      }
    }
  }

  /** The enrichment of the base, shared while the base, the design file and the definitions are the same. */
  private enrich(base: { read: SystemGraph }, designFile: string): Promise<SystemGraph> {
    // Read before the enrichment starts: a change while it runs makes the next call enrich again.
    const revision = this.enricher.revision;
    const cached = this.enrichedBase;
    if (cached?.base === base && cached.designFile === designFile && cached.revision === revision) {
      return cached.enriched;
    }
    const entry = {
      base,
      designFile,
      revision,
      enriched: this.enricher.enrich(base.read, designFile),
    };
    this.enrichedBase = entry;
    // A failed enrichment is not kept: the next diff tries again.
    entry.enriched.catch(() => {
      if (this.enrichedBase === entry) {
        this.enrichedBase = undefined;
      }
    });
    return entry.enriched;
  }

  private result(
    base: { label: string },
    baseGraph: SystemGraph,
    current: SystemGraph
  ): CompareResult {
    return { baseLabel: base.label, diff: diffSystemGraphs(baseGraph, current) };
  }
}
