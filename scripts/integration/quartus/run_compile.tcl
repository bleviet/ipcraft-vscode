# Runs Quartus full compile flow on a generated project.
#
# Usage:
#   quartus_sh -t run_compile.tcl <altera_dir> <project_name>
#
# The script opens the .qpf project in <altera_dir>, runs Analysis &
# Synthesis, Fitter, and Assembler, then reports PASS/FAIL.
#
# Exit: 0 = PASS, 1 = FAIL

load_package flow

if {$argc < 2} {
    puts stderr "Usage: quartus_sh -t run_compile.tcl <altera_dir> <project_name>"
    exit 1
}

set altera_dir [lindex $argv 0]
set project_name [lindex $argv 1]
set qpf_path [file join $altera_dir "${project_name}.qpf"]

if {![file exists $qpf_path]} {
    puts "FAIL: project file not found: $qpf_path"
    exit 1
}

puts "======================================================"
puts "=== Quartus compile: $project_name"
puts "=== Project: $qpf_path"
puts "======================================================"

set rc [catch {
    project_open $project_name -revision [get_current_revision $project_name]

    puts "\n--- Analysis & Synthesis ---"
    execute_module -tool map

    puts "\n--- Fitter ---"
    execute_module -tool fit

    puts "\n--- Assembler ---"
    execute_module -tool asm

    puts "\n--- Timing Analysis ---"
    catch {execute_module -tool sta}

    project_close
} err]

if {$rc != 0} {
    puts "\nFAIL: Quartus compile error: $err"
    catch {project_close}
    exit 1
}

puts "\n======================================================"
puts "PASS: $project_name compiled successfully"
puts "======================================================"
exit 0
