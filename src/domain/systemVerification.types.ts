export interface SystemVerificationTarget {
  readonly driveInterfacePath: string;
  readonly instancePath: string;
  readonly memoryMap: string;
}

export interface SystemVerificationRouteSummary {
  readonly driveInterfacePath: string;
  readonly instancePath: string;
  readonly baseAddress: number;
}

export interface SystemVerificationConfig {
  readonly recreateScript: string;
  readonly part: string;
  readonly designName: string;
  readonly clockPath: string;
  readonly clockPeriodNs: number;
  readonly resetPath: string;
  readonly resetActiveLow: boolean;
  readonly resetCycles: number;
  readonly target: SystemVerificationTarget;
}

export interface DiscoveredAxiRoute {
  readonly driveInterfacePath: string;
  readonly instancePath: string;
  readonly protocol: string;
  readonly baseAddress: number;
  readonly addressRange: number;
  readonly busBytes: number;
  readonly addressWidth: number;
  readonly addressSegmentPath: string;
  readonly mappedSegmentPath: string;
}

export type DiscoveredPortDirection = 'in' | 'out' | 'inout';

export interface DiscoveredBoundarySignal {
  readonly name: string;
  readonly direction: DiscoveredPortDirection;
  readonly width: number;
}

export interface DiscoveredBoundaryInterface {
  readonly path: string;
  readonly mode: string;
  readonly protocol: string;
  readonly addressWidth: number;
  readonly dataWidth: number;
  readonly signals: ReadonlyArray<DiscoveredBoundarySignal>;
}

export interface DiscoveredBoundaryPort {
  readonly path: string;
  readonly type: 'clock' | 'reset' | 'data';
  readonly direction: DiscoveredPortDirection;
  readonly width: number;
}

export interface DiscoveredWrapperPort {
  readonly name: string;
  readonly direction: DiscoveredPortDirection;
  readonly width: number;
  readonly isVector: boolean;
}

export interface DiscoveredSystem {
  readonly designName: string;
  readonly wrapperLanguage: string;
  readonly boundaryInterfaces: ReadonlyArray<DiscoveredBoundaryInterface>;
  readonly boundaryPorts: ReadonlyArray<DiscoveredBoundaryPort>;
  readonly wrapperPorts: ReadonlyArray<DiscoveredWrapperPort>;
  readonly instancePaths: ReadonlyArray<string>;
  readonly axiRoutes: ReadonlyArray<DiscoveredAxiRoute>;
}

export type VerificationVectorKind = 'resetRead' | 'writeReadback';

export interface VerificationVector {
  readonly kind: VerificationVectorKind;
  readonly address: number;
  readonly expectedValue: number;
  readonly compareMask: number;
  readonly writeValue?: number;
  readonly registerName: string;
  readonly skippedReason?: string;
}

export interface SystemVerificationTransaction {
  readonly registerName: string;
  readonly address: number;
  readonly vectors: ReadonlyArray<VerificationVector>;
}

export interface SystemVerificationPlan {
  readonly route: DiscoveredAxiRoute;
  readonly boundaryInterface: DiscoveredBoundaryInterface;
  readonly clockPort: DiscoveredBoundaryPort;
  readonly resetPort: DiscoveredBoundaryPort;
  readonly wrapperPorts: ReadonlyArray<DiscoveredWrapperPort>;
  readonly wrapperLanguage: 'VHDL';
  readonly transactions: ReadonlyArray<SystemVerificationTransaction>;
}

export type SystemVerificationStage =
  | 'preflight'
  | 'recreate'
  | 'discover'
  | 'plan'
  | 'compile'
  | 'run'
  | 'complete';

export interface SystemVerificationLifecycleEvent {
  readonly stage: SystemVerificationStage;
  readonly timestamp: number;
}

export type SystemVerificationOutcome = 'passed' | 'failed' | 'cancelled';

export interface SystemVerificationResult {
  readonly outcome: SystemVerificationOutcome;
  readonly runDirectory: string;
  readonly logsPath: string;
  readonly waveformPath?: string;
  readonly firstFailure?: string;
  readonly route?: SystemVerificationRouteSummary;
}
