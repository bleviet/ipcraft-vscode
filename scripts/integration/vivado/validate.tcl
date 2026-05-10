# Vivado batch-mode validator for ipcraft-generated component.xml + busdef XMLs.
#
# Usage:
#   vivado -mode batch -source validate.tcl -tclargs <amd-dir>
#
# <amd-dir> must contain:
#   component.xml          - the Spirit 1685-2009 IP-XACT component descriptor
#   busdef/                - (optional) custom bus definition XML files
#
# Exit: 0 = PASS, 1 = FAIL

set amd_dir [lindex $argv 0]
if {$amd_dir eq ""} {
    puts stderr "Usage: vivado -mode batch -source validate.tcl -tclargs <amd-dir>"
    exit 1
}
set amd_dir    [file normalize $amd_dir]
set comp_xml   [file join $amd_dir component.xml]
set busdef_dir [file join $amd_dir busdef]

puts "=== Vivado Component Validation ==="
puts "Component : $comp_xml"
puts "Busdef dir: $busdef_dir"

if {![file exists $comp_xml]} {
    puts "\nFAIL: component.xml not found at $comp_xml"
    exit 1
}

# In-memory project — no disk artefacts
create_project -in_memory -part xc7z020clg484-1

# Register custom bus definitions if present so Vivado can resolve their VLNVs
if {[file isdirectory $busdef_dir]} {
    set_property ip_repo_paths [list $busdef_dir] [current_project]
    update_ip_catalog -rebuild
    puts "Registered busdef repository: $busdef_dir"
}

# Open the component
set core [ipx::open_core $comp_xml]
set vlnv [get_property VLNV $core]
puts "Core VLNV : $vlnv"

if {$vlnv eq ":::"} {
    puts "\nFAIL: component.xml parsed but VLNV is empty (schema violation)"
    ipx::unload_core $core
    close_project -delete
    exit 1
}

# Run integrity check
catch {ipx::check_integrity -quiet $core}

set n_errors   [get_msg_config -count -severity ERROR]
set n_warnings [get_msg_config -count -severity WARNING]

puts "\nErrors   : $n_errors"
puts "Warnings : $n_warnings"

ipx::unload_core $core
close_project -delete

if {$n_errors == 0} {
    puts "\nPASS: $vlnv — integrity check passed"
    exit 0
} else {
    puts "\nFAIL: $vlnv — $n_errors error(s) detected"
    exit 1
}
