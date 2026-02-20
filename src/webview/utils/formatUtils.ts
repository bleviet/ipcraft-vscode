export function toHex(n: number): string {
  return `0x${Math.max(0, n).toString(16).toUpperCase()}`;
}
