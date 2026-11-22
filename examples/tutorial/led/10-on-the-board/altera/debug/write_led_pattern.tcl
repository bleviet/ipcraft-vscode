# ---------------------------------------------------------------------------
# System Console CLI script: write LED_PATTERN register and read it back.
#
# Usage:
#   system-console --cli --script=debug_write_led.tcl --script_args=<hex_value>
#
# Or from the Makefile:
#   make debug-write-led VALUE=0xFF
#
# Demonstrates a write-then-verify cycle — the exact pattern the ipcraft-vscode
# "write a field and read it back" acceptance criterion (issue #36) requires.
# ---------------------------------------------------------------------------

set LED_CTRL_BASE 0x00010010
set REG_LED_PATTERN [expr {$LED_CTRL_BASE + 0x04}]

# Parse the value from script_args (first argument = hex or decimal)
set write_value 0xFF
if {[info exists script_args] && [llength $script_args] > 0} {
    set write_value [lindex $script_args 0]
}

# Accept hex string like 0xFF or decimal
if {[string match "0x*" $write_value]} {
    set write_value [expr {$write_value}]
}

puts "@@INFO Writing LED_PATTERN = 0x[format {%02X} $write_value]"

# ── Open master ──────────────────────────────────────────────────────────────
set service_paths [get_service_paths master]
if {[llength $service_paths] == 0} {
    puts "@@ERROR no JTAG-to-Avalon master service found."
    exit 1
}
set master_path [lindex $service_paths 0]
open_service master $master_path

# ── Write LED_PATTERN ────────────────────────────────────────────────────────
puts "@@BEGIN write_led_pattern"
master_write_32 $master_path $REG_LED_PATTERN [list $write_value]
puts "@@WROTE LED_PATTERN 0x[format {%02X} $write_value]"

# ── Read back to verify ──────────────────────────────────────────────────────
set readback [master_read_32 $master_path $REG_LED_PATTERN 1]
puts "@@READBACK RAW: $readback"
set read_val [lindex $readback 0]
set read_int [expr {$read_val & 0xFF}]
set write_int [expr {$write_value & 0xFF}]
puts "@@READBACK LED_PATTERN 0x[format %02X $read_int]"

if {$read_int == $write_int} {
    puts "@@VERIFY PASS"
} else {
    puts "@@VERIFY FAIL (wrote 0x[format %02X $write_int], read 0x[format %02X $read_int])"
}
puts "@@END write_led_pattern"

close_service master $master_path
puts "@@DONE"
