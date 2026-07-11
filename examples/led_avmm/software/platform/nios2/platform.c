/*
 * platform.c -- Nios II bare-metal HAL for ../../app/led_demo.c.
 *
 * H2F Lightweight bridge base : 0xFF200000 (2 MB window) on HPS designs --
 * not used here (this is the Nios II/no-HPS system); LED_CTRL_BASE comes
 * from the qsys-assigned Avalon-MM address in system.h.
 */

#include "system.h"
#include "io.h"
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
    volatile uint32_t i, j;
    for (i = 0; i < ms; i++) {
        for (j = 0; j < 320; j++) {
            ;
        }
    }
}
