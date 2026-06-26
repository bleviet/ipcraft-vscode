/**
 * Real-world parser harness (discovery tier).
 *
 * Exercises HwTclParser and ComponentXmlParser against real `_hw.tcl` and
 * `component.xml` files fetched from public GitHub repositories into
 * `.test-fixtures/` (never committed — see `.gitignore` and the pre-commit
 * guard in `scripts/check-no-fixtures.sh`). The goal is to DISCOVER parser
 * bugs against real-world syntax, not to gate CI; by default findings are
 * logged and summarised. Set STRICT_REALWORLD=1 to fail the suite on any
 * parser crash or structural-coverage gap.
 *
 * Adapted to this repo (vs. the generic request):
 *   - Jest (config/jest.integration.js), not Mocha. Discovered fixtures are
 *     enumerated at module load with fs.readdirSync; run `npm run fetch-fixtures`
 *     once first (the in-suite fetch keeps the cache warm for the next run).
 *   - Parsers emit canonical `.ip.yml` text (yamlText / ipYamlText), so the
 *     "round-trip" is: parse -> load emitted YAML -> assert it covers the
 *     interface/port/parameter names regex-extracted from the raw file.
 *   - Jest has no runtime `this.skip()`; crashes are logged + summarised
 *     instead of marked pending.
 *
 * ---------------------------------------------------------------------------
 * Commit-message guidance for bugs found via this harness.
 *
 * Describe the syntactic/structural CLASS of the bug, never the specimen repo
 * or file that revealed it. The message must stay valid even if every fixture
 * is deleted.
 *
 *   GOOD: "Fix parsing of nested parameter groups with empty default values"
 *   BAD:  "Fix bug found in analogdevicesinc/hdl axi_hdmi_tx_hw.tcl"
 *
 *   GOOD: "Handle missing clock interface declaration in hw.tcl component block"
 *   BAD:  "Handle edge case from Digilent vivado-library PWM component"
 *
 *   GOOD: "Correct XML namespace resolution for spirit:component in IP-XACT files"
 *   BAD:  "Fix parser crash on Nuand bladeRF time_tamer file"
 *
 *   GOOD: "Support optional busInterfaceRef attribute in component port maps"
 *   BAD:  "Fix Xilinx axi_1wire_host component.xml import"
 *
 *   GOOD: "Fix off-by-one in Tcl list parser when interface body spans lines"
 *   BAD:  "Fix parser crash on machinekit mksocfpga hw.tcl"
 * ---------------------------------------------------------------------------
 */

import * as fs from 'fs';
import * as path from 'path';
import * as jsYaml from 'js-yaml';
import { parseHwTclContent } from '../../parser/HwTclParser';
import { parseComponentXmlText } from '../../parser/ComponentXmlParser';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchFixtures, FIXTURE_ROOT } = require('../../../scripts/fetchFixtures.js') as {
  fetchFixtures: () => Promise<unknown[]>;
  FIXTURE_ROOT: string;
};

const FAILURE_LOG = path.join('/tmp', 'parser-failures.log');
const STRICT = process.env.STRICT_REALWORLD === '1';

type Kind = 'hw_tcl' | 'component_xml';
interface Fixture {
  kind: Kind;
  absPath: string;
  label: string; // stable, repo-relative-ish label for test names
}

/** Recursively list every file under `dir`. */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function discoverFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const [sub, kind] of [
    ['hw_tcl', 'hw_tcl'],
    ['component_xml', 'component_xml'],
  ] as [string, Kind][]) {
    const base = path.join(FIXTURE_ROOT, sub);
    for (const absPath of listFiles(base)) {
      fixtures.push({ kind, absPath, label: path.relative(base, absPath) });
    }
  }
  return fixtures;
}

// --- structural name extraction --------------------------------------------

/** Names declared in a raw `_hw.tcl`: interfaces, ports, parameters. */
function rawHwTclNames(text: string): Set<string> {
  const names = new Set<string>();
  const collect = (re: RegExp, group: number) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[group]) {
        names.add(m[group]);
      }
    }
  };
  // add_interface <name> <type> ...
  collect(/^\s*add_interface\s+([A-Za-z_]\w*)/gm, 1);
  // add_interface_port <iface> <port> <logical> <dir> ...
  collect(/^\s*add_interface_port\s+\S+\s+([A-Za-z_]\w*)/gm, 1);
  // add_parameter <name> <type> ...
  collect(/^\s*add_parameter\s+([A-Za-z_]\w*)/gm, 1);
  return names;
}

/** Names declared in a raw IP-XACT `component.xml`: bus interfaces, ports, parameters. */
function rawComponentXmlNames(text: string): Set<string> {
  const names = new Set<string>();
  // <spirit:name>X</spirit:name> and <ipxact:name>X</ipxact:name>
  const re = /<(?:spirit|ipxact):name>([^<]+)<\/(?:spirit|ipxact):name>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1].trim();
    if (/^[A-Za-z_]\w*$/.test(v)) {
      names.add(v);
    }
  }
  return names;
}

