/* eslint-disable */
import * as path from 'path';
import * as fs from 'fs/promises';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { Logger } from '../../../utils/Logger';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { devResourceRoots } from '../../../services/ResourceRoots';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/BusLibraryService', () => ({
  BusLibraryService: jest.fn().mockImplementation(() => ({
    loadDefaultLibrary: jest.fn().mockResolvedValue({
      AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
    }),
    clearCache: jest.fn(),
  })),
}));

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Self-clearing (SC) access types: write-self-clearing, read-write-self-clearing.
//
// SC is the inverse of W1C: software writes 1 to set the bit (start an action);
// hardware pulses regs_in.<reg>_clear.<field>_clear to clear it (action done).
// Hardware clear has priority over a same-cycle software set.
//
// The fixture exercises both register-level SC (DMA_CTRL, TRIGGER) and a single
// field-level SC bit inside an otherwise read-write register (MIXED.KICK).
// Register-level SC is the regression case for the swAccess bug: such registers
// must still be allocated storage (regs / t_regs_sw2hw), or the generated
// arbitration would reference an undeclared signal.
// ---------------------------------------------------------------------------

const SC_IPCORE = path.resolve(__dirname, '../../fixtures/sc-ipcore.yml');

function findWritten(suffix: string): string {
  const call = (fs.writeFile as unknown as jest.Mock).mock.calls.find((c) =>
    String(c[0]).endsWith(suffix)
  );
  if (!call) {
    throw new Error(`No generated file ending in "${suffix}" was written`);
  }
  return String(call[1]);
}

