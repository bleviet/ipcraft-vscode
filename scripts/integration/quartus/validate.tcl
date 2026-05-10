# Validates an Altera Platform Designer hw.tcl file.
#
# Loads the file with Platform Designer API stubs and calls the component's
# elaborate and validate callbacks, then reports structural correctness.
#
# Usage:
#   tclsh validate.tcl <hw_tcl_path> [<hw_tcl_path> ...]
#
# Exit: 0 = all PASS, 1 = one or more FAIL

set stub_dir [file dirname [file normalize [info script]]]
source [file join $stub_dir stub_platform_designer.tcl]

if {$argc == 0} {
    puts stderr "Usage: tclsh validate.tcl <hw_tcl_path> \[<hw_tcl_path> ...\]"
    exit 1
}

set total_errors 0

foreach hw_tcl $argv {
    puts "\n======================================================"
    puts "=== Validating: [file tail $hw_tcl]"
    puts "======================================================"

    if {![file exists $hw_tcl]} {
        puts "FAIL: file not found: $hw_tcl"
        incr total_errors
        continue
    }

    # Reset recorded state for this file
    ::pd::reset

    # ── Source the hw.tcl ────────────────────────────────────────────────────
    set rc [catch {source $hw_tcl} err]
    if {$rc != 0} {
        puts "FAIL: TCL error while loading: $err"
        incr total_errors
        continue
    }

    # ── Call elaborate ────────────────────────────────────────────────────────
    if {[llength [info procs elaborate]] == 0} {
        puts "FAIL: hw.tcl does not define an 'elaborate' procedure"
        incr total_errors
        continue
    }
    set rc [catch {elaborate} err]
    if {$rc != 0} {
        puts "FAIL: elaborate raised: $err"
        incr total_errors
        continue
    }

    # ── Call validate (optional — skip if not defined) ────────────────────────
    if {[llength [info procs validate]] > 0} {
        catch {validate} err
    }

    # ── Structural checks on top of what the stubs already caught ─────────────
    # Every hw.tcl must have at least one interface
    if {[llength $::pd::interfaces] == 0} {
        ::pd::err "No interfaces registered (elaborate produced no add_interface calls)"
    }

    # Must have a module name
    if {$::pd::module_name eq ""} {
        ::pd::err "set_module_property NAME was never called"
    }

    # All interfaces must have at least one port
    foreach iface $::pd::interfaces {
        set iname [dict get $iface name]
        set itype [dict get $iface type]
        # clock and reset interfaces are allowed zero ports (port map comes from association)
        if {$itype in {clock reset}} continue
        set iface_ports [lsearch -all -inline -index 1 \
            [lmap p $::pd::ports {list [dict get $p iface] $p}] $iname]
        # Simpler: count ports for this interface
        set n_ports 0
        foreach port $::pd::ports {
            if {[dict get $port iface] eq $iname} { incr n_ports }
        }
        if {$n_ports == 0 && $itype ni {clock reset}} {
            ::pd::warn "Interface '$iname' ($itype) has no add_interface_port calls"
        }
    }

    # ── Report ────────────────────────────────────────────────────────────────
    set nerr [::pd::report]
    incr total_errors $nerr
}

puts "\n======================================================"
if {$total_errors == 0} {
    puts "OVERALL PASS: all hw.tcl files validated successfully"
} else {
    puts "OVERALL FAIL: $total_errors error(s) across all files"
}
puts "======================================================"

exit [expr {$total_errors > 0 ? 1 : 0}]
