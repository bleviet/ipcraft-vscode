const DIRECTION_MAP: Record<string, string> = {
  in: 'input',
  out: 'output',
  inout: 'inout',
  input: 'input',
  output: 'output',
};

export function displayDirection(dir?: string, fallback = 'input'): string {
  const normalized = (dir ?? '').toLowerCase();
  const mapped = DIRECTION_MAP[normalized];
  if (mapped) {
    return mapped;
  }
  return dir ?? fallback;
}
