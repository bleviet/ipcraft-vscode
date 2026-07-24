import React from 'react';
import { CanvasInspector } from './canvas/CanvasInspector';
import { StagingOverlay } from './canvas/StagingOverlay';
import { ConsistencyOverlay } from './canvas/ConsistencyOverlay';
import type { useStagingSession } from '../hooks/useStagingSession';
import type { useConsistencySession } from '../hooks/useConsistencySession';
import type { CanvasElement } from '../hooks/useCanvasSelection';
import type { IpCore } from '../../types/ipCore';
import type { YamlUpdateHandler } from '../../types/editor';
import type { BatchUpdate } from '../hooks/useGroupPorts';

interface IpCoreRightPanelProps {
  staging: ReturnType<typeof useStagingSession>;
  consistency: ReturnType<typeof useConsistencySession>;
  canvasSelected: CanvasElement | null;
  ipCore: IpCore | null;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
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
  consistency,
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

  if (consistency.showConsistencyOverlay && consistency.consistencyResult) {
    return (
      <ConsistencyOverlay
        findings={consistency.consistencyResult.findings}
        summary={consistency.consistencyResult.summary}
        ignoredKeys={consistency.ignoredConsistencyKeys}
        onIgnore={consistency.handleIgnoreConsistencyFinding}
        onAdopt={consistency.handleAdoptConsistencyFinding}
        onSelectElement={consistency.handleSelectConsistencyElement}
        onRegenerate={consistency.handleRegenerateFromConsistency}
        onRecheck={consistency.handleCheckConsistency}
        isChecking={consistency.consistencyChecking}
        onClose={() => consistency.setShowConsistencyOverlay(false)}
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
        onClose={onCloseInspector}
        onDelete={onDeleteInspector}
        onUngroup={onUngroupInspector}
        onSelectElement={onSelectElement}
      />
    );
  }

  return null;
};
