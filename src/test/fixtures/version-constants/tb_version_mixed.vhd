-- Behavioral testbench for a generated register file with a constant mixed into a register that
-- also has a read-write and a hardware-driven read-only field (core version 1.4.2, scheme
-- major.minor.patch):
--   IDENT (0x00): REV [31:24] = $version.major (constant 0x01), BUSY [7:4] read-only (hardware),
--                 ENABLE [0] read-write, reset 1
-- REV must read the literal, never be written, and must not appear in regs_out / regs_in; BUSY
-- keeps reading the live regs_in.ident_val value.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.ver_core_pkg.all;

entity tb_version_mixed is
end entity;

architecture sim of tb_version_mixed is
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
  dut : entity work.ver_core_regs
    port map(clk=>clk, rst=>rst, wr_en=>wr_en, wr_addr=>wr_addr, wr_data=>wr_data,
             wr_strb=>wr_strb, rd_en=>rd_en, rd_addr=>rd_addr, rd_data=>rd_data,
             rd_valid=>rd_valid, regs_out=>regs_out, regs_in=>regs_in);

  clk <= not clk after 5 ns when not done else '0';

  stim : process
    variable errors : integer := 0;
    variable v_out  : std_logic_vector(31 downto 0);

    procedure chk(name : string; got : std_logic_vector; exp : std_logic_vector) is
    begin
      if got = exp then
        report "PASS " & name & " = 0x" & to_hstring(got);
      else
        report "FAIL " & name & " got=0x" & to_hstring(got) & " exp=0x" & to_hstring(exp) severity error;
        errors := errors + 1;
      end if;
    end procedure;

    procedure bus_write(waddr : natural; wdata : std_logic_vector(31 downto 0)) is
    begin
      wait until rising_edge(clk);
      wr_en <= '1'; wr_addr <= std_logic_vector(to_unsigned(waddr, C_ADDR_WIDTH));
      wr_data <= wdata; wr_strb <= "1111";
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
    regs_in.ident_val.busy <= (others => '0');

    wait for 33 ns;
    wait until rising_edge(clk);
    rst <= '0';

    -- Reset: REV=0x01 (constant), BUSY=0 (hardware), ENABLE=1
    bus_read(16#00#);
    chk("IDENT_RESET", rd_data, x"01000001");

    -- BUSY follows the hardware value; REV stays the constant.
    regs_in.ident_val.busy <= "1010";
    wait until rising_edge(clk);
    bus_read(16#00#);
    chk("IDENT_BUSY_LIVE", rd_data, x"010000A1");

    -- Writing every bit changes only ENABLE (here: stays 1); REV and BUSY are immune.
    bus_write(16#00#, x"FFFFFFFF");
    bus_read(16#00#);
    chk("IDENT_WRITE_ALL_ONES", rd_data, x"010000A1");

    bus_write(16#00#, x"00000000");
    bus_read(16#00#);
    chk("IDENT_WRITE_ZERO", rd_data, x"010000A0");
    v_out := (others => '0');
    v_out(0) := regs_out.ident.enable;
    chk("IDENT_REGS_OUT_ENABLE", v_out, x"00000000");

    if errors = 0 then
      report "==== VERSION_MIXED VHDL DONE: ALL PASS ====" severity note;
    else
      report "==== VERSION_MIXED VHDL DONE: " & integer'image(errors) & " FAIL ====" severity error;
    end if;
    done <= true;
    wait;
  end process;
end architecture;
