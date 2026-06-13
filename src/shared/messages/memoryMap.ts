export type MmWebviewMessage =
  | { type: 'ready' }
  | { type: 'update'; text: string; editId?: number; baseDocVersion?: number }
  | { type: 'command'; command: 'save' | 'validate' }
  | { type: 'command'; command: 'openFile'; path: string };
