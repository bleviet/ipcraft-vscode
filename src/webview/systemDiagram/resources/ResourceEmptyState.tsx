import React from 'react';
import type { DiagramResources } from '../../../shared/messages/systemDiagram';
import { AttachButtons, ExtractButton, ResourceNotice } from './ResourceSourceBar';
import type { ResourceChannel } from './useResourceChannel';

/** The Resources tab with no usable report: how to get one, and where IPCraft looked. */
export function ResourceEmptyState({
  resources,
  channel,
}: {
  resources: DiagramResources | undefined;
  channel: ResourceChannel;
}) {
  const unusable = resources?.sources.filter((source) => !source.usable) ?? [];
  return (
    <div className="space-y-2 p-3">
      <p>No resource report found for this design.</p>
      <div className="sd-res-bar">
        <AttachButtons channel={channel} />
      </div>
      <ResourceNotice notice={resources?.notice} />
      {unusable.length > 0 && (
        <ul>
          {unusable.map((source) => (
            <li key={source.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{source.fileName}</span>
              {source.reason && <span className="opacity-70">: {source.reason}</span>}
              {source.extractable && (
                <ExtractButton
                  source={source}
                  extracting={resources?.extracting}
                  onExtract={channel.extract}
                />
              )}
              {source.origin === 'attached' && (
                <button
                  type="button"
                  className="sd-button"
                  aria-label={`Remove ${source.fileName}`}
                  onClick={() => channel.remove(source.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {resources && resources.searched.length > 0 && (
        <div>
          <span className="opacity-70">Searched:</span>
          <ul>
            {resources.searched.map((folder) => (
              <li key={folder} className="sd-num">
                {folder}
              </li>
            ))}
          </ul>
        </div>
      )}
      {resources && (
        <div>
          <p className="opacity-70">
            To get a report per block from Vivado, add this line after opening the run:
          </p>
          <code className="sd-res-code">{resources.hierarchicalTcl}</code>
        </div>
      )}
    </div>
  );
}