describe('self-clearing access types', () => {
  const logger = new Logger('test');
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  const loader = new TemplateLoader(logger, templatesPath);
  const repoRoot = path.resolve(__dirname, '../../../..');
  const resourceRoots = devResourceRoots(repoRoot);
  let scaffolder: any;

  beforeEach(() => {
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({
        AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
      }),
      clearCache: jest.fn(),
    }));
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // VHDL
  // -------------------------------------------------------------------------
  describe('VHDL generation', () => {
    let pkg: string;
    let regs: string;

    beforeEach(async () => {
      const result = await scaffolder.generateAll(SC_IPCORE, '/tmp/sc-out', {
        includeRegs: true,
        includeTestbench: false,
        targets: [],
        ipCraftMethodology: true,
        hdlLanguage: 'vhdl',
      });
      expect(result.success).toBe(true);
      pkg = findWritten('_pkg.vhd');
      regs = findWritten('_regs.vhd');
    });

    it('generates a _clear record type for the SC register', () => {
      expect(pkg).toContain('type t_reg_dma_ctrl_clear is record');
      expect(pkg).toContain('start_clear : std_logic;');
      expect(pkg).toContain('chan_clear : std_logic_vector(3 downto 0);');
      expect(pkg).toContain('C_REG_DMA_CTRL_CLEAR_RESET');
    });

    it('exposes the _clear record on the hw2sw input record', () => {
      expect(pkg).toContain('dma_ctrl_clear : t_reg_dma_ctrl_clear');
      expect(pkg).toContain('trigger_clear : t_reg_trigger_clear');
    });

    // Regression: register-level SC registers must reach sw_registers so that
    // storage (t_regs_sw2hw / signal regs) is actually declared.
    it('allocates storage for register-level SC registers (swAccess regression)', () => {
      const sw2hw = pkg.slice(
        pkg.indexOf('type t_regs_sw2hw is record'),
        pkg.indexOf('end record', pkg.indexOf('type t_regs_sw2hw is record'))
      );
      expect(sw2hw).toContain('dma_ctrl');
      expect(sw2hw).toContain('trigger');
      expect(regs).toContain('signal regs : t_regs_sw2hw := C_REGS_SW2HW_RESET;');
    });

    it('generates SC arbitration with hardware clear taking priority over software set', () => {
      const start = regs.indexOf("if regs_in.dma_ctrl_clear.start_clear = '1' then");
      expect(start).toBeGreaterThan(-1);
      const block = regs.slice(start, start + 400);
      const clearAt = block.indexOf("regs.dma_ctrl.start <= '0';");
      const setAt = block.indexOf("regs.dma_ctrl.start <= '1';");
      expect(clearAt).toBeGreaterThan(-1);
      expect(setAt).toBeGreaterThan(-1);
      // Clear branch must come before the software-set branch.
      expect(clearAt).toBeLessThan(setAt);
    });

    it('generates a per-bit clear loop for a multi-bit SC field', () => {
      expect(regs).toContain('for i in 0 to 3 loop');
      expect(regs).toContain("if regs_in.dma_ctrl_clear.chan_clear(i) = '1' then");
      expect(regs).toContain("regs.dma_ctrl.chan(i) <= '0';");
    });

    it('keeps read-write-self-clearing registers readable', () => {
      expect(regs).toContain('to_slv(regs.dma_ctrl)');
    });

    it('does not read back a write-self-clearing register', () => {
      // TRIGGER is write-only: it must never be packed onto the read data bus.
      expect(regs).not.toContain('to_slv(regs.trigger)');
    });

    it('supports a field-level SC bit inside a read-write register', () => {
      expect(regs).toContain("if regs_in.mixed_clear.kick_clear = '1' then");
      expect(regs).toContain("regs.mixed.kick <= '0';");
    });
  });

  // -------------------------------------------------------------------------
  // SystemVerilog
  // -------------------------------------------------------------------------
  describe('SystemVerilog generation', () => {
    let pkg: string;
    let regs: string;

    beforeEach(async () => {
      const result = await scaffolder.generateAll(SC_IPCORE, '/tmp/sc-out-sv', {
        includeRegs: true,
        includeTestbench: false,
        targets: [],
        ipCraftMethodology: true,
        hdlLanguage: 'systemverilog',
      });
      expect(result.success).toBe(true);
      pkg = findWritten('_pkg.sv');
      regs = findWritten('_regs.sv');
    });

    it('generates a _clear struct type for the SC register', () => {
      expect(pkg).toContain('} dma_ctrl_clear_t;');
      expect(pkg).toContain('logic        start_clear;');
      expect(pkg).toContain('logic [3:0] chan_clear;');
    });

    it('exposes the _clear struct on the hw2sw input struct', () => {
      expect(pkg).toContain('dma_ctrl_clear_t dma_ctrl_clear;');
      expect(pkg).toContain('trigger_clear_t trigger_clear;');
    });

    it('allocates storage for register-level SC registers (swAccess regression)', () => {
      // Without the swAccess fix, register-level SC registers never reach
      // sw_registers, so neither their per-register struct type nor a struct
      // member is emitted, and the arbitration below references missing storage.
      expect(pkg).toContain('dma_ctrl_t dma_ctrl;');
      expect(pkg).toContain('trigger_t trigger;');
      expect(regs).toContain('regs_sw2hw_t regs;');
    });

    it('generates SC arbitration with hardware clear taking priority over software set', () => {
      const start = regs.indexOf('if (regs_in.dma_ctrl_clear.start_clear) begin');
      expect(start).toBeGreaterThan(-1);
      const block = regs.slice(start, start + 400);
      const clearAt = block.indexOf("regs.dma_ctrl.start <= 1'b0;");
      const setAt = block.indexOf("regs.dma_ctrl.start <= 1'b1;");
      expect(clearAt).toBeGreaterThan(-1);
      expect(setAt).toBeGreaterThan(-1);
      expect(clearAt).toBeLessThan(setAt);
    });

    it('generates a per-bit clear loop for a multi-bit SC field', () => {
      expect(regs).toContain('for (int i = 0; i < 4; i++) begin');
      expect(regs).toContain('if (regs_in.dma_ctrl_clear.chan_clear[i]) begin');
      expect(regs).toContain("regs.dma_ctrl.chan[i] <= 1'b0;");
    });
  });
});
