import { useCallback, useState } from 'react';
import { vscode } from '../../vscode';
import type { PacketFormatCandidate, PacketFormatRefInfo } from '../../../shared/packetFormat';

const NO_INFOS: Record<string, PacketFormatRefInfo> = {};
const NO_CANDIDATES: readonly PacketFormatCandidate[] = [];

/** Host-resolved packet formats (per `packetFormatRef`) and the workspace picker candidates. */
export function usePacketFormats() {
  const [infos, setInfos] = useState<Record<string, PacketFormatRefInfo>>(NO_INFOS);
  const [candidates, setCandidates] = useState<readonly PacketFormatCandidate[]>(NO_CANDIDATES);

  const handleInfo = useCallback((next: Record<string, PacketFormatRefInfo>) => setInfos(next), []);
  const handleCandidates = useCallback(
    (next: readonly PacketFormatCandidate[]) => setCandidates(next),
    []
  );
  const requestCandidates = useCallback(() => {
    vscode?.postMessage({ type: 'findPacketFormats' });
  }, []);
  const openFile = useCallback((relativePath: string) => {
    vscode?.postMessage({ type: 'openFile', path: relativePath });
  }, []);

  return { infos, candidates, handleInfo, handleCandidates, requestCandidates, openFile };
}

export type PacketFormats = ReturnType<typeof usePacketFormats>;
