library ieee;
use ieee.std_logic_1164.all;

--------------------------------------------------------------------------------
-- Top-level wrapper for the register access-type conformance test (AXI4-Lite
-- variant) on the DE10-Nano board. Instantiates the Platform Designer system
-- (regmap_conformance_axil_system) and ties the power-on-reset generator
-- into the system reset input. Same shape as
-- regmap_conformance_avmm/hdl/de10_nano_top.vhd.
--
-- `led` is exported straight from the generated regmap_conformance_axil IP's
-- own `led` port (see regmap_conformance_axil.ip.yml `ports:` and
-- regmap_conformance_axil_core.vhd): led(6 downto 0) is a steady binary
-- readout of TEST_PROGRESS.COUNT -- always lit, not blinked -- so a human
-- watching the board sees the JTAG-to-Avalon host runner's live per-check
-- progress directly, and led(7) is a dedicated status LED that blinks
-- slowly while the suite runs and faster (frozen alongside the counter) the
-- moment a check fails -- direct visual proof this exact bitstream is
-- loaded and executing the conformance suite, not just a JSON file claiming
-- success after the fact.
--------------------------------------------------------------------------------
entity de10_nano_top is
  port (
    fpga_clk1_50 : in  std_logic;
    led          : out std_logic_vector(7 downto 0)
  );
end entity de10_nano_top;

architecture rtl of de10_nano_top is

  component regmap_conformance_axil_system is
    port (
      clk_clk                     : in  std_logic;
      led_external_connection_led : out std_logic_vector(7 downto 0);
      reset_reset                 : in  std_logic
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
      clk_clk                     => fpga_clk1_50,
      reset_reset                 => power_on_reset,
      led_external_connection_led => led
    );

end architecture rtl;
