import { useCallback, useState } from 'react';
import { vscode } from '../../vscode';
import type { StagedFileView } from '../components/canvas/StagingOverlay';

export interface StagingStartMessage {
  files?: StagedFileView[];
  rootLabel?: string;
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
  } | null>(null);
  // Files the user opened in the merge editor during the current staging — shown
  // as "merging" in the overlay and excluded from the bulk apply by the extension.
  const [stagingMergedPaths, setStagingMergedPaths] = useState<Set<string>>(new Set());
  // Modified files that will be written for the current staging — defaults to
  // every normal file, none of the protected (managed: false) ones; sent to
  // the extension on confirm so the bulk apply writes exactly this set.
  const [stagingOverwritePaths, setStagingOverwritePaths] = useState<Set<string>>(new Set());

  const handleStagingStart = useCallback((message: StagingStartMessage) => {
    setStagingMergedPaths(new Set());
    // Every modified file defaults to "will be applied" except locked
    // (managed: false) ones, matching today's implicit apply-everything
    // / skip-locked-files behavior until the user toggles a row.
    setStagingOverwritePaths(
      new Set(
        (message.files ?? [])
          .filter((f) => f.status === 'modified' && !f.protected)
          .map((f) => f.relativePath)
      )
    );
    setStagingData(message.files ? { files: message.files, rootLabel: message.rootLabel } : null);
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
  }, []);

  const toggleStagingOverwrite = useCallback((relativePath: string) => {
    setStagingOverwritePaths((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }, []);

  const mergeStagingFile = useCallback((relativePath: string) => {
    vscode?.postMessage({ type: 'stagingAction', action: 'merge', relativePath });
  }, []);

  const confirmStaging = useCallback(() => {
    vscode?.postMessage({
      type: 'stagingResult',
      confirmed: true,
      overwritePaths: [...stagingOverwritePaths],
    });
    setStagingData(null);
  }, [stagingOverwritePaths]);

  const cancelStaging = useCallback(() => {
    vscode?.postMessage({ type: 'stagingResult', confirmed: false });
    setStagingData(null);
  }, []);

  return {
    stagingData,
    stagingMergedPaths,
    stagingOverwritePaths,
    handleStagingStart,
    handleStagingFileMerged,
    toggleStagingOverwrite,
    mergeStagingFile,
    confirmStaging,
    cancelStaging,
  };
}
