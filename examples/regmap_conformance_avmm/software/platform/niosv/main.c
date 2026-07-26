/*
 * main.c -- Nios V/m entry point for the register access-type conformance
 * self-test (docs/hardware-conformance-test-plan.md, "Component 3" -- the
 * Nios V/m bare-metal C host).
 *
 * All check logic lives in ../../app/conformance_checks.c (portable across
 * CPU platforms); this file only wires it to the Nios V/m HAL (platform.c)
 * and prints the final sentinel over the JTAG UART.
 *
 * KNOWN LIMITATION (see docs/hardware_validation_results.md): live capture
 * of this JTAG UART output via nios2-terminal is not reliable without an
 * already-attached host. The self-test therefore runs before diagnostic text
 * and is verified through the Nios V RISC-V debug server by reading SCRATCH.
 * A result of 0x49525103 proves that all CPU-executable register checks and
 * both required interrupts passed; any test failure is encoded with the
 * 0x46414900 prefix.
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
#define TEST_FAILURE_PREFIX 0x46414900u
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
        pending = alt_irq_pending();
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
    uint32_t fail_count = run_conformance_checks();
    uint32_t interrupt_result = run_interrupt_checks();

    /*
     * Run the checks before reporting. A JTAG UART may not have an active
     * host when this image starts; emitting the banner first can fill its
     * small transmit FIFO and stall the processor before it reaches the
     * hardware test.
     */
    alt_printf("==== regmap_conformance hardware self-test ====\n");

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
        IOWR_32DIRECT(
            REGMAP_CTRL_BASE,
            REG_SCRATCH,
            TEST_FAILURE_PREFIX | (fail_count & 0xffu));
        alt_printf("==== CONFORMANCE: %x FAIL ====\n", fail_count);
    }

    while (1) {
        ;
    }

    return 0;
}
