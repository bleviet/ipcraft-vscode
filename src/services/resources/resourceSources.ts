/**
 * The sources of the resource view: discovered project reports and attached reports, each as
 * the option the webview lists and the candidate to read it from. Extension side, no `vscode`.
 */

import type { ResourceStage } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ResourceSourceOption } from '../../shared/messages/systemDiagram';
import { isCopy, type AttachedRecord } from './attachedReports';
import { checkpointCandidate, extractedCandidates } from './checkpointCandidates';
import { IP_BUILDS_NAME } from './ipBuildCandidates';
import { classifyReportFiles, guessVendor, type ReportCandidate } from './reportCandidates';

export interface SourceEntry {
  option: ResourceSourceOption;
  /** Absent when the source cannot be read at all (a checkpoint, a file that is gone). */
  candidate?: ReportCandidate;
  /** The files are the user's own workspace files: watched, and older than the design means stale. */
  linked: boolean;
  /** An attached copy: only the date in its header tells how old it is. */
  copy: boolean;
}

/** The stage to show first when the user has not chosen: the most refined one. */
const DEFAULT_ORDER: ResourceStage[] = ['routed', 'placed', 'fit', 'synth', 'ooc'];

export function projectEntries(
  candidates: ReportCandidate[],
  relativeName: (file: string) => string
): SourceEntry[] {
  return candidates.map((candidate) => ({
    option: {
      id: `project:${candidate.id}`,
      label: candidate.label,
      vendor: candidate.vendor,
      ...(candidate.stage && { stage: candidate.stage }),
      origin: 'project',
      ...(candidate.date !== undefined && { date: candidate.date }),
      fileName:
        candidate.group === 'ipBuilds' ? IP_BUILDS_NAME : relativeName(sourceFile(candidate)),
      usable: candidate.usable,
      ...(candidate.reason !== undefined && { reason: candidate.reason }),
      ...extractOption(candidate),
    },
    candidate,
    linked: true,
    copy: false,
  }));
}

/**
 * What the source shows as its file: the OOC group's folder (its id is `ooc:<folder>`, as its
 * first file may be a cached extraction), the checkpoint a report was extracted from, or the report.
 */
function sourceFile(candidate: ReportCandidate): string {
  return candidate.stage === 'ooc' && candidate.id.startsWith('ooc:')
    ? candidate.id.slice('ooc:'.length)
    : (candidate.checkpoint ?? candidate.files[0]);
}

const extractOption = (
  candidate: ReportCandidate
): Pick<ResourceSourceOption, 'extractable' | 'missing'> =>
  candidate.extract
    ? {
        extractable: true,
        ...(candidate.stage === 'ooc' && { missing: candidate.extract.length }),
      }
    : {};

async function attachedEntry(
  record: AttachedRecord,
  graph: SystemGraph,
  relativeName: (file: string) => string,
  storage: string | undefined
): Promise<SourceEntry> {
  const copy = isCopy(record);
  const base = {
    id: `attached:${record.id}`,
    origin: 'attached' as const,
    // A copy shows the name the user attached; a linked file is a workspace file.
    fileName: copy ? record.originalName : relativeName(record.storedFiles[0]),
  };
  const unusable = (reason: string): SourceEntry => ({
    option: {
      ...base,
      label: record.originalName,
      vendor: guessVendor(record.originalName),
      usable: false,
      reason,
    },
    linked: !copy,
    copy,
  });
  const dcp = record.storedFiles.find((file) => file.endsWith('.dcp'));
  let candidates: ReportCandidate[];
  try {
    if (dcp !== undefined) {
      // Until it is extracted a checkpoint is not a report; its stage is known from the report.
      candidates = await extractedCandidates(storage, dcp, graph, record.originalName);
      if (candidates.length === 0) {
        const checkpoint = checkpointCandidate(dcp, record.originalName);
        return {
          option: {
            ...base,
            label: checkpoint.label,
            vendor: 'vivado',
            usable: false,
            reason: checkpoint.reason,
            ...extractOption(checkpoint),
          },
          candidate: checkpoint,
          linked: !copy,
          copy,
        };
      }
    } else {
      candidates = await classifyReportFiles(record.storedFiles, graph, { refusals: 'all' });
    }
  } catch (error) {
    return unusable(
      `${record.originalName} could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const candidate = candidates.find((c) => c.usable) ?? candidates[0];
  if (!candidate) {
    return unusable(`${record.originalName} is not a report file.`);
  }
  return {
    option: {
      ...base,
      label: candidate.label,
      vendor: candidate.vendor,
      ...(candidate.stage && { stage: candidate.stage }),
      ...(candidate.date !== undefined && { date: candidate.date }),
      usable: candidate.usable,
      ...(candidate.reason !== undefined && { reason: candidate.reason }),
    },
    candidate,
    linked: !copy,
    copy,
  };
}

export const attachedEntries = (
  records: AttachedRecord[],
  graph: SystemGraph,
  relativeName: (file: string) => string,
  storage?: string
): Promise<SourceEntry[]> =>
  Promise.all(records.map((record) => attachedEntry(record, graph, relativeName, storage)));

/**
 * The first usable source of the most refined stage. The IPCraft builds and the build of one IP
 * core on its own are the default only when no source of the whole design is usable.
 */
export function defaultSource(entries: SourceEntry[]): string | undefined {
  const others = entries.filter(
    (e) => e.candidate?.group !== 'ipBuilds' && e.candidate?.group !== 'blockBuild'
  );
  for (const stage of DEFAULT_ORDER) {
    const found = others.find((e) => e.option.usable && e.option.stage === stage);
    if (found) {
      return found.option.id;
    }
  }
  return (others.find((e) => e.option.usable) ?? entries.find((e) => e.option.usable))?.option.id;
}
