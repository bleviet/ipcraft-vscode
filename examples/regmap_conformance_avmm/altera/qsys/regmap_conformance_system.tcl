package require -exact qsys 12.0

# ---------------------------------------------------------------------------
# Register access-type conformance system for DE10-Nano (Cyclone V 5CSEBA6U23I7)
# -- Variant A (Avalon-MM) of docs/hardware-conformance-test-plan.md
# (ipcraft-vscode repo), "Component 4 -- the standard test FPGA design".
#
# Components: Nios II/e CPU, 32 KB on-chip memory, JTAG UART, System ID,
#             regmap_conformance (IPCraft-generated Avalon-MM conformance IP,
#             qsys/regmap_conformance_hw.tcl -> ../altera/regmap_conformance_hw.tcl),
#             and a JTAG-to-Avalon-MM debug master.
#
# Nios II and the JTAG-to-Avalon-MM debug master are combined in ONE system
# (not two separate .sof's) -- the approach 16_ipcraft_led_avmm's debug
# variant (qsys/led_avmm_system_debug.tcl) proved on hardware: Platform
# Designer's interconnect automatically arbitrates between the two masters.
# This resolves the plan's "Nios II + JTAG master: one system vs. two" open
# item in favor of one system.
#
# The Nios II C self-test (software/app/main.c) and the System Console Tcl
# host (debug/conformance_sysconsole.tcl) both run against this same system,
# without needing separate bitstreams.
# ---------------------------------------------------------------------------

create_system regmap_conformance_system
set_project_property DEVICE_FAMILY {Cyclone V}
set_project_property DEVICE {5CSEBA6U23I7}

# ── Clock bridge (50 MHz from top-level) ─────────────────────────────────────
add_instance clk_0 altera_clock_bridge
set_instance_parameter_value clk_0 NUM_CLOCK_OUTPUTS 1

# ── Reset bridge (active-high synchronous reset) ──────────────────────────────
add_instance reset_bridge altera_reset_bridge
set_instance_parameter_value reset_bridge NUM_RESET_OUTPUTS {1}
set_instance_parameter_value reset_bridge ACTIVE_LOW_RESET {0}

# ── Nios II/e (tiny) CPU ──────────────────────────────────────────────────────
add_instance nios2 altera_nios2_gen2
set_instance_parameter_value nios2 impl {Tiny}
set_instance_parameter_value nios2 setting_preciseIllegalMemAccessException {0}

# ── On-chip memory: 32 KB (instruction + data) ───────────────────────────────
add_instance onchip_mem altera_avalon_onchip_memory2
set_instance_parameter_value onchip_mem memorySize {32768}
set_instance_parameter_value onchip_mem dataWidth {32}
set_instance_parameter_value onchip_mem singleClockOperation {1}

# ── JTAG UART ─────────────────────────────────────────────────────────────────
add_instance jtag_uart altera_avalon_jtag_uart

# ── System ID ─────────────────────────────────────────────────────────────────
add_instance sysid altera_avalon_sysid_qsys

# ── Register access-type conformance IP (IPCraft-generated Avalon-MM slave) ──
add_instance regmap_ctrl regmap_conformance

# ── JTAG-to-Avalon-MM debug master (System Console register access) ──────────
# Exposes the Avalon-MM fabric to System Console via JTAG, enabling register
# peek/poke without a Nios II firmware download -- the "install-free" path
# (docs/hardware-conformance-test-plan.md, "Component 3", System Console host).
add_instance jtag_debug_master altera_jtag_avalon_master

# ── Clock connections ─────────────────────────────────────────────────────────
add_connection clk_0.out_clk reset_bridge.clk
add_connection clk_0.out_clk nios2.clk
add_connection clk_0.out_clk onchip_mem.clk1
add_connection clk_0.out_clk jtag_uart.clk
add_connection clk_0.out_clk sysid.clk
add_connection clk_0.out_clk regmap_ctrl.clk
add_connection clk_0.out_clk jtag_debug_master.clk

# ── Reset connections ─────────────────────────────────────────────────────────
add_connection reset_bridge.out_reset nios2.reset
add_connection reset_bridge.out_reset onchip_mem.reset1
add_connection reset_bridge.out_reset jtag_uart.reset
add_connection reset_bridge.out_reset sysid.reset
add_connection reset_bridge.out_reset regmap_ctrl.reset
add_connection reset_bridge.out_reset jtag_debug_master.clk_reset

# ── Avalon-MM data bus ────────────────────────────────────────────────────────
# Both Nios II and the JTAG debug master reach every slave; Platform Designer
# inserts an arbitration interconnect automatically.
add_connection nios2.data_master        onchip_mem.s1
add_connection nios2.data_master        jtag_uart.avalon_jtag_slave
add_connection nios2.data_master        sysid.control_slave
add_connection nios2.data_master        regmap_ctrl.S_AVMM
add_connection nios2.data_master        nios2.debug_mem_slave

add_connection jtag_debug_master.master onchip_mem.s1
add_connection jtag_debug_master.master sysid.control_slave
add_connection jtag_debug_master.master regmap_ctrl.S_AVMM

# ── Avalon-MM instruction bus ─────────────────────────────────────────────────
add_connection nios2.instruction_master onchip_mem.s1
add_connection nios2.instruction_master nios2.debug_mem_slave

# ── IRQ: nios2.irq is the master (receiver), peripherals are senders ──────────
add_connection nios2.irq jtag_uart.irq
set_connection_parameter_value nios2.irq/jtag_uart.irq irqNumber {0}

# ── Base address map ──────────────────────────────────────────────────────────
# regmap_conformance base is 0x00010000 -- both masters use the same absolute
# address for a given register (nios2.data_master's C_REG_*_ADDR offsets in
# software/app/main.c, and debug/conformance_sysconsole.tcl's
# master_read_32/master_write_32 base + offset).
set_connection_parameter_value nios2.data_master/onchip_mem.s1                  baseAddress {0x00000000}
set_connection_parameter_value nios2.instruction_master/onchip_mem.s1           baseAddress {0x00000000}
set_connection_parameter_value nios2.data_master/regmap_ctrl.S_AVMM      baseAddress {0x00010000}
set_connection_parameter_value jtag_debug_master.master/regmap_ctrl.S_AVMM baseAddress {0x00010000}
set_connection_parameter_value nios2.data_master/jtag_uart.avalon_jtag_slave    baseAddress {0x00010100}
set_connection_parameter_value nios2.data_master/sysid.control_slave            baseAddress {0x00010108}
set_connection_parameter_value jtag_debug_master.master/sysid.control_slave     baseAddress {0x00010108}
set_connection_parameter_value nios2.data_master/nios2.debug_mem_slave          baseAddress {0x00010800}
set_connection_parameter_value nios2.instruction_master/nios2.debug_mem_slave   baseAddress {0x00010800}

# ── Reset / exception vectors (both in on-chip RAM) ──────────────────────────
set_instance_parameter_value nios2 resetSlave      {onchip_mem.s1}
set_instance_parameter_value nios2 resetOffset     {0x00000000}
set_instance_parameter_value nios2 exceptionSlave  {onchip_mem.s1}
set_instance_parameter_value nios2 exceptionOffset {0x00000020}

# ── Top-level port exports ────────────────────────────────────────────────────
add_interface clk clock sink
set_interface_property clk EXPORT_OF clk_0.in_clk

add_interface reset reset sink
set_interface_property reset EXPORT_OF reset_bridge.in_reset

save_system regmap_conformance_system.qsys
puts "regmap_conformance_system.qsys saved (Nios II + JTAG-to-Avalon-MM debug master)"
