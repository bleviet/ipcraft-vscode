/*
 * platform.c -- Nios II bare-metal HAL for ../../app/conformance_checks.c.
 *
 * Implements the four platform_* primitives the portable check sequence is
 * written against, using IOWR_32DIRECT/IORD_32DIRECT (no HAL driver exists
 * for a hand-authored Platform Designer component -- these poke the
 * register file directly by byte offset) and alt_printf for reporting.
 *
 * Uses alt_printf (not printf) -- newlib's printf overflows the 32 KB
 * on-chip RAM (cvsoc/16_ipcraft_led_avmm bring-up, bug #8 of the LED
 * series). alt_printf supports only %x, %s, %c, %%.
 */

#include "system.h"
#include "io.h"
#include "sys/alt_stdio.h"
#include "../../app/conformance_checks.h"

uint32_t platform_reg_read(uint32_t byte_offset)
{
    return IORD_32DIRECT(REGMAP_CTRL_BASE, byte_offset);
}

void platform_reg_write(uint32_t byte_offset, uint32_t value)
{
    IOWR_32DIRECT(REGMAP_CTRL_BASE, byte_offset, value);
}

void platform_report(const char *name, int pass)
{
    if (pass) {
        alt_printf("PASS %s\n", name);
    } else {
        alt_printf("FAIL %s\n", name);
    }
}

void platform_settle(void)
{
    /* A handful of NOP-ish iterations is enough headroom for the write ->
     * regs.vhd -> core -> regs.vhd read-mux chain (3 cycles at simulation
     * scale; a bus round trip on real hardware is comfortably slower than
     * that already). */
    volatile int i;
    for (i = 0; i < 64; i++) {
        ;
    }
}
