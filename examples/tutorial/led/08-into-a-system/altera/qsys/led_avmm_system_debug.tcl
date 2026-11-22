package require -exact qsys 12.0

# ---------------------------------------------------------------------------
# Nios V LED demo system for DE10-Nano -- DEBUG variant with a JTAG-to-Avalon-MM
# master for System Console register peek/poke.
#
# Identical to led_avmm_system.tcl, but adds:
#   - altera_jtag_avalon_master ("jtag_debug_master") as a second Avalon-MM
#     master connected to led_ctrl.S_AVMM, enabling System Console to read/
#     write the LED controller registers directly over JTAG, with or without
#     a Nios V firmware download.
#
# Run this script with the altera/ folder (the parent of this folder) on the
# IP search path, since that is where IPCraft writes
# led_controller_avmm_hw.tcl. Where the project has a Makefile (altera/quartus),
# make debug-qsys does this for you.
#
# The base address of led_ctrl is 0x00010010, so System Console
# master_read_32/master_write_32 calls must use that base + the register
# offset from led_controller_avmm.mm.yml:
#   0x00010010 + 0x00 = VERSION
#   0x00010010 + 0x04 = LED_PATTERN
#   0x00010010 + 0x08 = EVENTS
#
# Build: make debug-build  (runs debug-qsys, which uses this script instead of the base one)
# ---------------------------------------------------------------------------

create_system led_avmm_system
set_project_property DEVICE_FAMILY {Cyclone V}
set_project_property DEVICE {5CSEBA6U23I7}

# ── Clock bridge (50 MHz from top-level) ─────────────────────────────────────
add_instance clk_0 altera_clock_bridge
set_instance_parameter_value clk_0 NUM_CLOCK_OUTPUTS 1
set_instance_parameter_value clk_0 EXPLICIT_CLOCK_RATE {50000000}

# ── Reset bridge (active-high synchronous reset) ──────────────────────────────
add_instance reset_bridge altera_reset_bridge
set_instance_parameter_value reset_bridge NUM_RESET_OUTPUTS {1}
set_instance_parameter_value reset_bridge ACTIVE_LOW_RESET {0}

# ── Nios V/m CPU ──────────────────────────────────────────────────────────────
add_instance niosv intel_niosv_m
set_instance_parameter_value niosv enableAvalonInterface {1}
set_instance_parameter_value niosv enableDebug {1}

# ── On-chip memory: 48 KB (instruction + data) ───────────────────────────────
add_instance onchip_mem altera_avalon_onchip_memory2
set_instance_parameter_value onchip_mem memorySize {49152}
set_instance_parameter_value onchip_mem dataWidth {32}
set_instance_parameter_value onchip_mem singleClockOperation {1}

# ── JTAG UART ─────────────────────────────────────────────────────────────────
add_instance jtag_uart altera_avalon_jtag_uart

# ── System ID ─────────────────────────────────────────────────────────────────
add_instance sysid altera_avalon_sysid_qsys

# ── LED controller (IPCraft-generated Avalon-MM slave) ────────────────────────
add_instance led_ctrl led_controller_avmm

# ── JTAG-to-Avalon-MM debug master (System Console access) ────────────────────
# This is the key addition over the base led_avmm_system.tcl. It exposes the
# Avalon-MM fabric to System Console via JTAG, allowing register peek/poke
# without Nios V firmware. The master is auto-connected by Platform Designer's
# interconnect alongside the Nios V data_manager.
add_instance jtag_debug_master altera_jtag_avalon_master

# ── Clock connections ─────────────────────────────────────────────────────────
add_connection clk_0.out_clk reset_bridge.clk
add_connection clk_0.out_clk niosv.clk
add_connection clk_0.out_clk onchip_mem.clk1
add_connection clk_0.out_clk jtag_uart.clk
add_connection clk_0.out_clk sysid.clk
add_connection clk_0.out_clk led_ctrl.clk
add_connection clk_0.out_clk jtag_debug_master.clk

