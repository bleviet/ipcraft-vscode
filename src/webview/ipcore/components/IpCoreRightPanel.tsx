import React from 'react';
import type { NormalizedBusLibrary } from '../../../shared/busContracts';
import { CanvasInspector } from './canvas/CanvasInspector';
import { StagingOverlay } from './canvas/StagingOverlay';
import type { useStagingSession } from '../hooks/useStagingSession';
import type { CanvasElement } from '../hooks/useCanvasSelection';
import type { IpCore } from '../../types/ipCore';
import type { YamlUpdateHandler } from '../../types/editor';
import type { BatchUpdate } from '../hooks/useGroupPorts';
import type { useIssuesSession } from '../hooks/useIssuesSession';
import { IssuesPanel } from './canvas/IssuesPanel';

interface IpCoreRightPanelProps {
  staging: ReturnType<typeof useStagingSession>;
  issues: ReturnType<typeof useIssuesSession>;
  canvasSelected: CanvasElement | null;
  ipCore: IpCore | null;
  imports?: { busLibrary?: NormalizedBusLibrary; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  batchUpdate: BatchUpdate;
  onCloseInspector: () => void;
  onDeleteInspector: () => void;
  onUngroupInspector: () => void;
  onSelectElement: (id: string) => void;
}

/**
 * The editor's right-hand slot: explicit precedence staging -> consistency ->
 * inspector -> none. Extracted from IpCoreApp (issue #129) so the app
 * component composes controllers instead of owning this branching directly.
 */
export const IpCoreRightPanel: React.FC<IpCoreRightPanelProps> = ({
  staging,
  issues,
  canvasSelected,
  ipCore,
  imports,
  onUpdate,
  batchUpdate,
  onCloseInspector,
  onDeleteInspector,
  onUngroupInspector,
  onSelectElement,
}) => {
  if (staging.stagingData) {
    return (
      <StagingOverlay
        files={staging.stagingData.files}
        rootLabel={staging.stagingData.rootLabel}
        warnings={staging.stagingData.warnings}
        mergedPaths={staging.stagingMergedPaths}
        overwritePaths={staging.stagingOverwritePaths}
        onMerge={staging.mergeStagingFile}
        onToggleOverwrite={staging.toggleStagingOverwrite}
        onConfirm={staging.confirmStaging}
        onCancel={staging.cancelStaging}
      />
    );
  }

  if (issues.showIssues) {
    return (
      <IssuesPanel
        issues={issues.issues}
        onSelect={(issue) => {
          issues.focusIssue(issue);
          issues.setShowIssues(false);
        }}
        onClose={() => issues.setShowIssues(false)}
      />
    );
  }

  if (canvasSelected && ipCore) {
    return (
      <CanvasInspector
        selected={canvasSelected}
        ipCore={ipCore}
        imports={imports}
        onUpdate={onUpdate}
        batchUpdate={batchUpdate}
        issueFocusRequest={issues.focusRequest}
        onClose={onCloseInspector}
        onDelete={onDeleteInspector}
        onUngroup={onUngroupInspector}
        onSelectElement={onSelectElement}
      />
    );
  }

  return null;
};
