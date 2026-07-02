-- Behavioral testbench for the generated daq_controller_regs register file.
--
-- Drives the standalone _regs module (no bus wrapper) directly and checks,
-- by simulation, every access-type idiom documented in
-- docs/tutorials/memory-mapped-registers.md: reset values, RW read/write,
-- partial byte-strobe writes, RO status, W1C set/clear with same-cycle
-- hardware-priority arbitration, self-clearing set/clear, and register-array
-- addressing. Driven by src/test/integration/register-semantics.test.ts.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.daq_controller_pkg.all;

entity tb_daq_regs is
end entity;

architecture sim of tb_daq_regs is
  signal clk      : std_logic := '0';
  signal rst      : std_logic := '1';
  signal wr_en    : std_logic := '0';
  signal wr_addr  : std_logic_vector(C_ADDR_WIDTH-1 downto 0) := (others => '0');
  signal wr_data  : std_logic_vector(31 downto 0) := (others => '0');
  signal wr_strb  : std_logic_vector(3 downto 0) := (others => '0');
  signal rd_en    : std_logic := '0';
  signal rd_addr  : std_logic_vector(C_ADDR_WIDTH-1 downto 0) := (others => '0');
  signal rd_data  : std_logic_vector(31 downto 0);
  signal rd_valid : std_logic;
  signal regs_out : t_regs_sw2hw;
  signal regs_in  : t_regs_hw2sw;
  signal done     : boolean := false;
