# Vivado block-design validator for ipcraft-generated component.xml.
#
# Where validate.tcl checks the component.xml statically (ipx::check_integrity),
# this script forces Vivado's IP integrator to *consume* the packaged IP exactly
# as an end user would: it registers the generated directory as an IP repository,
# instantiates the IP by VLNV in a block design, exports every interface and scalar
# port to the design boundary, assigns every memory-map address block explicitly,
# and runs validate_bd_design.
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
# Exit: 0 = PASS, 1 = FAIL (any ERROR or CRITICAL WARNING fails)

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

# Everything after this point concerns the generated IP. get_msg_config -count
# counts each message more than once, so only the change from here decides
# PASS/FAIL; the messages are printed between the markers for vivado.test.ts.
set errors_before   [get_msg_config -count -severity ERROR]
set critical_before [get_msg_config -count -severity {CRITICAL WARNING}]
puts "=== block design begin ==="

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

# Assign every authored address block explicitly, at its base address, into the
# address space of the external port that make_bd_intf_pins_external connected
# to its interface. A memory map that does not fit the slave's
# address port (e.g. a block above the 2^N aperture) fails here with BD 41-1075;
# Vivado's auto-assign picks its own window and would hide that defect. The
# range is the block range rounded up to a power of two, at least Vivado's
# per-bus minimum ("less than the minimum range" in BD 41-1075): 4K for Avalon,
# 128 otherwise. Offsets are not exposed as segment properties, so base and range
# come from component.xml.
proc next_pow2 {n floor} {
    set p $floor
    while {$p < $n} { set p [expr {$p * 2}] }
    return $p
}

array set authored {}
foreach {mm_all mm_name mm_body} [regexp -all -inline {<spirit:memoryMap>\s*?<spirit:name>([^<]*)</spirit:name>(.*?)</spirit:memoryMap>} $xml] {
    foreach {blk_all blk_name blk_body} [regexp -all -inline {<spirit:addressBlock>\s*?<spirit:name>([^<]*)</spirit:name>(.*?)</spirit:addressBlock>} $mm_body] {
        if {![regexp {<spirit:baseAddress[^>]*>([^<]*)<} $blk_body -> base] ||
            ![regexp {<spirit:range[^>]*>([^<]*)<} $blk_body -> range]} { continue }
        set authored(/inst_0/$mm_name/$blk_name) [list $base $range]
    }
}

set assign_failures 0
foreach seg [get_bd_addr_segs -quiet /inst_0/*/*] {
    set path $seg
    if {![info exists authored($path)]} {
        # The IP declares no memory map for this interface, so there is nothing
        # authored to check; Vivado's default segment stays unassigned.
        set_msg_config -id {BD 41-1356} -string [list "Slave segment <$path>"] -new_severity WARNING
        continue
    }
    lassign $authored($path) base range
    set slave [lindex [get_bd_intf_pins -of_objects $seg] 0]
    set floor [expr {[string match -nocase *avalon* [get_property VLNV $slave]] ? 4096 : 128}]
    set size  [next_pow2 [expr {$range}] $floor]
    # The exported port only has an address space when Vivado treats it as a
    # memory-mapped master; otherwise there is nothing to assign into, so a pass
    # here does not mean this block's layout was checked (e.g. some Avalon-MM
    # slaves).
    set port  [get_bd_intf_ports -quiet -of_objects [get_bd_intf_nets -quiet -of_objects $slave]]
    set space [get_bd_addr_spaces -quiet -of_objects $port]
    if {$space eq ""} {
        puts "Skipping $path: exported interface has no address space"
        continue
    }
    puts "Assigning $path: offset $base range $size into $space"
    if {[catch {assign_bd_address -target_address_space $space -offset $base -range $size $seg} err]} {
        # Printed as a tagged ERROR so vivado.test.ts collects it with the
        # Vivado message IDs, even when Vivado itself did not count it.
        puts "ERROR: \[ipcraft assign\] $path: $err"
        incr assign_failures
    }
}

puts "Exported interfaces: [llength $intf_pins]   ports: [llength $pins]"

# Validate the assembled design. validate_bd_design itself returns non-zero on
# hard failures; ERROR and CRITICAL WARNING messages are counted as well, since
# Vivado reports port-map and interface defects without a non-zero return.
catch {validate_bd_design} validate_out
puts $validate_out
puts "=== block design end ==="

set new_errors   [expr {[get_msg_config -count -severity ERROR] - $errors_before}]
set new_critical [expr {[get_msg_config -count -severity {CRITICAL WARNING}] - $critical_before}]

close_project -delete

if {$new_errors == 0 && $assign_failures == 0 && $new_critical == 0} {
    puts "\nPASS: $vlnv -- block-design instantiation and validation passed"
    exit 0
} else {
    puts "\nFAIL: $vlnv -- ERRORs or CRITICAL WARNINGs during block-design validation (listed above)"
    exit 1
}
