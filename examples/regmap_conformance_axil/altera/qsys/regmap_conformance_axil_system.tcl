package require -exact qsys 12.0

# ---------------------------------------------------------------------------
# Register access-type conformance system for DE10-Nano (Cyclone V 5CSEBA6U23I7)
# -- Variant B (AXI4-Lite) of docs/hardware-conformance-test-plan.md
# (ipcraft-vscode repo), "Component 4 -- the standard test FPGA design".
#
# Minimal FPGA-fabric-only system: a JTAG-to-Avalon-MM debug master connected
# directly to the AXI4-Lite conformance IP's S_AXI_LITE slave interface.
# Platform Designer auto-inserts the Avalon-MM<->AXI4 protocol bridge when an
# Avalon-MM master connects to an AXI4 slave -- no HPS, no Nios II, no
# hand-written bridge component needed. System Console then drives the same
# master_read_32/master_write_32 register-access pattern already proven on
# 17_ipcraft_regmap_conformance (Variant A).
# ---------------------------------------------------------------------------

create_system regmap_conformance_axil_system
set_project_property DEVICE_FAMILY {Cyclone V}
set_project_property DEVICE {5CSEBA6U23I7}

# ── Clock bridge (50 MHz from top-level) ─────────────────────────────────────
add_instance clk_0 altera_clock_bridge
set_instance_parameter_value clk_0 NUM_CLOCK_OUTPUTS 1

# ── Reset bridge (active-high input, matching power_on_reset_generator) ──────
# Platform Designer auto-converts polarity per consumer -- regmap_axil.reset_n
# is active-low, jtag_debug_master.clk_reset is active-high; the interconnect
# inserts the inversion itself, same as the Avalon-MM system (17_ipcraft_regmap_conformance).
add_instance reset_bridge altera_reset_bridge
set_instance_parameter_value reset_bridge NUM_RESET_OUTPUTS {1}
set_instance_parameter_value reset_bridge ACTIVE_LOW_RESET {0}

# ── Register access-type conformance IP (IPCraft-generated AXI4-Lite slave) ──
add_instance regmap_axil regmap_conformance_axil

# ── JTAG-to-Avalon-MM debug master (System Console register access) ──────────
add_instance jtag_debug_master altera_jtag_avalon_master

# ── Clock connections ─────────────────────────────────────────────────────────
add_connection clk_0.out_clk reset_bridge.clk
add_connection clk_0.out_clk regmap_axil.clk
add_connection clk_0.out_clk jtag_debug_master.clk

# ── Reset connections ─────────────────────────────────────────────────────────
add_connection reset_bridge.out_reset regmap_axil.reset_n
add_connection reset_bridge.out_reset jtag_debug_master.clk_reset

# ── Avalon-MM master -> AXI4-Lite slave (Platform Designer auto-bridges) ─────
add_connection jtag_debug_master.master regmap_axil.S_AXI_LITE

# ── Base address map ──────────────────────────────────────────────────────────
set_connection_parameter_value jtag_debug_master.master/regmap_axil.S_AXI_LITE baseAddress {0x00000000}

# ── Top-level port exports ────────────────────────────────────────────────────
add_interface clk clock sink
set_interface_property clk EXPORT_OF clk_0.in_clk

add_interface reset reset sink
set_interface_property reset EXPORT_OF reset_bridge.in_reset

save_system regmap_conformance_axil_system.qsys
puts "regmap_conformance_axil_system.qsys saved (JTAG-to-Avalon-MM master -> AXI4-Lite slave)"
