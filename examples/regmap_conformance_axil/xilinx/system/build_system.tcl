# Builds the example block design regmap_axil_system for the ZedBoard (xc7z020clg484-1):
# creates the Vivado project next to this script, runs synthesis and implementation up to
# route_design, and writes hierarchical utilization reports into the run folders, where the
# IPCraft system viewer finds them (Resources).
#
# Usage (from this folder):
#   vivado -mode batch -source build_system.tcl -nojournal -nolog
#   vivado -mode batch -source build_system.tcl -nojournal -nolog -tclargs 8
#
# Optional argument: number of parallel jobs (default 4). No bitstream is written.

set script_dir   [file normalize [file dirname [info script]]]
set project_name regmap_axil_system
set jobs         [expr {[llength $argv] > 0 ? int([lindex $argv 0]) : 4}]

create_project -force $project_name $script_dir -part xc7z020clg484-1
# The IP-XACT description of regmap_conformance_axil (component.xml) is in xilinx/.
set_property IP_REPO_PATHS [list [file normalize [file join $script_dir ..]]] [current_project]
update_ip_catalog -rebuild

source [file join $script_dir regmap_axil_system.tcl]
set bd_file [get_files regmap_axil_system.bd]
generate_target all $bd_file
add_files -norecurse [make_wrapper -files $bd_file -top]
set_property top regmap_axil_system_wrapper [current_fileset]
add_files -fileset constrs_1 -norecurse [file join $script_dir zedboard.xdc]
update_compile_order -fileset sources_1

# Each IP of the block design is synthesized out of context (<ip>_synth_1), then the top.
launch_runs synth_1 -jobs $jobs
wait_on_run synth_1
if {[get_property PROGRESS [get_runs synth_1]] ne "100%"} {
    puts "ERROR: synthesis did not complete."
    exit 1
}
launch_runs impl_1 -to_step route_design -jobs $jobs
wait_on_run impl_1
if {[get_property PROGRESS [get_runs impl_1]] ne "100%"} {
    puts "ERROR: implementation did not complete."
    exit 1
}

# Vivado writes only design totals in its run reports; one row per block needs -hierarchical.
foreach {run stage} {synth_1 synth impl_1 routed} {
    open_run $run
    report_utilization -hierarchical -file \
        [file join [get_property DIRECTORY [get_runs $run]] regmap_axil_system_wrapper_utilization_hier_${stage}.rpt]
    close_design
}
puts "=== regmap_axil_system built: open regmap_axil_system.tcl in the IPCraft system viewer ==="
exit
