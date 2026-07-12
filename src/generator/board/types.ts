export type Polarity = 'activeHigh' | 'activeLow';
export type IoDirection = 'in' | 'out';

export interface BoardClock {
  name: string;
  pin: string;
  frequencyHz: number;
  ioStandard?: string;
}

export interface BoardReset {
  name: string;
  pin: string;
  polarity: Polarity;
  ioStandard?: string;
}

export interface BoardIo {
  name: string;
  pin: string;
  direction: IoDirection;
  polarity?: Polarity;
  ioStandard?: string;
}

export interface BoardDefinition {
  name: string;
  device: string;
  family: string;
  vendor: string;
  clocks: BoardClock[];
  resets: BoardReset[];
  ios: BoardIo[];
}
