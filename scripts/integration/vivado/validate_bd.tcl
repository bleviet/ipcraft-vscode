# Vivado block-design validator for ipcraft-generated component.xml.
#
# Where validate.tcl checks the component.xml statically (ipx::check_integrity),
# this script forces Vivado's IP integrator to *consume* the packaged IP exactly
# as an end user would: it registers the generated directory as an IP repository,
# instantiates the IP by VLNV in a block design, exports every interface and scalar
# port to the design boundary, and runs validate_bd_design.
#
# This catches errors that a static schema check and raw-RTL OOC synthesis miss --
# wrong bus-interface inference, broken portMaps, port-direction mismatches, and
# unresolved custom-interface VLNVs -- because those only surface when the tool wires
# the IP-XACT bus interfaces into a real design.
#
# Usage:
#   vivado -mode batch -source validate_bd.tcl -tclargs <xilinx-dir> [<part>]
#
# <xilinx-dir> must contain:
#   component.xml          - the Spirit 1685-2009 IP-XACT component descriptor
#   busdef/                - (optional) custom bus definition XML files
#
# Exit: 0 = PASS, 1 = FAIL

set xilinx_dir [lindex $argv 0]
if {$xilinx_dir eq ""} {
    puts stderr "Usage: vivado -mode batch -source validate_bd.tcl -tclargs <xilinx-dir> \[<part>\]"
    exit 1
}
set xilinx_dir [file normalize $xilinx_dir]
set comp_xml   [file join $xilinx_dir component.xml]
set busdef_dir [file join $xilinx_dir busdef]
set part       [expr {[llength $argv] > 1 ? [lindex $argv 1] : "xc7z020clg484-1"}]

puts "=== Vivado Block-Design Validation ==="
puts "Component : $comp_xml"
puts "Busdef dir: $busdef_dir"
puts "Part      : $part"

if {![file exists $comp_xml]} {
    puts "\nFAIL: component.xml not found at $comp_xml"
    exit 1
}

# Read the top-level VLNV from component.xml. Only the first occurrence of each
# spirit field is the component identity (interface busTypes use attributes, not
# child elements, so the element regex below does not match them).
set fh [open $comp_xml r]
set xml [read $fh]
close $fh

proc spirit_field {xml tag} {
    if {[regexp "<spirit:$tag>(\[^<\]*)</spirit:$tag>" $xml -> val]} {
        return [string trim $val]
    }
    return ""
}

set vendor  [spirit_field $xml vendor]
set library [spirit_field $xml library]
set name    [spirit_field $xml name]
set version [spirit_field $xml version]
set vlnv    "$vendor:$library:$name:$version"

puts "Core VLNV : $vlnv"
if {$vendor eq "" || $library eq "" || $name eq "" || $version eq ""} {
    puts "\nFAIL: could not parse a complete VLNV from component.xml (got '$vlnv')"
    exit 1
}

# In-memory project -- no disk artefacts. Structural validation only.
create_project -in_memory -part $part

# Register the generated directory (and any custom bus definitions) as an IP
# repository so Vivado can resolve the component VLNV and its bus interfaces.
set repo_paths [list $xilinx_dir]
if {[file isdirectory $busdef_dir]} {
    lappend repo_paths $busdef_dir
    puts "Registered busdef repository: $busdef_dir"
}
set_property ip_repo_paths $repo_paths [current_project]
update_ip_catalog -rebuild

# Create the block design and instantiate the packaged IP by VLNV.
create_bd_design test

if {[catch {create_bd_cell -type ip -vlnv $vlnv inst_0} err]} {
    puts "\nFAIL: $vlnv -- IP integrator could not instantiate the packaged IP:"
    puts "  $err"
    close_project -delete
    exit 1
}

# Export every interface and scalar port of the instance to the design boundary,
# so validate_bd_design exercises the full IP-XACT interface surface (no warnings
# about required-but-unconnected interfaces from a bare instance).
set intf_pins [get_bd_intf_pins -quiet -of_objects [get_bd_cells inst_0]]
if {[llength $intf_pins] > 0} {
    make_bd_intf_pins_external $intf_pins
}
set pins [get_bd_pins -quiet -of_objects [get_bd_cells inst_0]]
if {[llength $pins] > 0} {
    make_bd_pins_external $pins
}

puts "Exported interfaces: [llength $intf_pins]   ports: [llength $pins]"

# Validate the assembled design. validate_bd_design itself returns non-zero on
# hard failures; we additionally count tool-level ERROR messages (same mechanism
# as validate.tcl) to catch issues reported without a non-zero return.
catch {validate_bd_design} validate_out
puts $validate_out

set n_errors   [get_msg_config -count -severity ERROR]
set n_warnings [get_msg_config -count -severity WARNING]

puts "\nErrors   : $n_errors"
puts "Warnings : $n_warnings"

close_project -delete

if {$n_errors == 0} {
    puts "\nPASS: $vlnv -- block-design instantiation and validation passed"
    exit 0
} else {
    puts "\nFAIL: $vlnv -- $n_errors error(s) detected during block-design validation"
    exit 1
}
