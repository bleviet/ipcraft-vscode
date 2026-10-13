-- Behavioral testbench for a generated register file whose VERSION register is built from
-- `$version` constants (core version 1.4.2, scheme major.minor.patch -> 0x010402).
-- Used for two designs that share the entity name `ver_core`:
--   * VERSION made of the fields MAJOR/MINOR/PATCH (all constant), and
--   * a fieldless register-level `resetValue: $version`.
-- Both must read the literal through the bus, ignore every write, and leave the
-- neighbouring read-write CTRL register working. The constant is not a regs_in
-- member (the design has no regs_in port at all) and not part of regs_out.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.ver_core_pkg.all;

entity tb_version_const is
end entity;

architecture sim of tb_version_const is
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
  signal done     : boolean := false;
begin
  dut : entity work.ver_core_regs
    port map(clk=>clk, rst=>rst, wr_en=>wr_en, wr_addr=>wr_addr, wr_data=>wr_data,
             wr_strb=>wr_strb, rd_en=>rd_en, rd_addr=>rd_addr, rd_data=>rd_data,
             rd_valid=>rd_valid, regs_out=>regs_out);

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
    wait for 33 ns;
    wait until rising_edge(clk);
    rst <= '0';

    bus_read(16#00#);
    chk("VERSION_READ", rd_data, x"00010402");

    bus_write(16#00#, x"FFFFFFFF");
    bus_read(16#00#);
    chk("VERSION_WRITE_IGNORED", rd_data, x"00010402");

    bus_write(16#00#, x"00000000");
    bus_read(16#00#);
    chk("VERSION_WRITE_ZERO_IGNORED", rd_data, x"00010402");

    -- The neighbouring read-write register still works.
    bus_write(16#04#, x"00000001");
    bus_read(16#04#);
    chk("CTRL_RW", rd_data, x"00000001");
    v_out := (others => '0');
    v_out(0) := regs_out.ctrl.en;
    chk("CTRL_REGS_OUT", v_out, x"00000001");

    bus_read(16#00#);
    chk("VERSION_AFTER_CTRL_WRITE", rd_data, x"00010402");

    if errors = 0 then
      report "==== VERSION_CONST VHDL DONE: ALL PASS ====" severity note;
    else
      report "==== VERSION_CONST VHDL DONE: " & integer'image(errors) & " FAIL ====" severity error;
    end if;
    done <= true;
    wait;
  end process;
end architecture;