# ── Reset connections ─────────────────────────────────────────────────────────
add_connection reset_bridge.out_reset niosv.reset
add_connection reset_bridge.out_reset onchip_mem.reset1
add_connection reset_bridge.out_reset jtag_uart.reset
add_connection reset_bridge.out_reset sysid.reset
add_connection reset_bridge.out_reset led_ctrl.reset
add_connection reset_bridge.out_reset jtag_debug_master.clk_reset

# ── Avalon-MM data bus ────────────────────────────────────────────────────────
# Both Nios V and the JTAG debug master can access all slaves.
# Platform Designer inserts an arbitration interconnect automatically.
add_connection niosv.data_manager        onchip_mem.s1
add_connection niosv.data_manager        jtag_uart.avalon_jtag_slave
add_connection niosv.data_manager        sysid.control_slave
add_connection niosv.data_manager        led_ctrl.S_AVMM
add_connection niosv.data_manager        niosv.dm_agent
add_connection niosv.data_manager        niosv.timer_sw_agent

# JTAG debug master connects to the same slaves as Nios V.
# For register debug, only led_ctrl.S_AVMM is strictly needed, but connecting
# to onchip_mem and sysid too is useful for bring-up diagnostics.
add_connection jtag_debug_master.master onchip_mem.s1
add_connection jtag_debug_master.master led_ctrl.S_AVMM
add_connection jtag_debug_master.master sysid.control_slave

# ── Avalon-MM instruction bus ─────────────────────────────────────────────────
add_connection niosv.instruction_manager onchip_mem.s1
add_connection niosv.instruction_manager niosv.dm_agent

# ── IRQ: niosv.platform_irq_rx is the receiver, peripherals are senders ───────
add_connection niosv.platform_irq_rx jtag_uart.irq
set_connection_parameter_value niosv.platform_irq_rx/jtag_uart.irq irqNumber {0}

# ── Base address map ──────────────────────────────────────────────────────────
# led_ctrl base is 0x00010010 -- this is the address System Console uses.
set_connection_parameter_value niosv.data_manager/onchip_mem.s1                  baseAddress {0x00000000}
set_connection_parameter_value niosv.instruction_manager/onchip_mem.s1           baseAddress {0x00000000}
set_connection_parameter_value niosv.data_manager/led_ctrl.S_AVMM                baseAddress {0x00010010}
set_connection_parameter_value jtag_debug_master.master/led_ctrl.S_AVMM          baseAddress {0x00010010}
set_connection_parameter_value niosv.data_manager/jtag_uart.avalon_jtag_slave    baseAddress {0x00010100}
set_connection_parameter_value niosv.data_manager/sysid.control_slave            baseAddress {0x00010108}
set_connection_parameter_value jtag_debug_master.master/sysid.control_slave      baseAddress {0x00010108}
set_connection_parameter_value niosv.data_manager/niosv.timer_sw_agent           baseAddress {0x00010140}
set_connection_parameter_value niosv.data_manager/niosv.dm_agent                 baseAddress {0x00020000}
set_connection_parameter_value niosv.instruction_manager/niosv.dm_agent          baseAddress {0x00020000}

# ── Reset vector (on-chip RAM) ────────────────────────────────────────────────
set_instance_parameter_value niosv resetSlave  {onchip_mem.s1}
set_instance_parameter_value niosv resetOffset {0x00000000}

# ── Top-level port exports ────────────────────────────────────────────────────
add_interface clk clock sink
set_interface_property clk EXPORT_OF clk_0.in_clk

add_interface reset reset sink
set_interface_property reset EXPORT_OF reset_bridge.in_reset

add_interface led_external_connection conduit end
set_interface_property led_external_connection EXPORT_OF led_ctrl.led

save_system led_avmm_system.qsys
puts "led_avmm_system.qsys saved (debug variant with JTAG-to-Avalon-MM master)"
