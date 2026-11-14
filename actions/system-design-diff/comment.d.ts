export const MARKER: string;

export interface DesignReport {
  design: string;
  markdown: string;
  exitCode: number;
  stderr?: string;
}

export function composeComment(reports: DesignReport[]): string;

export function readReports(reportDir: string, designs: string[]): Required<DesignReport>[];

export function main(): Promise<void>;

export function upsertComment(options: {
  token: string;
  repo: string;
  issueNumber: number;
  body: string;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}): Promise<{ action: 'updated' | 'created'; id: number }>;
