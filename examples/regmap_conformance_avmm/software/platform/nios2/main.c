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

#include "io.h"
#include "system.h"
#include "sys/alt_irq.h"
#include "sys/alt_stdio.h"
#include "../../app/conformance_checks.h"

#define REG_SCRATCH 0x04u
#define REG_STIMULUS 0x08u
#define REG_INT_STATUS 0x10u
#define STIM_SAMPLE_EVT_TRIG (1u << 4)
#define BUSLESS_IRQ 2u
#define IRQ_RESULT_PREFIX 0x49525100u
#define IRQ_ASSOCIATED_SEEN (1u << 0)
#define IRQ_BUSLESS_SEEN (1u << 1)

static uint32_t run_interrupt_checks(void)
{
    uint32_t irq_seen;
    uint32_t pending;
    volatile uint32_t timeout;

    irq_seen = 0;
    (void)alt_irq_disable_all();
    if (alt_ic_irq_enable(
            REGMAP_CTRL_IRQ_INTERRUPT_CONTROLLER_ID,
            REGMAP_CTRL_IRQ) != 0) {
        IOWR_32DIRECT(REGMAP_CTRL_BASE, REG_SCRATCH, IRQ_RESULT_PREFIX);
        return 0;
    }
    if (alt_ic_irq_enable(
            REGMAP_CTRL_IRQ_INTERRUPT_CONTROLLER_ID,
            BUSLESS_IRQ) != 0) {
        IOWR_32DIRECT(REGMAP_CTRL_BASE, REG_SCRATCH, IRQ_RESULT_PREFIX);
        return 0;
    }

    IOWR_32DIRECT(REGMAP_CTRL_BASE, REG_STIMULUS, 0);
    IOWR_32DIRECT(
        REGMAP_CTRL_BASE,
        REG_STIMULUS,
        STIM_SAMPLE_EVT_TRIG);

    for (timeout = 0; timeout < 50000000u; timeout++) {
        NIOS2_READ_IPENDING(pending);
        if (pending & (1u << REGMAP_CTRL_IRQ)) {
            irq_seen |= IRQ_ASSOCIATED_SEEN;
            IOWR_32DIRECT(REGMAP_CTRL_BASE, REG_INT_STATUS, 1u);
        }
        if (pending & (1u << BUSLESS_IRQ)) {
            irq_seen |= IRQ_BUSLESS_SEEN;
        }
        if (irq_seen == (IRQ_ASSOCIATED_SEEN | IRQ_BUSLESS_SEEN)) {
            break;
        }
    }

    IOWR_32DIRECT(
        REGMAP_CTRL_BASE,
        REG_SCRATCH,
        IRQ_RESULT_PREFIX | irq_seen);
    return irq_seen;
}

int main(void)
{
    alt_printf("==== regmap_conformance hardware self-test ====\n");

    uint32_t fail_count = run_conformance_checks();
    uint32_t interrupt_result = run_interrupt_checks();

    if (interrupt_result ==
        (IRQ_ASSOCIATED_SEEN | IRQ_BUSLESS_SEEN)) {
        alt_printf("PASS interrupt_associations\n");
    } else {
        alt_printf("FAIL interrupt_associations\n");
        fail_count++;
    }

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
