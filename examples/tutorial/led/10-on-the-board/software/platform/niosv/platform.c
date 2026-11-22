/*
 * platform.c -- Nios V/m bare-metal HAL for ../../app/led_demo.c.
 *
 * LED_CTRL_BASE comes from the Platform Designer address map via the BSP's
 * system.h (0x00010010 in the led_avmm_system*.tcl scripts). A hand-authored
 * Platform Designer component has no HAL driver, so the registers are
 * accessed directly by byte offset with IORD_32DIRECT / IOWR_32DIRECT.
 *
 * Output uses alt_printf, not printf: newlib's printf overflows the small
 * on-chip RAM. alt_printf supports only %x, %s, %c and %%.
 */

#include <unistd.h>
#include "system.h"
#include "io.h"
#include "sys/alt_stdio.h"
#include "../../app/led_demo.h"

uint32_t platform_reg_read(uint32_t byte_offset)
{
    return IORD_32DIRECT(LED_CTRL_BASE, byte_offset);
}

void platform_reg_write(uint32_t byte_offset, uint32_t value)
{
    IOWR_32DIRECT(LED_CTRL_BASE, byte_offset, value);
}

void platform_delay_ms(uint32_t ms)
{
    usleep(ms * 1000u);
}

void platform_log(const char *label, uint32_t value)
{
    alt_printf("%s 0x%x\n", label, (unsigned int)value);
}
