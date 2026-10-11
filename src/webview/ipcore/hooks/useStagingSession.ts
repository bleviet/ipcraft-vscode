import { useCallback, useState } from 'react';
import { vscode } from '../../vscode';
import type { StagingAction } from '../../../shared/staging';
import type { StagedFileView } from '../components/canvas/StagingOverlay';

export interface StagingStartMessage {
  files?: StagedFileView[];
  rootLabel?: string;
  /** Non-fatal generation warnings to surface before the user applies (issue #156). */
  warnings?: string[];
}

/**
 * Staging-overlay session: the extension's confirm-before-write flow for
 * generated files (issue #93) — which files will be applied, which the user
 * opened in the merge editor, and the confirm/cancel round-trip back to the
 * extension. Extracted from IpCoreApp (issue #129).
 */
export function useStagingSession() {
  const [stagingData, setStagingData] = useState<{
    files: StagedFileView[];
    rootLabel?: string;
    warnings?: string[];
  } | null>(null);
  // Files the user opened in the merge editor during the current staging — shown
  // as "merging" in the overlay and excluded from the bulk apply by the extension.
  const [stagingMergedPaths, setStagingMergedPaths] = useState<Set<string>>(new Set());
  // Chosen action per modified file for the current staging — seeded from each
  // file's default action; sent to the extension on confirm.
  const [stagingActions, setStagingActions] = useState<Record<string, StagingAction>>({});

  const handleStagingStart = useCallback((message: StagingStartMessage) => {
    setStagingMergedPaths(new Set());
    setStagingActions(
      Object.fromEntries(
        (message.files ?? [])
          .filter((f) => f.status === 'modified')
          .map((f) => [f.relativePath, f.defaultAction ?? 'keep'])
      )
    );
    setStagingData(
      message.files
        ? { files: message.files, rootLabel: message.rootLabel, warnings: message.warnings }
        : null
    );
  }, []);

  const handleStagingFileMerged = useCallback((relativePath: string | undefined) => {
    if (!relativePath) {
      return;
    }
    setStagingMergedPaths((prev) => {
      const next = new Set(prev);
      next.add(relativePath);
      return next;
    });
    // The merge editor now owns this file; the bulk apply must not write it.
    setStagingActions((prev) => {
      const { [relativePath]: _merged, ...rest } = prev;
      return rest;
    });
  }, []);

  const setStagingAction = useCallback((relativePath: string, action: StagingAction) => {
    setStagingActions((prev) => ({ ...prev, [relativePath]: action }));
  }, []);

  const mergeStagingFile = useCallback((relativePath: string) => {
    vscode?.postMessage({ type: 'stagingAction', action: 'merge', relativePath });
  }, []);

  const confirmStaging = useCallback(() => {
    vscode?.postMessage({
      type: 'stagingResult',
      confirmed: true,
      actions: stagingActions,
    });
    setStagingData(null);
  }, [stagingActions]);

  const cancelStaging = useCallback(() => {
    vscode?.postMessage({ type: 'stagingResult', confirmed: false });
    setStagingData(null);
  }, []);

  return {
    stagingData,
    stagingMergedPaths,
    stagingActions,
    handleStagingStart,
    handleStagingFileMerged,
    setStagingAction,
    mergeStagingFile,
    confirmStaging,
    cancelStaging,
  };
}
