import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture guard: the runtime memory-map model is camelCase-only.
 *
 * Legacy snake_case spellings are tolerated in exactly ONE place — the
 * compatibility boundary adapter `src/domain/parse.ts` — where raw `.mm.yml` /
 * `.ip.yml` input is normalized to canonical camelCase. `YamlPathResolver.ts`
 * is the separate on-disk format-preserving edit path that must still address
 * legacy keys already written to a user's file, so it is exempt too.
 *
 * Everywhere else downstream of the boundary (domain serialization, the layout
 * engine, mutation/insertion services, webview components) must operate on
 * canonical camelCase properties only. This test fails the build if a new
 * `camelCase ?? snake_case` fallback (or any legacy snake_case property token)
 * sneaks back into the runtime model. See the header comment in parse.ts.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SCAN_ROOTS = [path.join(REPO_ROOT, 'src', 'domain'), path.join(REPO_ROOT, 'src', 'webview')];

/** Files that are allowed to reference legacy snake_case spellings. */
const ALLOWLIST = new Set(
  [
    // The one documented compatibility boundary adapter.
    'src/domain/parse.ts',
    // The on-disk, format-preserving edit path: it navigates the raw YAML
    // document, which may still contain legacy keys written to disk earlier.
    'src/webview/services/YamlPathResolver.ts',
  ].map((p) => path.join(REPO_ROOT, p))
);

/** Legacy snake_case property tokens that must not appear in the runtime model. */
const LEGACY_TOKENS = [
  'address_offset',
  'base_address',
  'default_reg_width',
  'address_blocks',
  'reset_value',
  'bit_offset',
  'bit_width',
  'bit_range',
  'enumerated_values',
  'monitor_change_of',
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__mocks__' || entry.name === 'node_modules') {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no snake_case in the runtime memory-map model', () => {
  const files = SCAN_ROOTS.flatMap(collectSourceFiles).filter((f) => !ALLOWLIST.has(f));

  const tokenRegex = new RegExp(`\\b(${LEGACY_TOKENS.join('|')})\\b`);

  it.each(files.map((f) => [path.relative(REPO_ROOT, f), f] as const))(
    'uses only canonical camelCase properties: %s',
    (_relative, absolute) => {
      const content = fs.readFileSync(absolute, 'utf8');
      const offending: string[] = [];
      content.split('\n').forEach((line, idx) => {
        const match = line.match(tokenRegex);
        if (match) {
          offending.push(`  line ${idx + 1}: ${line.trim()}`);
        }
      });

      if (offending.length > 0) {
        throw new Error(
          `${path.relative(REPO_ROOT, absolute)} contains legacy snake_case ` +
            `property tokens. Normalize legacy input in src/domain/parse.ts (the one ` +
            `boundary adapter) instead of adding fallbacks here:\n${offending.join('\n')}`
        );
      }
    }
  );

  it('keeps the boundary adapter in the allowlist actually present', () => {
    // Guards against the allowlist silently pointing at a moved/renamed file.
    for (const allowed of ALLOWLIST) {
      expect(fs.existsSync(allowed)).toBe(true);
    }
  });
});
