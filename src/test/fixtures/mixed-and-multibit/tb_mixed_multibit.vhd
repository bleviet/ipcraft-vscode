-- Behavioral testbench for the generated mixed_and_multibit_regs register file.
--
-- Regression coverage for:
--   - ipcraft-vscode#31: multi-bit W1C (EVENTS.FLAGS), multi-bit SC (CMD.TRIGGERS)
--     and multi-bit CoS (WATCH.CHANGED monitoring WATCH.VAL) fields must behave
--     correctly under the whole-field masked-assignment rewrite (previously a
--     variable-indexed loop that only mattered for SystemVerilog/Icarus, but
--     VHDL is checked here too so both languages share one behavioral contract).
--   - ipcraft-vscode#32 item 2: CTRL_STATUS.BUSY is a read-only field mixed into
--     an otherwise read-write register with NO monitorChangeOf -- it must read
--     the live regs_in value, not a frozen reset value, and must be immune to
--     software writes targeting its bit range.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.mixed_and_multibit_pkg.all;

entity tb_mixed_multibit is
end entity;

architecture sim of tb_mixed_multibit is
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
  dut : entity work.mixed_and_multibit_regs
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
    regs_in.ctrl_status_val.busy <= (others => '0');
    regs_in.events_pulse.flags_pulse <= (others => '0');
    regs_in.cmd_clear.triggers_clear <= (others => '0');
    regs_in.watch_val.val <= (others => '0');

    wait for 33 ns;
    wait until rising_edge(clk);
    rst <= '0';

    -- CTRL_STATUS reset: EN=1, BUSY=0 (hardware-driven, currently 0)
    bus_read(16#00#);
    chk("CTRL_RESET", rd_data, x"00000001");

    -- BUSY is hardware-driven and multi-bit: mixed register, no monitorChangeOf
    -- (ipcraft-vscode#32 item 2 regression)
    regs_in.ctrl_status_val.busy <= "1011";
    wait until rising_edge(clk);
    bus_read(16#00#);
    chk("CTRL_BUSY_LIVE", rd_data, x"0000002D"); -- EN=1, BUSY=1011 at bits[5:2] -> 0x2D

    -- A software write targeting the BUSY bit range must not corrupt the
    -- hardware-driven read value: BUSY has no write path at all (RO), so this
    -- write can only affect EN.
    bus_write(16#00#, x"0000003F");
    bus_read(16#00#);
    chk("CTRL_BUSY_IMMUNE_TO_WRITE", rd_data, x"0000002D"); -- EN=1 (unchanged), BUSY still 1011, bit1 is unmapped (always reads 0)

    -- Multi-bit W1C: EVENTS.FLAGS. Hardware pulses bits 1 and 3.
    regs_in.events_pulse.flags_pulse <= "1010";
    wait until rising_edge(clk); -- shadow/port settle
    wait until rising_edge(clk); -- DUT samples pulse -> sets sticky bits
    regs_in.events_pulse.flags_pulse <= "0000";
    wait for 1 ns;
    chk("W1C_multibit_hw_set", std_logic_vector(resize(unsigned(regs_out.events.flags), 32)), x"0000000A");
    bus_read(16#04#);
    chk("W1C_multibit_read_sticky", rd_data, x"0000000A");

    -- Software write-1-to-clear on bits 1 and 3 only.
    bus_write(16#04#, x"0000000A");
    wait for 1 ns;
    chk("W1C_multibit_sw_cleared", std_logic_vector(resize(unsigned(regs_out.events.flags), 32)), x"00000000");

    -- Same-cycle hardware-set-vs-software-clear arbitration on a multi-bit field:
    -- hardware wins.
    regs_in.events_pulse.flags_pulse <= "0001";
    wait until rising_edge(clk); -- shadow commits, DUT hasn't sampled yet
    wr_en <= '1'; wr_addr <= std_logic_vector(to_unsigned(16#04#, C_ADDR_WIDTH));
    wr_data <= x"00000001"; wr_strb <= "1111";
    wait until rising_edge(clk); -- DUT samples pulse=1 AND a same-cycle sw clear; hw wins
    wr_en <= '0'; wr_data <= (others=>'0'); wr_strb <= "0000";
    regs_in.events_pulse.flags_pulse <= "0000";
    wait for 1 ns;
    chk("W1C_multibit_hw_priority", std_logic_vector(resize(unsigned(regs_out.events.flags), 32)), x"00000001");
    bus_write(16#04#, x"0000000F"); -- clean up

    -- Multi-bit SC: CMD.TRIGGERS. Software sets bits 0 and 2.
    bus_write(16#08#, x"00000005");
    wait for 1 ns;
    chk("SC_multibit_sw_set", std_logic_vector(resize(unsigned(regs_out.cmd.triggers), 32)), x"00000005");
    bus_read(16#08#);
    chk("SC_multibit_read_while_set", rd_data, x"00000005"); -- read-write-self-clearing is readable

    -- Hardware clears only bit 0.
    regs_in.cmd_clear.triggers_clear <= "0001";
    wait until rising_edge(clk);
    wait until rising_edge(clk);
    regs_in.cmd_clear.triggers_clear <= "0000";
    wait for 1 ns;
    chk("SC_multibit_hw_partial_clear", std_logic_vector(resize(unsigned(regs_out.cmd.triggers), 32)), x"00000004");

    -- Multi-bit CoS: WATCH.VAL monitored by WATCH.CHANGED (4-bit sticky flag,
    -- replicated across the width when the comparator fires). The shadow
    -- register's explicit synchronous reset (ipcraft-vscode#33) means the
    -- first post-reset read must show no spurious change-of-state event, even
    -- with a multi-bit monitored value/flag.
    bus_read(16#0C#);
    chk("COS_multibit_initial", rd_data, x"00000000");

    regs_in.watch_val.val <= "1101"; -- change VAL from 0 to 0xD
    wait until rising_edge(clk); -- shadow commits
    wait until rising_edge(clk); -- DUT's CoS comparator sees the mismatch
    wait for 1 ns;
    bus_read(16#0C#);
    chk("COS_multibit_auto_set", rd_data, x"000000FD"); -- VAL=0xD, CHANGED=0xF (all bits set)

    -- Partial write-1-to-clear on CHANGED (bits 5:4 only).
    bus_write(16#0C#, x"00000030");
    bus_read(16#0C#);
    chk("COS_multibit_partial_clear", rd_data, x"000000CD"); -- VAL=0xD, CHANGED=0xC (bits 7:6 remain)

    if errors = 0 then
      report "==== MIXED_MULTIBIT VHDL DONE: ALL PASS ====" severity note;
    else
      report "==== MIXED_MULTIBIT VHDL DONE: " & integer'image(errors) & " FAIL ====" severity error;
    end if;
    done <= true;
    wait;
  end process;
end architecture;