begin
  dut : entity work.daq_controller_regs
    port map(clk=>clk, rst=>rst, wr_en=>wr_en, wr_addr=>wr_addr, wr_data=>wr_data,
             wr_strb=>wr_strb, rd_en=>rd_en, rd_addr=>rd_addr, rd_data=>rd_data,
             rd_valid=>rd_valid, regs_out=>regs_out, regs_in=>regs_in);

  clk <= not clk after 5 ns when not done else '0';

  stim : process
    variable errors : integer := 0;

    procedure chk(name : string; got : std_logic_vector; exp : std_logic_vector) is
    begin
      if got = exp then
        report "PASS " & name & " = 0x" & to_hstring(got);
      else
        report "FAIL " & name & " got=0x" & to_hstring(got) & " exp=0x" & to_hstring(exp) severity error;
        errors := errors + 1;
      end if;
    end procedure;

    procedure bus_write(waddr : natural; wdata : std_logic_vector(31 downto 0); strb : std_logic_vector(3 downto 0) := "1111") is
    begin
      wait until rising_edge(clk);
      wr_en <= '1'; wr_addr <= std_logic_vector(to_unsigned(waddr, C_ADDR_WIDTH));
      wr_data <= wdata; wr_strb <= strb;
      wait until rising_edge(clk);
      wr_en <= '0'; wr_data <= (others=>'0'); wr_strb <= "0000";
    end procedure;

    procedure bus_read(raddr : natural) is
    begin
      wait until rising_edge(clk);
      rd_en <= '1'; rd_addr <= std_logic_vector(to_unsigned(raddr, C_ADDR_WIDTH));
      wait until rising_edge(clk);
      rd_en <= '0';
      wait for 1 ns;
    end procedure;
  begin
    regs_in.status.ready <= '0';
    regs_in.status.running <= '0';
    regs_in.status.fifo_level <= (others=>'0');
    regs_in.int_status_pulse.sample_done_pulse <= '0';
    regs_in.int_status_pulse.overflow_pulse <= '0';
    regs_in.int_status_pulse.error_pulse <= '0';
    regs_in.command_clear.start_clear <= '0';
    regs_in.command_clear.stop_clear <= '0';
    regs_in.command_clear.fifo_reset_clear <= '0';
    regs_in.channel_0_flags_pulse.triggered_pulse <= '0';
    regs_in.channel_1_flags_pulse.triggered_pulse <= '0';
    regs_in.channel_2_flags_pulse.triggered_pulse <= '0';
    regs_in.channel_3_flags_pulse.triggered_pulse <= '0';
    regs_in.channel_0_count.samples <= (others=>'0');
    regs_in.channel_1_count.samples <= (others=>'0');
    regs_in.channel_2_count.samples <= (others=>'0');
    regs_in.channel_3_count.samples <= (others=>'0');
    regs_in.link_status_val.speed <= (others=>'0');
    regs_in.irq_legacy_pulse.legacy_irq_clr_pulse <= '0';
    regs_in.busy_status_clear.busy_clear <= '0';

    wait for 33 ns;
    wait until rising_edge(clk);
    rst <= '0';

    -- CONTROL reset value: enable=0, mode=1 (bits[2:1]), irq_en=0, prescaler=4 (bits[15:8])
    -- => bit1=1 (mode LSB), bit10=1 (prescaler bit2) => 0x0000_0402
    bus_read(16#00#);
    chk("CONTROL_RESET", rd_data, x"00000402");

    -- RW read/write round trip
    bus_write(16#00#, x"0000FF07");
    bus_read(16#00#);
    chk("CONTROL_RW", rd_data, x"0000FF07");

    -- Partial byte-strobe write: only byte1 (prescaler bits[15:8]) changes to 0x22
    bus_write(16#00#, x"00002200", "0010");
    bus_read(16#00#);
    chk("CONTROL_PARTIAL_STRB", rd_data, x"00002207");

    -- RO STATUS driven by hardware
    regs_in.status.ready <= '1';
    regs_in.status.fifo_level <= x"05";
    wait until rising_edge(clk);
    bus_read(16#04#);
    chk("STATUS_RO", rd_data, x"00000501");

    -- W1C INT_STATUS: hw sets ERROR via pulse, sw clears by writing 1
    regs_in.int_status_pulse.error_pulse <= '1';
    wait until rising_edge(clk);
    regs_in.int_status_pulse.error_pulse <= '0';
    wait for 1 ns;
    chk("W1C_hw_set", "0000000" & regs_out.int_status.error, "00000001");
    bus_read(16#08#);
    chk("W1C_read_sticky", rd_data, x"00000004");
    bus_write(16#08#, x"00000004");
    wait for 1 ns;
    chk("W1C_sw_cleared", "0000000" & regs_out.int_status.error, "00000000");

    -- W1C same-cycle arbitration: hardware set beats a concurrent CPU clear-write
    wait until rising_edge(clk);
    wr_en <= '1'; wr_addr <= std_logic_vector(to_unsigned(16#08#, C_ADDR_WIDTH));
    wr_data <= x"00000004"; wr_strb <= "1111";
    regs_in.int_status_pulse.error_pulse <= '1';
    wait until rising_edge(clk);
    wr_en <= '0'; wr_data <= (others=>'0'); wr_strb <= "0000";
    regs_in.int_status_pulse.error_pulse <= '0';
    wait for 1 ns;
    chk("W1C_hw_priority_over_swclear", "0000000" & regs_out.int_status.error, "00000001");
    bus_write(16#08#, x"00000004"); -- clean up

    -- Self-clearing COMMAND: sw sets START by writing 1, hw clears via *_clear pulse.
    -- COMMAND is write-self-clearing (not readable) -- distinguish from BUSY_STATUS below.
    bus_write(16#0C#, x"00000001");
    wait for 1 ns;
    chk("SC_sw_set", "0000000" & regs_out.command.start, "00000001");
    bus_read(16#0C#);
    chk("SC_read_is0(not readable)", rd_data, x"00000000");
    regs_in.command_clear.start_clear <= '1';
    wait until rising_edge(clk);
    regs_in.command_clear.start_clear <= '0';
    wait for 1 ns;
    chk("SC_hw_cleared", "0000000" & regs_out.command.start, "00000000");

    -- Register array addressing: channel 0/1/2/3 CONFIG must not alias each other
    bus_write(16#10#, x"00000A01"); -- CHANNEL_0.CONFIG: gain=1, offset=0x0A
    bus_write(16#20#, x"00001402"); -- CHANNEL_1.CONFIG: gain=2, offset=0x14
    bus_write(16#34#, x"00001234"); -- CHANNEL_2.THRESHOLD
    bus_read(16#10#);
    chk("ARRAY_CH0_CONFIG", rd_data, x"00000A01");
    bus_read(16#20#);
    chk("ARRAY_CH1_CONFIG", rd_data, x"00001402");
    bus_read(16#34#);
    chk("ARRAY_CH2_THRESHOLD", rd_data, x"00001234");
    -- CHANNEL_3 must still read its reset value (untouched)
    bus_read(16#40#);
    chk("ARRAY_CH3_CONFIG_UNTOUCHED", rd_data, x"00000000");

    -- Change-of-state: LINK_STATUS.SPEED_CHANGED auto-sets when SPEED changes,
    -- with no external pulse port -- the generator builds an internal shadow
    -- register + comparator. The shadow register has no explicit synchronous
    -- reset (ipcraft-vscode#33); VHDL's shadow happens to initialize to 0 in
    -- simulation (unlike SystemVerilog's, which powers up unknown), so this
    -- defensive clear is a harmless no-op here -- kept for symmetry with the
    -- SV testbench, which genuinely needs it.
    bus_write(16#50#, x"00000100");
    bus_read(16#50#);
    chk("COS_initial", rd_data, x"00000000");
    regs_in.link_status_val.speed <= "0101"; -- change SPEED from 0 to 5
    wait until rising_edge(clk);
    wait for 1 ns;
    bus_read(16#50#);
    chk("COS_auto_set", rd_data, x"00000105"); -- SPEED=5, SPEED_CHANGED=1
    bus_write(16#50#, x"00000100"); -- write 1 to clear SPEED_CHANGED (bit 8)
    bus_read(16#50#);
    chk("COS_cleared", rd_data, x"00000005"); -- SPEED still 5, flag cleared

    -- Write-only DIAG.SCRATCH: stores the value for hardware, reads back as 0
    bus_write(16#54#, x"000000AB");
    wait for 1 ns;
    chk("WO_regs_out", "00000000" & regs_out.diag.scratch, "0000000010101011");
    bus_read(16#54#);
    chk("WO_read_is0", rd_data, x"00000000");

    -- Plain write-1-to-clear IRQ_LEGACY (not readable, unlike INT_STATUS's RW1C)
    regs_in.irq_legacy_pulse.legacy_irq_clr_pulse <= '1';
    wait until rising_edge(clk);
    regs_in.irq_legacy_pulse.legacy_irq_clr_pulse <= '0';
    wait for 1 ns;
    chk("W1C_plain_hw_set", "0000000" & regs_out.irq_legacy.legacy_irq_clr, "00000001");
    bus_read(16#58#);
    chk("W1C_plain_read_is0(not readable)", rd_data, x"00000000");
    bus_write(16#58#, x"00000001");
    wait for 1 ns;
    chk("W1C_plain_sw_cleared", "0000000" & regs_out.irq_legacy.legacy_irq_clr, "00000000");

    -- Readable self-clearing BUSY_STATUS: sw sets, hw clears, readable while set
    bus_write(16#5C#, x"00000001");
    wait for 1 ns;
    chk("RWSC_sw_set", "0000000" & regs_out.busy_status.busy, "00000001");
    bus_read(16#5C#);
    chk("RWSC_read_while_set", rd_data, x"00000001");
    regs_in.busy_status_clear.busy_clear <= '1';
    wait until rising_edge(clk);
    regs_in.busy_status_clear.busy_clear <= '0';
    wait for 1 ns;
    chk("RWSC_hw_cleared", "0000000" & regs_out.busy_status.busy, "00000000");
    bus_read(16#5C#);
    chk("RWSC_read_after_clear", rd_data, x"00000000");

    if errors = 0 then
      report "==== DAQ VHDL DONE: ALL PASS ====" severity note;
    else
      report "==== DAQ VHDL DONE: " & integer'image(errors) & " FAIL ====" severity error;
    end if;
    done <= true;
    wait;
  end process;
end architecture;
