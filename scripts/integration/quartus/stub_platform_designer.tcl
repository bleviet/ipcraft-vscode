# Platform Designer (Qsys) API stubs for structural hw.tcl validation.
#
# Source this file BEFORE sourcing an hw.tcl. It:
#   1. Stubs the Platform Designer command surface so hw.tcl can be loaded
#      and its elaborate/validate callbacks called without a live PD session.
#   2. Records every add_interface / add_interface_port call so validate.tcl
#      can check them after elaboration.
#   3. Emits a PASS/FAIL summary via ::pd::report.
#
# Valid Platform Designer interface types (Quartus 23.x):
set ::pd_valid_iface_types {
    axi4lite axi4 axi4stream
    avalon avalon_streaming
    conduit
    clock reset
    interrupt
    nios_custom_instruction
}

namespace eval ::pd {
    variable interfaces {}
    variable ports {}
    variable module_name ""
    variable module_version ""
    variable errors {}
    variable warnings {}
    variable params [dict create]

    proc reset {} {
        set ::pd::interfaces {}
        set ::pd::ports {}
        set ::pd::module_name ""
        set ::pd::module_version ""
        set ::pd::errors {}
        set ::pd::warnings {}
        set ::pd::params [dict create]
    }

    proc err {msg} {
        lappend ::pd::errors $msg
        puts stderr "  PD-ERROR: $msg"
    }

    proc warn {msg} {
        lappend ::pd::warnings $msg
    }

    proc report {} {
        puts "\n--- Platform Designer Structural Report ---"
        if {$::pd::module_name ne ""} {
            puts "Module  : $::pd::module_name  v$::pd::module_version"
        }

        puts "\nInterfaces ([llength $::pd::interfaces]):"
        foreach iface $::pd::interfaces {
            set name [dict get $iface name]
            set type [dict get $iface type]
            set dir  [dict get $iface dir]
            puts "  $name  ($type $dir)"
        }

        puts "\nPorts ([llength $::pd::ports]):"
        foreach port $::pd::ports {
            set iface   [dict get $port iface]
            set pname   [dict get $port port]
            set logical [dict get $port logical]
            set dir     [dict get $port dir]
            set width   [dict get $port width]
            puts "  ${iface}.${pname} -> $logical  $dir  w=$width"
        }

        set nerr  [llength $::pd::errors]
        set nwarn [llength $::pd::warnings]
        puts "\nErrors   : $nerr"
        puts "Warnings : $nwarn"

        if {$nerr == 0} {
            puts "\nPASS: hw.tcl structural validation OK"
        } else {
            puts "\nFAIL: $nerr structural error(s):"
            foreach e $::pd::errors { puts "  - $e" }
        }
        return $nerr
    }
}

# ── Core stubs ────────────────────────────────────────────────────────────────

proc add_interface {name type direction args} {
    if {$type ni $::pd_valid_iface_types} {
        ::pd::err "add_interface '$name': unknown type '$type'"
    }
    if {$direction ni {start end}} {
        ::pd::err "add_interface '$name': invalid direction '$direction'"
    }
    lappend ::pd::interfaces [dict create name $name type $type dir $direction]
}

proc add_interface_port {iface port logical dir width args} {
    if {$dir ni {Input Output}} {
        ::pd::err "add_interface_port '${iface}.${port}': invalid direction '$dir'"
    }
    # Accept a positive integer literal OR a non-empty string (parameter name /
    # expression such as DATA_WIDTH), which Platform Designer resolves at elaboration.
    if {$width eq "" || ([string is integer -strict $width] && $width < 1)} {
        ::pd::err "add_interface_port '${iface}.${port}': invalid width '$width'"
    }
    lappend ::pd::ports [dict create \
        iface $iface port $port logical $logical dir $dir width $width]
}

proc set_module_property {key args} {
    switch -- $key {
        NAME    { set ::pd::module_name    [lindex $args 0] }
        VERSION { set ::pd::module_version [lindex $args 0] }
    }
}

proc add_parameter {name type {value ""} args} {
    dict set ::pd::params $name $value
}

proc get_parameter_value {name} {
    if {[info exists ::pd::params] && [dict exists $::pd::params $name]} {
        return [dict get $::pd::params $name]
    }
    return 32
}

# Stubs that accept any arguments and do nothing
foreach _cmd {
    set_interface_property
    set_module_assignment
    set_module_port_name_map
    add_fileset
    set_fileset_property
    add_fileset_file
    set_fileset_assignment
    set_parameter_property
    add_display_item
    set_display_item_property
    send_message
} {
    proc $_cmd {args} {}
}
unset _cmd

# ── Intercept 'package require qsys' ─────────────────────────────────────────
# Prevent the hw.tcl from loading the real qsys package (not available outside PD).
rename package ::_pd_orig_package
proc package {args} {
    if {[lindex $args 0] eq "require" && "qsys" in $args} {
        return "1.0"   ;# fake success
    }
    ::_pd_orig_package {*}$args
}
