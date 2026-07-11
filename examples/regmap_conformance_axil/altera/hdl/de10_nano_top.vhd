library ieee;
use ieee.std_logic_1164.all;

--------------------------------------------------------------------------------
-- Top-level wrapper for the register access-type conformance test (AXI4-Lite
-- variant) on the DE10-Nano board. Instantiates the Platform Designer system
-- (regmap_conformance_axil_system) and ties the power-on-reset generator
-- into the system reset input. Same shape as
-- 17_ipcraft_regmap_conformance/hdl/de10_nano_top.vhd.
--------------------------------------------------------------------------------
entity de10_nano_top is
  port (
    fpga_clk1_50 : in  std_logic
  );
end entity de10_nano_top;

architecture rtl of de10_nano_top is

  component regmap_conformance_axil_system is
    port (
      clk_clk     : in  std_logic;
      reset_reset : in  std_logic
    );
  end component regmap_conformance_axil_system;

  signal power_on_reset : std_logic;

begin

  power_on_reset_generator_inst : entity work.power_on_reset_generator
    generic map (
      G_CLK_FREQ_HZ       => 50_000_000,
      G_RESET_DURATION_NS => 1_000_000
    )
    port map (
      clk_i => fpga_clk1_50,
      por_o => power_on_reset
    );

  regmap_conformance_axil_system_inst : regmap_conformance_axil_system
    port map (
      clk_clk     => fpga_clk1_50,
      reset_reset => power_on_reset
    );

end architecture rtl;
