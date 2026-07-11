

--------------------------------------------------------------------------------
-- Entity: regmap_conformance_core
-- Description: Loopback core for the register access-type conformance IP.
--   Wires the software-writable STIMULUS register into the register file's
--   hardware-side inputs (regs_out, from this core's perspective), so every
--   hardware-dependent access-type idiom (RO live value, W1C hw-set,
--   self-clearing hw-clear, change-of-state) is triggerable and observable
--   from the bus alone -- no external stimulus, no logic analyzer.
--
--   See docs/hardware-conformance-test-plan.md (ipcraft-vscode repo),
--   "Component 2 -- the loopback core", for the wiring table this
--   implements.
--
-- Hand-written; managed: false in regmap_conformance.ip.yml so a re-scaffold
-- never overwrites this file.
--------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

use work.regmap_conformance_pkg.all;

entity regmap_conformance_core is
  port (
    -- Clock and reset
    clk : in std_logic;
    rst : in std_logic;

    -- Register interface (record-based)
    regs_in : in t_regs_sw2hw; -- SW-writable registers (from bus wrapper)
    regs_out : out t_regs_hw2sw -- HW-status / W1C pulses / CoS values (to bus wrapper)
    );
end entity regmap_conformance_core;

architecture rtl of regmap_conformance_core is

  ----------------------------------------------------------------------------
  -- Internal Signals
  ----------------------------------------------------------------------------
  -- Previous-cycle STIMULUS trigger bits, for rising-edge detection. A held
  -- STIMULUS bit therefore yields exactly one pulse per write -- deterministic,
  -- and true to how a real peripheral raises a hardware event.
  signal stimulus_prev : t_reg_stimulus := C_REG_STIMULUS_RESET;

  -- Fixed, distinct per-index constants for the CHANNEL register array's RO
  -- COUNT field. No STIMULUS dependency needed -- the test only needs to
  -- prove that reading CHANNEL[0].COUNT and CHANNEL[1].COUNT returns two
  -- different, non-aliased values.
  constant C_CHANNEL_0_COUNT : std_logic_vector(7 downto 0) := x"11";
  constant C_CHANNEL_1_COUNT : std_logic_vector(7 downto 0) := x"22";

begin

  ----------------------------------------------------------------------------
  -- Main Process
  ----------------------------------------------------------------------------
  p_main : process(clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        regs_out <= C_REGS_HW2SW_RESET;
        stimulus_prev <= C_REG_STIMULUS_RESET;
      else
        -- Constants driven every cycle (RO fields sourced live from hardware).
        regs_out.id <= C_REG_ID_RESET;
        regs_out.channel_0_count.samples <= C_CHANNEL_0_COUNT;
        regs_out.channel_1_count.samples <= C_CHANNEL_1_COUNT;

        -- STATUS: RO passthrough of STIMULUS.STATUS_VAL.
        -- Write STIMULUS -> read STATUS -> value tracks.
        regs_out.status.value <= regs_in.stimulus.status_val;

        -- WO_MIRROR: RO echo of DIAG.SCRATCH.
        -- Write DIAG (reads back 0) -> read WO_MIRROR -> confirms the
        -- write-only value reached hardware.
        regs_out.wo_mirror.scratch <= regs_in.diag.scratch;

        -- LINK.SPEED: RO passthrough of STIMULUS.LINK_SPEED. The generated
        -- register file's internal shadow register + comparator (monitorChangeOf)
        -- derives LINK.SPEED_CHANGED from this value automatically -- the core
        -- only needs to drive the monitored value itself.
        regs_out.link_val.speed <= regs_in.stimulus.link_speed;

        -- INT_STATUS: W1C hw-set pulses on a rising edge of the matching
        -- STIMULUS trigger bit. HW-set beats a simultaneous SW-clear on the
        -- ground-truth register file (register_file.vhdl.j2).
        regs_out.int_status_pulse.sample_evt_pulse <=
          regs_in.stimulus.sample_evt_trig and not stimulus_prev.sample_evt_trig;
        regs_out.int_status_pulse.error_evt_pulse <=
          regs_in.stimulus.error_evt_trig and not stimulus_prev.error_evt_trig;

        -- IRQ_LEGACY: plain (non-readable) W1C, same hw-set pulse idiom.
        regs_out.irq_legacy_pulse.flag_pulse <=
          regs_in.stimulus.legacy_trig and not stimulus_prev.legacy_trig;

        -- COMMAND: write-self-clearing. SW writes START=1; a rising edge on
        -- STIMULUS.CMD_DONE_TRIG pulses the hw-clear (self-clear beats a
        -- lingering SW set).
        regs_out.command_clear.start_clear <=
          regs_in.stimulus.cmd_done_trig and not stimulus_prev.cmd_done_trig;

        -- BUSY: read-write-self-clearing -- same idiom, but readable while set.
        regs_out.busy_clear.active_clear <=
          regs_in.stimulus.busy_done_trig and not stimulus_prev.busy_done_trig;

        -- Latch this cycle's STIMULUS for next cycle's edge detection.
        stimulus_prev <= regs_in.stimulus;
      end if;
    end if;
  end process;

end architecture rtl;
