library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use ieee.math_real.all;

entity power_on_reset_generator is
  generic (
    G_CLK_FREQ_HZ       : integer := 50000000; -- 50 MHz
    G_RESET_DURATION_NS : integer := 1000000   -- 1 ms
  );
  port (
    clk_i : in std_logic;
    por_o : out std_logic
  );
end entity power_on_reset_generator;

architecture rtl of power_on_reset_generator is
  constant C_CYCLES_COUNTER_MAX : integer := integer((real(G_CLK_FREQ_HZ) * real(G_RESET_DURATION_NS)) / real(1e9));

  signal power_on_reset : std_logic                               := '1';
  signal counter        : integer range 0 to C_CYCLES_COUNTER_MAX := 0;
begin

  por_o <= power_on_reset;

  --------------------------------------------------------------------------------
  -- POWER ON RESET GENERATION
  --------------------------------------------------------------------------------
  por_gen_proc : process (clk_i)
  begin
    if rising_edge(clk_i) then
      if counter < C_CYCLES_COUNTER_MAX then
        counter        <= counter + 1;
        power_on_reset <= '1';
      else
        power_on_reset <= '0';
      end if;
    end if;
  end process por_gen_proc;

end architecture rtl;
