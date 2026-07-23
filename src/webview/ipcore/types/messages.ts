import type { PackSummary, RegisteredToolchain } from '../components/IpCoreToolbar';
import type { StagingStartMessage } from '../hooks/useStagingSession';
import type { ConsistencyResultMessage } from '../hooks/useConsistencySession';

/**
 * Discriminated union of every message the extension host sends to the IP
 * Core webview. Mirrors (but does not replace) the revisioned sync protocol
 * fields consumed by `revisionFilter.ts` — `docVersion`/`sourceEditId`/
 * `forceResync` only apply to `update` messages.
 */
export interface IpCoreUpdateMessage {
  type: 'update';
  text: string;
  fileName: string;
  imports?: {
    memoryMaps?: Record<string, unknown>[];
    fileSets?: Record<string, unknown>[];
    busLibrary?: Record<string, unknown>;
  };
  hasComponentXml?: boolean;
  hasHwTcl?: boolean;
  hasXpr?: boolean;
  hasQpf?: boolean;
  hdlLanguage?: 'vhdl' | 'systemverilog';
  scaffoldPack?: string;
  availableScaffoldPacks?: PackSummary[];
  toolbarTargets?: string[];
  allToolchains?: RegisteredToolchain[];
  isPreview?: boolean;
  docVersion?: number;
  sourceEditId?: number;
  forceResync?: boolean;
}

export type IpCoreStagingStartMessage = StagingStartMessage & { type: 'stagingStart' };

export interface IpCoreStagingFileMergedMessage {
  type: 'stagingFileMerged';
  relativePath?: string;
}

export type IpCoreConsistencyResultMessage = ConsistencyResultMessage & {
  type: 'consistencyResult';
};

export type ExtensionToWebviewMessage =
  | IpCoreUpdateMessage
  | IpCoreStagingStartMessage
  | IpCoreStagingFileMergedMessage
  | IpCoreConsistencyResultMessage;
