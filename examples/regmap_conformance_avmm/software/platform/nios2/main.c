/*
 * main.c -- Nios II entry point for the register access-type conformance
 * self-test (docs/hardware-conformance-test-plan.md, "Component 3" -- the
 * Nios II bare-metal C host).
 *
 * All check logic lives in ../../app/conformance_checks.c (portable across
 * CPU platforms); this file only wires it to the Nios II HAL (platform.c)
 * and prints the final sentinel over the JTAG UART.
 *
 * KNOWN LIMITATION (see docs/hardware_validation_results.md): live capture
 * of this JTAG UART output via nios2-terminal or System Console's
 * bytestream service has not been made reliable in the board-in-the-loop
 * Makefile. Execution is instead confirmed by reading SCRATCH back over
 * the JTAG-to-Avalon-MM master after a run -- it lands on the exact value
 * this firmware's byte-strobe check leaves it at. The System Console host
 * (../../altera/debug/conformance_sysconsole.tcl) is the CI-gateable
 * source of truth.
 */

#include "sys/alt_stdio.h"
#include "../../app/conformance_checks.h"

int main(void)
{
    alt_printf("==== regmap_conformance hardware self-test ====\n");

    uint32_t fail_count = run_conformance_checks();

    if (fail_count == 0) {
        alt_printf("==== CONFORMANCE: ALL PASS ====\n");
    } else {
        alt_printf("==== CONFORMANCE: %x FAIL ====\n", fail_count);
    }

    while (1) {
        ;
    }

    return 0;
}
