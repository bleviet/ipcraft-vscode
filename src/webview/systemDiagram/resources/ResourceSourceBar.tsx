import React from 'react';
import type { ResourceReport } from '../../../domain/resourceUsage';
import type {
  DiagramResources,
  ResourceSourceOption,
} from '../../../shared/messages/systemDiagram';
import type { ResourceChannel } from './useResourceChannel';

export const ATTACH_LABEL = 'Attach Report...';
export const CHOOSE_FOLDER_LABEL = 'Choose Folder...';

/**
 * One entry of the Report select: the label, the date in the report header, and where it came
 * from. A checkpoint is not a report that cannot be used: it says it is a checkpoint.
 */
export function sourceText(source: ResourceSourceOption): string {
  if (!source.usable) {
    return `${source.label} (${source.extractable ? 'checkpoint' : 'not usable'})`;
  }
  return [source.label, source.date, source.origin === 'attached' ? 'attached' : undefined]
    .filter(Boolean)
    .join(' · ');
}

/** The text of the button that extracts a source: the OOC group extracts the IPs that lack a report. */
export const extractLabel = (source: ResourceSourceOption): string =>
  source.missing === undefined ? 'Extract' : `Extract missing IPs (${source.missing})`;

/**
 * The Extract button of an extractable source. One extraction runs at a time: every button is
 * disabled while any runs, and the one of the source being extracted has the spinner.
 */
export function ExtractButton({
  source,
  extracting,
  onExtract,
}: {
  source: ResourceSourceOption;
  /** The id of the source being extracted, if any. */
  extracting: string | undefined;
  onExtract: (id: string) => void;
}) {
  const running = extracting === source.id;
  return (
    <button
      type="button"
      className="sd-button"
      disabled={extracting !== undefined}
      onClick={() => onExtract(source.id)}
    >
      {running && (
        <span aria-hidden="true" className="codicon codicon-loading codicon-modifier-spin" />
      )}{' '}
      {extractLabel(source)}
    </button>
  );
}

/** The line above the table: warning color for a refusal or a design root that is not in the report. */
export function ResourceNotice({ notice }: { notice: DiagramResources['notice'] }) {
  if (!notice) {
    return null;
  }
  const warning = notice.kind === 'refused' || notice.kind === 'rootMissing';
  return (
    <p className="sd-res-notice" data-tone={warning ? 'warning' : 'info'}>
      {notice.message}
    </p>
  );
}

/** The Attach Report and Choose Folder buttons: the same two actions in the bar and the empty state. */
export function AttachButtons({
  channel,
}: {
  channel: Pick<ResourceChannel, 'attach' | 'chooseFolder'>;
}) {
  return (
    <>
      <button type="button" className="sd-button" onClick={channel.attach}>
        {ATTACH_LABEL}
      </button>
      <button type="button" className="sd-button" onClick={channel.chooseFolder}>
        {CHOOSE_FOLDER_LABEL}
      </button>
    </>
  );
}

interface ResourceSourceBarProps {
  resources: DiagramResources;
  /** The numbers of the chosen source: its design root candidates fill the second select. */
  report?: ResourceReport;
  channel: ResourceChannel;
}

/** Header of the Resources tab: the report picker, the attach actions, and the design root when it is ambiguous. */
export function ResourceSourceBar({ resources, report, channel }: ResourceSourceBarProps) {
  const selected = resources.sources.find((source) => source.id === resources.selected);
  const others = resources.sources.filter(
    (source) => source.usable && source.id !== resources.selected
  );
  return (
    <div className="sd-res-bar">
      <label className="flex items-center gap-1">
        <span className="opacity-70">Report</span>
        <select
          className="sd-input"
          aria-label="Report"
          value={resources.selected ?? ''}
          onChange={(event) => channel.select(event.target.value)}
        >
          {resources.selected === undefined && <option value="" disabled />}
          {resources.sources.map((source) => (
            <option
              key={source.id}
              value={source.id}
              title={source.usable ? source.fileName : source.reason}
            >
              {sourceText(source)}
            </option>
          ))}
        </select>
      </label>
      {selected?.extractable && (
        <ExtractButton
          source={selected}
          extracting={resources.extracting}
          onExtract={channel.extract}
        />
      )}
      {selected?.extractable && !selected.usable && (
        <span className="text-xs opacity-70">{selected.reason}</span>
      )}
      {others.length > 0 && (
        <label className="flex items-center gap-1">
          <span className="opacity-70">Compare with</span>
          <select
            className="sd-input"
            aria-label="Compare with"
            value={resources.compare?.id ?? ''}
            onChange={(event) => channel.compare(event.target.value || undefined)}
          >
            <option value="">None</option>
            {others.map((source) => (
              <option key={source.id} value={source.id} title={source.fileName}>
                {sourceText(source)}
              </option>
            ))}
          </select>
        </label>
      )}
      <AttachButtons channel={channel} />
      {selected?.origin === 'attached' && (
        <button type="button" className="sd-button" onClick={() => channel.remove(selected.id)}>
          Remove
        </button>
      )}
      {report && report.rootCandidates.length > 1 && (
        <select
          className="sd-input"
          aria-label="Design instance in the report"
          value={report.root ?? ''}
          onChange={(event) => channel.chooseRoot(event.target.value)}
        >
          {report.rootCandidates.map((root) => (
            <option key={root} value={root}>
              {root}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