/**
 * Coverage = fraction of raw-extracted names that appear (case-insensitively)
 * somewhere in the emitted `.ip.yml` text. The emitted YAML is the parser's
 * canonical serialization, so substring presence is a robust semantic proxy
 * that does not over-couple to the schema's internal field names.
 */
function coverage(
  rawNames: Set<string>,
  emittedYaml: string
): { covered: number; missing: string[] } {
  const hay = emittedYaml.toLowerCase();
  const missing: string[] = [];
  for (const n of rawNames) {
    if (!hay.includes(n.toLowerCase())) {
      missing.push(n);
    }
  }
  return { covered: rawNames.size - missing.length, missing };
}

// --- parser adapters --------------------------------------------------------

function parseToYaml(fx: Fixture, content: string): string {
  if (fx.kind === 'hw_tcl') {
    // Pass a synthetic path; `source` includes in standalone files are not
    // resolvable here and are tolerated by the content-level parser.
    return parseHwTclContent(content, fx.absPath).yamlText;
  }
  return parseComponentXmlText(content).ipYamlText;
}

function rawNamesFor(fx: Fixture, content: string): Set<string> {
  return fx.kind === 'hw_tcl' ? rawHwTclNames(content) : rawComponentXmlNames(content);
}

// --- suite ------------------------------------------------------------------

beforeAll(async () => {
  // Keep the cache warm for the next run. No-op offline / under SKIP_FETCH.
  if (process.env.SKIP_FETCH === '1') {
    return;
  }
  try {
    await fetchFixtures();
  } catch (err) {
    console.warn('fetchFixtures failed (continuing with cached fixtures):', err);
  }
}, 120_000);

const fixtures = discoverFixtures();

interface Outcome {
  label: string;
  status: 'pass' | 'gap' | 'crash';
  detail?: string;
}
const outcomes: Outcome[] = [];

if (fixtures.length === 0) {
  it.skip('no fixtures cached — run `npm run fetch-fixtures` first', () => undefined);
} else {
  describe('real-world parser harness', () => {
    for (const fx of fixtures) {
      it(`${fx.kind}: ${fx.label}`, () => {
        const content = fs.readFileSync(fx.absPath, 'utf8');

        let emitted: string;
        try {
          emitted = parseToYaml(fx, content);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          outcomes.push({ label: fx.label, status: 'crash', detail: msg });
          if (STRICT) {
            throw err;
          }
          console.warn(`  [crash] ${fx.kind}/${fx.label}: ${msg}`);
          return; // discovery mode: logged, not a hard failure
        }

        expect(emitted).toBeTruthy();
        // Emitted text must be loadable YAML (catches malformed serialization).
        const loaded = jsYaml.load(emitted) as Record<string, unknown>;
        expect(loaded).toBeTruthy();

        const rawNames = rawNamesFor(fx, content);
        const { covered, missing } = coverage(rawNames, emitted);

        if (missing.length > 0) {
          const detail =
            `covered ${covered}/${rawNames.size}; missing: ${missing.slice(0, 12).join(', ')}` +
            (missing.length > 12 ? ` (+${missing.length - 12} more)` : '');
          outcomes.push({ label: fx.label, status: 'gap', detail });
          if (STRICT) {
            throw new Error(`structural-coverage gap in ${fx.label}: ${detail}`);
          }
          console.warn(`  [gap] ${fx.kind}/${fx.label}: ${detail}`);
          return;
        }

        outcomes.push({ label: fx.label, status: 'pass' });
      });
    }
  });
}

afterAll(() => {
  const passed = outcomes.filter((o) => o.status === 'pass');
  const gaps = outcomes.filter((o) => o.status === 'gap');
  const crashes = outcomes.filter((o) => o.status === 'crash');

  const lines: string[] = [];
  lines.push(`Real-world parser harness — ${new Date().toISOString()}`);
  lines.push(
    `total ${outcomes.length} | pass ${passed.length} | gap ${gaps.length} | crash ${crashes.length}`
  );
  lines.push('');
  for (const o of [...crashes, ...gaps]) {
    lines.push(`[${o.status}] ${o.label}: ${o.detail ?? ''}`);
  }
  fs.writeFileSync(FAILURE_LOG, `${lines.join('\n')}\n`, 'utf8');

  /* eslint-disable no-console */
  console.log('\n=== real-world parser harness summary ===');
  console.log(
    `total ${outcomes.length} | pass ${passed.length} | gap ${gaps.length} | crash ${crashes.length}`
  );
  console.log(`details written to ${FAILURE_LOG}`);
  if (gaps.length + crashes.length > 0) {
    console.log(
      STRICT
        ? 'STRICT_REALWORLD=1 — gaps/crashes failed individual tests above.'
        : 'discovery mode — set STRICT_REALWORLD=1 to fail on these.'
    );
  }
  /* eslint-enable no-console */
});
