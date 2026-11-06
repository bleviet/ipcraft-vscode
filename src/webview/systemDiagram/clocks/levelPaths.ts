/** Whether level `level` is `path` or nested below it; every level is within the root `/`. */
export function isWithinLevel(level: string, path: string): boolean {
  return level === path || level.startsWith(path === '/' ? '/' : `${path}/`);
}

/** Number of hierarchy steps below the root: `/` is 0, `/h` is 1, `/h/g` is 2. */
export function levelDepth(level: string): number {
  return level === '/' ? 0 : level.split('/').length - 1;
}
