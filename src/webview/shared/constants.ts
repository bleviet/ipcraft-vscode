export const ACCESS_OPTIONS = [
  'read-only',
  'write-only',
  'read-write',
  'write-1-to-clear',
  'read-write-1-to-clear',
  'write-self-clearing',
  'read-write-self-clearing',
] as const;

export const BASIC_ACCESS_OPTIONS = ['read-write', 'read-only', 'write-only'] as const;

/**
 * Short SVD/IP-XACT-style tokens shown in the closed access dropdown control.
 * The full enum name is shown only in the open listbox (see
 * `vscode-option[data-option-detail]::after` in index.css); YAML always keeps
 * the full enum string.
 */
export const ACCESS_ABBREVIATIONS: Record<(typeof ACCESS_OPTIONS)[number], string> = {
  'read-only': 'RO',
  'write-only': 'WO',
  'read-write': 'RW',
  'write-1-to-clear': 'W1C',
  'read-write-1-to-clear': 'RW1C',
  'write-self-clearing': 'WSC',
  'read-write-self-clearing': 'RWSC',
};
