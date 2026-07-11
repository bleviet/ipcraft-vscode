# ---------------------------------------------------------------------------
# System Console CLI script: discover JTAG master, claim it, read all
# led_controller_avmm registers, and print results with sentinel framing.
#
# Usage (inside the cvsoc/quartus Docker image or a native Quartus install):
#   system-console --cli --script=debug_read_all.tcl
#
# Or from the Makefile:
#   make debug-read-all
#
# This script demonstrates the exact Tcl sequence the ipcraft-vscode
# SystemConsoleTransport (issue #36 Part B) will automate from TypeScript:
#   1. get_service_paths master   — find the JTAG-to-Avalon master service
#   2. claim_service              — take exclusive control of the master
#   3. master_read_32 / master_write_32 — peek/poke registers by address
#   4. close_service              — release the master
#
# Register map (from led_controller_avmm.mm.yml, base 0x00010010):
#   0x00010010 + 0x00 = VERSION       (read-only: MINOR[7:0], MAJOR[15:8])
#   0x00010010 + 0x04 = LED_PATTERN   (read-write: PATTERN[7:0])
#   0x00010010 + 0x08 = EVENTS        (HEARTBEAT_ACTIVE[0], HEARTBEAT_TOGGLED[1])
# ---------------------------------------------------------------------------

set LED_CTRL_BASE 0x00010010

set REG_VERSION     [expr {$LED_CTRL_BASE + 0x00}]
set REG_LED_PATTERN [expr {$LED_CTRL_BASE + 0x04}]
set REG_EVENTS      [expr {$LED_CTRL_BASE + 0x08}]

# ── 1. Discover the JTAG-to-Avalon master service ────────────────────────────
set service_paths [get_service_paths master]

if {[llength $service_paths] == 0} {
    puts "@@ERROR no JTAG-to-Avalon master service found."
    puts "@@ERROR Ensure the debug variant bitstream is programmed:"
    puts "@@ERROR   make debug-build && make debug-program"
    exit 1
}

puts "@@INFO Found [llength $service_paths] master service path(s):"
foreach p $service_paths {
    puts "@@INFO   $p"
}

# ── 2. Open the first available master service ──────────────────────────────
# Use the first path (phy_0/master = JTAG-to-Avalon-MM master, not nios2_0)
set master_path [lindex $service_paths 0]
open_service master $master_path

puts "@@INFO Opened master: $master_path"

# ── 3. Read all registers ────────────────────────────────────────────────────
puts "@@BEGIN read_all"

set version_val [master_read_32 $master_path $REG_VERSION 1]
puts "@@RESULT VERSION $version_val"
set major [expr {([lindex $version_val 0] >> 8) & 0xFF}]
set minor [expr {[lindex $version_val 0] & 0xFF}]
puts "@@DECODE VERSION MAJOR=$major MINOR=$minor"

set pattern_val [master_read_32 $master_path $REG_LED_PATTERN 1]
puts "@@RESULT LED_PATTERN $pattern_val"
set pattern [expr {[lindex $pattern_val 0] & 0xFF}]
puts "@@DECODE LED_PATTERN PATTERN=0x[format {%02X} $pattern] (binary: [format {%08b} $pattern])"

set events_val [master_read_32 $master_path $REG_EVENTS 1]
puts "@@RESULT EVENTS $events_val"
set events_raw [lindex $events_val 0]
set heartbeat_active [expr {$events_raw & 0x01}]
set heartbeat_toggled [expr {($events_raw >> 1) & 0x01}]
puts "@@DECODE EVENTS HEARTBEAT_ACTIVE=$heartbeat_active HEARTBEAT_TOGGLED=$heartbeat_toggled"

puts "@@END read_all"

# ── 4. Close the master service ───────────────────────────────────────────────
close_service master $master_path
puts "@@INFO Closed master: $master_path"
puts "@@DONE"
