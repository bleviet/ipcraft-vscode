/*
 * led_demo.c -- LED animation demo for the IPCraft-generated
 * led_controller_avmm peripheral.
 *
 * Portable, bus/CPU-agnostic: uses only the platform_reg_read/
 * platform_reg_write/platform_delay_ms/platform_log HAL declared in
 * led_demo.h. See that header for why this file must stay
 * platform-independent.
 *
 * Unlike a stock altera_avalon_pio component, a hand-authored Platform
 * Designer component has no matching HAL
 * register-access header, so registers are poked directly by byte offset.
 * Offsets match led_controller_avmm.mm.yml:
 *   0x00 VERSION       (read-only)
 *   0x04 LED_PATTERN   (read-write)
 *   0x08 EVENTS        (read-write-1-to-clear: bit0 HEARTBEAT_ACTIVE,
 *                        bit1 HEARTBEAT_TOGGLED)
 *
 * The LEDs show the demo even when no terminal is attached; the log lines
 * only appear when a JTAG UART terminal is open. They are printed a handful
 * of times, not per step, so a full output FIFO never stalls the animation.
 */

#include "led_demo.h"

#define LED_CTRL_REG_VERSION     0x00u
#define LED_CTRL_REG_LED_PATTERN 0x04u
#define LED_CTRL_REG_EVENTS      0x08u

#define EXPECTED_VERSION 0x00000100u /* MAJOR=1, MINOR=0 */

#define STEP_MS 120u

static void show(uint32_t pattern)
{
    platform_reg_write(LED_CTRL_REG_LED_PATTERN, pattern);
}

void run_led_demo(void)
{
    /* Startup self-test: VERSION must match what IPCraft generated. */
    uint32_t version = platform_reg_read(LED_CTRL_REG_VERSION);
    platform_log("led_demo VERSION", version);
    if (version != EXPECTED_VERSION) {
        platform_log("led_demo FAIL, expected VERSION", EXPECTED_VERSION);
        while (1) {
            show(0xAA);
            platform_delay_ms(150);
            show(0x55);
            platform_delay_ms(150);
        }
    }

    /* A fixed pattern first, read back through the bus. */
    show(0xA5);
    platform_log("led_demo LED_PATTERN", platform_reg_read(LED_CTRL_REG_LED_PATTERN));
    platform_delay_ms(1000);

    /* Then one lit LED runs back and forth, forever. */
    platform_log("led_demo running light, EVENTS", platform_reg_read(LED_CTRL_REG_EVENTS));
    while (1) {
        uint32_t pos;
        for (pos = 0; pos < 7; pos++) {
            show(1u << pos);
            platform_delay_ms(STEP_MS);
        }
        for (pos = 7; pos > 0; pos--) {
            show(1u << pos);
            platform_delay_ms(STEP_MS);
        }
    }
}
