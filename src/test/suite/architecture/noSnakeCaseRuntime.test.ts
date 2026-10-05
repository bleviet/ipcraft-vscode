import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture guard: production code reads camelCase `.ip.yml` / `.mm.yml` input only.
 *
 * Legacy snake_case spellings live in exactly ONE place, `src/shared/ipCoreFormat/legacyKeys.ts`,
 * which `ipcraft migrate` uses to convert old files. No runtime code (parser, webview,
 * services, providers) may read them or fall back to them.
 *
 * The only other allowed matches are the generated Nunjucks template context in
 * `src/generator/**`, where snake_case is intentional because HDL templates require it.
 * Each allowlisted generator file below states why. This test scans all of `src` (except
 * tests and mocks) and fails if a legacy token appears anywhere else.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const TEST_DIR = path.join(SRC_DIR, 'test');
const SCAN_ROOTS = [SRC_DIR];

/** Files that are allowed to reference legacy snake_case spellings. */
const ALLOWLIST = new Set(
  [
    // The single source of truth for legacy spellings (used by `ipcraft migrate`).
    'src/shared/ipCoreFormat/legacyKeys.ts',
    // Nunjucks template context: `associated_clock` is a template variable name.
    'src/generator/resolvers/interrupts.ts',
    'src/generator/resolvers/clockReset.ts',
    // Nunjucks template context: `memory_maps` is a template variable name.
    'src/generator/IpCoreScaffolder.ts',
    'src/services/toolchains/VivadoToolchain.ts',
    // Nunjucks template context: register/field/block shapes use snake_case keys.
    'src/generator/registerProcessor.ts',
    'src/generator/resolvers/shadowRegisters.ts',
    // Generated from the template-context JSON schema (snake_case by contract).
    'src/generator/contract/templateContext.types.ts',
  ].map((p) => path.join(REPO_ROOT, p))
);

/** Legacy snake_case property tokens that must not appear in production code. */
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
  'memory_maps',
  'file_sets',
  'use_optional_ports',
  'port_width_overrides',
  'port_name_overrides',
  'absent_ports',
  'conduit_ports',
  'physical_prefix',
  'associated_clock',
  'associated_reset',
  'index_start',
  'naming_pattern',
  'physical_prefix_pattern',
  'bus_interfaces',
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__mocks__' || entry.name === 'node_modules' || full === TEST_DIR) {
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

describe('Architecture: no snake_case input spellings in production code', () => {
  const files = SCAN_ROOTS.flatMap(collectSourceFiles).filter((f) => !ALLOWLIST.has(f));

  const tokenRegex = new RegExp(`\\b(${LEGACY_TOKENS.join('|')})\\b`);

  it.each(files.map((f) => [path.relative(REPO_ROOT, f), f] as const))(
    'uses only canonical camelCase properties: %s',
    (_relative, absolute) => {
      const content = fs.readFileSync(absolute, 'utf8');
      const offending: string[] = [];
      content.split('\n').forEach((line, idx) => {
        const trimmed = line.trim();
        // Skip comment-only lines — the guard targets code (property access,
        // object keys, `?? snake_case` fallbacks), not prose in comments.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        if (tokenRegex.test(line)) {
          offending.push(`  line ${idx + 1}: ${trimmed}`);
        }
      });

      if (offending.length > 0) {
        throw new Error(
          `${path.relative(REPO_ROOT, absolute)} contains legacy snake_case ` +
            `property tokens. Read camelCase only; legacy spellings are converted by ` +
            `src/shared/ipCoreFormat/legacyKeys.ts (ipcraft migrate):\n${offending.join('\n')}`
        );
      }
    }
  );

  it('keeps every allowlisted file present', () => {
    // Guards against the allowlist silently pointing at a moved/renamed file.
    for (const allowed of ALLOWLIST) {
      expect(fs.existsSync(allowed)).toBe(true);
    }
  });
});
