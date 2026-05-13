export interface ParsedVlnv {
  vendor: string;
  library: string;
  name: string;
  version: string;
}

export function parseVlnv(vlnv: string): ParsedVlnv {
  const parts = vlnv.split(':');
  if (parts.length !== 4 || parts.some((p) => !p)) {
    throw new Error(`Invalid VLNV "${vlnv}": expected vendor:library:name:version`);
  }
  return { vendor: parts[0], library: parts[1], name: parts[2], version: parts[3] };
}

export function formatVlnv(v: ParsedVlnv): string {
  return `${v.vendor}:${v.library}:${v.name}:${v.version}`;
}

export function isValidVlnv(vlnv: string): boolean {
  return /^[^:]+:[^:]+:[^:]+:[^:]+$/.test(vlnv);
}
