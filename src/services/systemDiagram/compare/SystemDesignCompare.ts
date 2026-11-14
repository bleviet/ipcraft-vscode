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

import { emptySystemGraph } from '../../../domain/emptySystemGraph';
import type { SystemGraph } from '../../../domain/systemGraph';
import type { Finding, FindingsDiff, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { compareFindings, findingsBase, findingsOf } from '../diff/diffFindings';
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
  /** The findings that differ, for the same two graphs as `diff`. */
  findings: FindingsDiff;
}

/** The current side: the graph as read, as enriched, and whether its enrichment failed (then both are the read graph). */
export interface CurrentSide {
  read: SystemGraph;
  enriched: SystemGraph;
  fellBack: boolean;
}

/** How the base was found, when it is not the file read under its own path. */
export interface BaseOrigin {
  /** The base revision has no such file: the base is an empty design. */
  missing?: true;
  /** The base revision has the file under this path. */
  renamedFrom?: string;
}

/** `read` is undefined for a missing file: the empty design of the format of the current side. */
interface Base extends BaseOrigin {
  label: string;
  read?: SystemGraph;
}

export class SystemDesignCompare {
  private base: Base | undefined;
  /** The enrichment of the base for one design file, as of one revision of the definitions. */
  private enrichedBase:
    | {
        base: object;
        designFile: string;
        revision: string;
        enriched: Promise<SystemGraph>;
      }
    | undefined;
  /** The findings of the graphs analysed so far: the base is analysed once, not for each edit. */
  private readonly analysed = new WeakMap<SystemGraph, ReadonlyMap<string, Finding>>();

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
   * A missing base has no text: everything of the current side is added.
   */
  start(
    baseText: string,
    baseDisplayName: string,
    label: string,
    documentFileName: string,
    origin: BaseOrigin = {}
  ): void {
    if (origin.missing) {
      this.base = { label, missing: true };
    } else {
      const read = readSystemDesign(documentFileName, baseDisplayName, baseText);
      if (!read) {
        throw new Error(`'${label}' is not a recognized system design`);
      }
      this.base = {
        label,
        read,
        renamedFrom: origin.renamedFrom,
      };
    }
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
      const baseRead = base.read;
      if (!baseRead) {
        // Nothing to enrich: the empty design is compared with the current side as shown.
        return this.result(base, undefined, current.fellBack ? current.read : current.enriched);
      }
      let fellBack = current.fellBack;
      const enriched = fellBack
        ? baseRead
        : await this.enrich(base, baseRead, designFile).catch((error: unknown) => {
            this.logError('Failed to enrich the base of the comparison', error as Error);
            fellBack = true;
            return baseRead;
          });
      if (this.base === base) {
        return fellBack
          ? this.result(base, baseRead, current.read)
          : this.result(base, enriched, current.enriched);
      }
    }
  }

  /** The enrichment of the base, shared while the base, the design file and the definitions are the same. */
  private enrich(base: Base, read: SystemGraph, designFile: string): Promise<SystemGraph> {
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
      enriched: this.enricher.enrich(read, designFile),
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
    base: Base,
    baseGraph: SystemGraph | undefined,
    current: SystemGraph
  ): CompareResult {
    const from = baseGraph ?? emptySystemGraph(current.name, current.source.format);
    const diff = diffSystemGraphs(from, current);
    if (base.missing) {
      diff.base.missing = true;
    } else if (base.renamedFrom !== undefined) {
      diff.base.path = base.renamedFrom;
    }
    return {
      baseLabel: base.label,
      diff,
      findings: compareFindings(
        this.findingsOf(findingsBase(from, diff)),
        this.findingsOf(current)
      ),
    };
  }

  private findingsOf(graph: SystemGraph): ReadonlyMap<string, Finding> {
    let found = this.analysed.get(graph);
    if (!found) {
      found = findingsOf(graph);
      this.analysed.set(graph, found);
    }
    return found;
  }
}
