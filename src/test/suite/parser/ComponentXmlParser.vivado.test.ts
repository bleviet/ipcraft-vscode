/**
 * Real-file smoke tests for ComponentXmlParser.
 *
 * These tests parse actual Vivado IP-XACT component.xml files and verify the
 * parser produces valid, structurally-correct IPCraft YAML.  The entire suite
 * is automatically skipped when the Xilinx Vivado installation is absent so
 * the CI environment is not affected.
 *
 * To run against a local Vivado installation:
 *   npx jest --config config/jest.config.js ComponentXmlParser.vivado
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseComponentXmlText } from '../../../parser/ComponentXmlParser';

const VIVADO_IP_DIR = '/home/balevision/tools/Xilinx/Vivado/2024.2/data/ip/xilinx';

const vivadoPresent = fs.existsSync(VIVADO_IP_DIR);

/** Read a component.xml from the Vivado IP directory — returns null when the file is absent. */
function readComponentXml(ipName: string): string | null {
  const p = path.join(VIVADO_IP_DIR, ipName, 'component.xml');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

type AnyRecord = Record<string, any>;

const describeIf = vivadoPresent ? describe : describe.skip;

describeIf('ComponentXmlParser — real Vivado files', () => {
  // ─── axi_gpio_v2_0 ────────────────────────────────────────────────────────
  describe('axi_gpio_v2_0', () => {
    let result: ReturnType<typeof parseComponentXmlText>;

    beforeAll(() => {
      const xml = readComponentXml('axi_gpio_v2_0');
      if (!xml) {
        throw new Error('axi_gpio_v2_0/component.xml not found');
      }
      result = parseComponentXmlText(xml);
    });

    it('sets componentName', () => {
      expect(result.componentName).toBeTruthy();
    });

    it('produces valid ip.yml YAML', () => {
      expect(() => yaml.load(result.ipYamlText)).not.toThrow();
    });

    it('includes an AXI4L slave bus interface', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const axi4l = busifs.find((b) => b.type === 'AXI4L');
      expect(axi4l).toBeDefined();
      expect(axi4l?.mode).toBe('slave');
    });

    it('generates mm.yml (has registers)', () => {
      expect(result.mmYamlText).toBeTruthy();
      expect(result.mmFileName).toMatch(/\.mm\.yml$/);
    });

    it('mm.yml is valid YAML with address blocks', () => {
      const doc = yaml.load(result.mmYamlText!) as AnyRecord;
      const blocks: AnyRecord[] = doc.addressBlocks ?? [];
      expect(blocks.length).toBeGreaterThan(0);
    });

    it('mm.yml registers have names and offsets', () => {
      const doc = yaml.load(result.mmYamlText!) as AnyRecord;
      const block = (doc.addressBlocks as AnyRecord[])[0];
      const regs: AnyRecord[] = block?.registers ?? [];
      expect(regs.length).toBeGreaterThan(0);
      for (const reg of regs) {
        expect(reg.name).toBeTruthy();
        expect(reg.addressOffset).toBeTruthy();
      }
    });

    it('ip.yml has clock interface', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const clocks: AnyRecord[] = doc.clocks ?? [];
      expect(clocks.length).toBeGreaterThan(0);
    });

    it('ip.yml has reset interface', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const resets: AnyRecord[] = doc.resets ?? [];
      expect(resets.length).toBeGreaterThan(0);
    });
  });

  // ─── axi_uartlite_v2_0 ────────────────────────────────────────────────────
  describe('axi_uartlite_v2_0', () => {
    let result: ReturnType<typeof parseComponentXmlText>;

    beforeAll(() => {
      const xml = readComponentXml('axi_uartlite_v2_0');
      if (!xml) {
        throw new Error('axi_uartlite_v2_0/component.xml not found');
      }
      result = parseComponentXmlText(xml);
    });

    it('sets componentName', () => {
      expect(result.componentName).toBeTruthy();
    });

    it('produces valid ip.yml YAML', () => {
      expect(() => yaml.load(result.ipYamlText)).not.toThrow();
    });

    it('includes an AXI4L bus interface', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      expect(busifs.some((b) => b.type === 'AXI4L')).toBe(true);
    });

    it('generates mm.yml (has registers)', () => {
      expect(result.mmYamlText).toBeTruthy();
    });

    it('mm.yml address blocks have registers with fields', () => {
      const doc = yaml.load(result.mmYamlText!) as AnyRecord;
      const block = (doc.addressBlocks as AnyRecord[])?.[0];
      const regs: AnyRecord[] = block?.registers ?? [];
      const withFields = regs.filter((r) => Array.isArray(r.fields) && r.fields.length > 0);
      expect(withFields.length).toBeGreaterThan(0);
    });
  });

  // ─── axi_dma_v7_1 ────────────────────────────────────────────────────────
  describe('axi_dma_v7_1', () => {
    let result: ReturnType<typeof parseComponentXmlText>;

    beforeAll(() => {
      const xml = readComponentXml('axi_dma_v7_1');
      if (!xml) {
        throw new Error('axi_dma_v7_1/component.xml not found');
      }
      result = parseComponentXmlText(xml);
    });

    it('sets componentName', () => {
      expect(result.componentName).toBeTruthy();
    });

    it('produces valid ip.yml YAML', () => {
      expect(() => yaml.load(result.ipYamlText)).not.toThrow();
    });

    it('detects AXI4L slave (S_AXI_LITE)', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const lite = busifs.find((b) => b.type === 'AXI4L' && b.mode === 'slave');
      expect(lite).toBeDefined();
    });

    it('detects AXI4F master interfaces', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      const fullMasters = busifs.filter((b) => b.type === 'AXI4F' && b.mode === 'master');
      expect(fullMasters.length).toBeGreaterThan(0);
    });

    it('detects AXI4S stream interfaces', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      expect(busifs.some((b) => b.type === 'AXI4S')).toBe(true);
    });

    it('generates mm.yml with registers', () => {
      expect(result.mmYamlText).toBeTruthy();
      const doc = yaml.load(result.mmYamlText!) as AnyRecord;
      const block = (doc.addressBlocks as AnyRecord[])?.[0];
      expect((block?.registers as AnyRecord[]).length).toBeGreaterThan(0);
    });

    it('ip.yml has parameters', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const params: AnyRecord[] = doc.parameters ?? [];
      expect(params.length).toBeGreaterThan(0);
    });
  });

  // ─── axi_bram_ctrl ────────────────────────────────────────────────────────
  describe('axi_bram_ctrl (latest version)', () => {
    let result: ReturnType<typeof parseComponentXmlText>;

    beforeAll(() => {
      // Pick whichever version is present
      const xml = readComponentXml('axi_bram_ctrl_v4_1') ?? readComponentXml('axi_bram_ctrl_v4_0');
      if (!xml) {
        throw new Error('axi_bram_ctrl component.xml not found');
      }
      result = parseComponentXmlText(xml);
    });

    it('produces valid ip.yml YAML', () => {
      expect(() => yaml.load(result.ipYamlText)).not.toThrow();
    });

    it('has at least one AXI bus interface', () => {
      const doc = yaml.load(result.ipYamlText) as AnyRecord;
      const busifs: AnyRecord[] = doc.busInterfaces ?? [];
      expect(busifs.some((b) => ['AXI4L', 'AXI4F', 'AXI4S'].includes(b.type as string))).toBe(true);
    });
  });
});
