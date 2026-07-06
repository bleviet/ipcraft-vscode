export interface GenerateOptionsMessage {
  vendorFiles?: 'none' | 'altera' | 'xilinx' | 'both';
  includeTestbench?: boolean;
  includeRegfile?: boolean;
  includeVhdl?: boolean;
}

export interface GenerateRequestMessage {
  options?: GenerateOptionsMessage;
}

export type IpCoreWebviewMessage =
  | { type: 'ready' }
  | { type: 'update'; text: string; editId?: number; baseDocVersion?: number }
  | { type: 'selectFiles'; startPath?: string; multi?: boolean; filters?: Record<string, string[]> }
  | { type: 'checkFilesExist'; paths: string[] }
  | { type: 'generate'; options?: GenerateOptionsMessage }
  | {
      type: 'saveCustomBusDefinition';
      typeName: string;
      displayName: string;
      ports: Array<Record<string, unknown>>;
    }
  | { type: 'command'; command: string }
  | { type: 'setHdlLanguage'; language: string }
  | { type: 'setToolbarTargets'; targets: string[] }
  | { type: 'setScaffoldPack'; packName: string }
  | { type: 'openScaffoldPacksWalkthrough' }
  | { type: 'openWalkthroughMenu' }
  | { type: 'openFile'; path: string }
  | { type: 'addSubcore' }
  | { type: 'editInIpPackager' }
  | { type: 'editInPlatformDesigner' }
  | { type: 'openInVivado' }
  | { type: 'openInQuartus' }
  | { type: 'stagingResult'; confirmed: boolean; overwritePaths?: string[] }
  | { type: 'stagingAction'; action: 'viewDiff' | 'viewPreview' | 'merge'; relativePath: string }
  | { type: 'saveAsIpYml' };
