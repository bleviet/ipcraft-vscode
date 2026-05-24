/**
 * Real-file smoke tests for HwTclParser.
 *
 * These tests parse actual Altera/Intel Platform Designer `_hw.tcl` files
 * extracted from a running Quartus Docker container and verify the parser
 * produces valid, structurally-correct IPCraft YAML.  The entire suite is
 * automatically skipped when the Docker image `cvsoc/quartus:23.1` is not
 * present locally, so the CI environment is not affected.
 *
 * To run manually:
 *   npx jest --config config/jest.config.js HwTclParser.altera
 *
 * Requirements:
 *   docker image ls cvsoc/quartus:23.1
 */

import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
import { parseHwTclContent } from '../../../parser/HwTclParser';

// ── Docker availability guard ──────────────────────────────────────────────

const QUARTUS_IMAGE = 'cvsoc/quartus:23.1';
const ALTERA_IP_ROOT = '/opt/intelFPGA/ip/altera';

function dockerImagePresent(image: string): boolean {
  try {
    const out = execSync(`docker image inspect ${image} --format "{{.Id}}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

const quartusPresent = dockerImagePresent(QUARTUS_IMAGE);

/** Read an Altera _hw.tcl file from inside the Docker container. */
function readHwTcl(relativePath: string): string {
  return execSync(`docker run --rm ${QUARTUS_IMAGE} cat ${ALTERA_IP_ROOT}/${relativePath}`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15_000,
  }).toString();
}

type AnyRecord = Record<string, any>;

const describeIf = quartusPresent ? describe : describe.skip;

// ─────────────────────────────────────────────────────────────────────────────

describeIf('HwTclParser — real Altera files', () => {
  // ─── altera_avalon_i2c ─────────────────────────────────────────────────────
  describe('altera_avalon_i2c', () => {
    let result: ReturnType<typeof parseHwTclContent>;
    let doc: AnyRecord;

    beforeAll(() => {
      const tcl = readHwTcl('altera_avalon_i2c/altera_avalon_i2c_hw.tcl');
      result = parseHwTclContent(tcl, 'altera_avalon_i2c_hw.tcl');
      doc = yaml.load(result.yamlText) as AnyRecord;
    });

    it('sets componentName', () => {
      expect(result.componentName).toBe('altera_avalon_i2c');
    });

    it('produces valid ip.yml YAML', () => {
      expect(() => yaml.load(result.yamlText)).not.toThrow();
    });

    it('captures the VLNV block', () => {
      expect(doc.vlnv.name).toBe('altera_avalon_i2c');
      expect(doc.vlnv.version).toBeTruthy();
    });

    it('includes a clock', () => {
      const clocks: AnyRecord[] = doc.clocks ?? [];
      expect(clocks.length).toBeGreaterThan(0);
      expect(clocks[0].name).toBeTruthy();
    });

    it('includes a reset', () => {
      const resets: AnyRecord[] = doc.resets ?? [];
      expect(resets.length).toBeGreaterThan(0);
    });

    it('includes Avalon-MM slave bus interface (csr)', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const csr = busifs.find((b) => b.name === 'csr');
      expect(csr).toBeDefined();
      expect(csr?.type).toContain('avalon_mm');
      expect(csr?.mode).toBe('slave');
    });

    it('includes Avalon-ST source (rx_data_source)', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const src = busifs.find((b) => b.name === 'rx_data_source');
      expect(src).toBeDefined();
      expect(src?.type).toContain('avalon_st');
      expect(src?.mode).toBe('master');
    });

    it('includes Avalon-ST sink (transfer_command_sink)', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const snk = busifs.find((b) => b.name === 'transfer_command_sink');
      expect(snk).toBeDefined();
      expect(snk?.type).toContain('avalon_st');
      expect(snk?.mode).toBe('slave');
    });

    it('includes conduit ports (I2C serial signals)', () => {
      const ports: AnyRecord[] = doc.ports ?? [];
      const portNames = ports.map((p) => p.name as string);
      expect(portNames).toContain('sda_in');
      expect(portNames).toContain('scl_in');
    });

    it('includes interrupt port in interrupts[]', () => {
      const interrupts: AnyRecord[] = (doc.interrupts as AnyRecord[]) ?? [];
      const intrNames = interrupts.map((p) => p.name as string);
      expect(intrNames).toContain('intr');
    });

    it('includes parameters', () => {
      const params: AnyRecord[] = doc.parameters ?? [];
      expect(params.length).toBeGreaterThan(0);
    });

    it('includes RTL file set', () => {
      const fileSets: AnyRecord[] = doc.fileSets ?? [];
      const rtl = fileSets.find((f) => f.name === 'RTL_Sources');
      expect(rtl).toBeDefined();
      expect(rtl?.files?.length).toBeGreaterThan(0);
      const types = (rtl?.files as AnyRecord[]).map((f) => f.type as string);
      expect(types.every((t) => t === 'verilog' || t === 'vhdl' || t === 'systemverilog')).toBe(
        true
      );
    });
  });

  // ─── altera_avalon_uart ───────────────────────────────────────────────────
  describe('altera_avalon_uart', () => {
    let result: ReturnType<typeof parseHwTclContent>;
    let doc: AnyRecord;

    beforeAll(() => {
      const tcl = readHwTcl('sopc_builder_ip/altera_avalon_uart/altera_avalon_uart_hw.tcl');
      result = parseHwTclContent(tcl, 'altera_avalon_uart_hw.tcl');
      doc = yaml.load(result.yamlText) as AnyRecord;
    });

    it('sets componentName', () => {
      expect(result.componentName).toBe('altera_avalon_uart');
    });

    it('produces valid YAML', () => {
      expect(() => yaml.load(result.yamlText)).not.toThrow();
    });

    it('includes clock and active-low reset', () => {
      const clocks: AnyRecord[] = doc.clocks ?? [];
      const resets: AnyRecord[] = doc.resets ?? [];
      expect(clocks.length).toBeGreaterThan(0);
      expect(resets.length).toBeGreaterThan(0);
      expect(resets[0].polarity).toBe('activeLow');
    });

    it('includes Avalon-MM slave (s1)', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const s1 = busifs.find((b) => b.name === 's1');
      expect(s1).toBeDefined();
      expect(s1?.type).toContain('avalon_mm');
      expect(s1?.mode).toBe('slave');
    });

    it('s1 has associatedClock and associatedReset', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const s1 = busifs.find((b) => b.name === 's1');
      expect(s1?.associatedClock).toBeTruthy();
      expect(s1?.associatedReset).toBeTruthy();
    });

    it('includes external conduit ports (rxd, txd)', () => {
      const ports: AnyRecord[] = doc.ports ?? [];
      const portNames = ports.map((p) => p.name as string);
      expect(portNames).toContain('rxd');
      expect(portNames).toContain('txd');
    });

    it('includes interrupt irq in interrupts[]', () => {
      const interrupts: AnyRecord[] = (doc.interrupts as AnyRecord[]) ?? [];
      const intrNames = interrupts.map((p) => p.name as string);
      expect(intrNames).toContain('irq');
    });

    it('includes UART parameters (baud, dataBits)', () => {
      const params: AnyRecord[] = doc.parameters ?? [];
      const names = params.map((p) => p.name as string);
      expect(names).toContain('baud');
      expect(names).toContain('dataBits');
    });
  });

  // ─── altera_avalon_spi ────────────────────────────────────────────────────
  describe('altera_avalon_spi', () => {
    let result: ReturnType<typeof parseHwTclContent>;
    let doc: AnyRecord;

    beforeAll(() => {
      const tcl = readHwTcl('sopc_builder_ip/altera_avalon_spi/altera_avalon_spi_hw.tcl');
      result = parseHwTclContent(tcl, 'altera_avalon_spi_hw.tcl');
      doc = yaml.load(result.yamlText) as AnyRecord;
    });

    it('sets componentName', () => {
      expect(result.componentName).toBe('altera_avalon_spi');
    });

    it('produces valid YAML', () => {
      expect(() => yaml.load(result.yamlText)).not.toThrow();
    });

    it('includes Avalon-MM slave (spi_control_port)', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const ctrl = busifs.find((b) => b.name === 'spi_control_port');
      expect(ctrl).toBeDefined();
      expect(ctrl?.type).toContain('avalon_mm');
      expect(ctrl?.mode).toBe('slave');
    });

    it('includes interrupt irq in interrupts[]', () => {
      const interrupts: AnyRecord[] = (doc.interrupts as AnyRecord[]) ?? [];
      const intrNames = interrupts.map((p) => p.name as string);
      expect(intrNames).toContain('irq');
    });

    it('includes SPI parameters (dataWidth, clockPhase)', () => {
      const params: AnyRecord[] = doc.parameters ?? [];
      const names = params.map((p) => p.name as string);
      expect(names).toContain('dataWidth');
      expect(names).toContain('clockPhase');
    });

    it('handles variable-width ports gracefully (no crash)', () => {
      // $slaveDataBusWidth ports fall back to width=1 — just verify no crash
      expect(doc).toBeDefined();
    });
  });

  // ─── altera_pll (clock-only, no bus interfaces) ───────────────────────────
  describe('altera_pll', () => {
    let result: ReturnType<typeof parseHwTclContent>;
    let doc: AnyRecord;

    beforeAll(() => {
      const tcl = readHwTcl('altera_pll/source/top/pll_hw.tcl');
      result = parseHwTclContent(tcl, 'pll_hw.tcl');
      doc = yaml.load(result.yamlText) as AnyRecord;
    });

    it('sets componentName', () => {
      expect(result.componentName).toBe('altera_pll');
    });

    it('produces valid YAML', () => {
      expect(() => yaml.load(result.yamlText)).not.toThrow();
    });

    it('includes refclk input clock', () => {
      const clocks: AnyRecord[] = doc.clocks ?? [];
      expect(clocks.length).toBeGreaterThan(0);
      const refclk = clocks.find((c) => c.name === 'refclk');
      expect(refclk).toBeDefined();
    });

    it('includes reset', () => {
      const resets: AnyRecord[] = doc.resets ?? [];
      expect(resets.length).toBeGreaterThan(0);
    });

    it('has no bus interfaces (PLL has none)', () => {
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      expect(busifs.length).toBe(0);
    });

    it('includes PLL parameters', () => {
      const params: AnyRecord[] = doc.parameters ?? [];
      expect(params.length).toBeGreaterThan(0);
    });
  });
});
