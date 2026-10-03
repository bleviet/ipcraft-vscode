# Vivado batch-mode validator for ipcraft-generated component.xml + busdef XMLs.
#
# Usage:
#   vivado -mode batch -source validate.tcl -tclargs <amd-dir>
#
# <amd-dir> must contain:
#   component.xml          - the Spirit 1685-2009 IP-XACT component descriptor
#   busdef/                - (optional) custom bus definition XML files
#
# Exit: 0 = PASS, 1 = FAIL (any ERROR or CRITICAL WARNING fails)

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

# Everything after this point concerns the generated IP: loading the busdef
# repository, opening the core and checking its integrity. Vivado reports real
# port-map defects (e.g. IP_Flow 19-4729, logical-name case mismatch) as
# CRITICAL WARNINGs, so those fail like ERRORs. get_msg_config -count counts
# each message more than once, so only the change from here decides PASS/FAIL;
# the messages are printed between the markers for vivado.test.ts.
set errors_before   [get_msg_config -count -severity ERROR]
set critical_before [get_msg_config -count -severity {CRITICAL WARNING}]
puts "=== component validation begin ==="

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

# Run integrity check (not -quiet, so its messages are listed).
catch {ipx::check_integrity $core}
puts "=== component validation end ==="
set new_errors   [expr {[get_msg_config -count -severity ERROR] - $errors_before}]
set new_critical [expr {[get_msg_config -count -severity {CRITICAL WARNING}] - $critical_before}]

ipx::unload_core $core
close_project -delete

if {$new_errors == 0 && $new_critical == 0} {
    puts "\nPASS: $vlnv — integrity check passed"
    exit 0
} else {
    puts "\nFAIL: $vlnv — component validation raised ERRORs or CRITICAL WARNINGs (listed above)"
    exit 1
}
