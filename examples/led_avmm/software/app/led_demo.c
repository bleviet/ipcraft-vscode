/*
 * led_demo.c -- LED animation demo for the IPCraft-generated
 * led_controller_avmm peripheral.
 *
 * Portable, bus/CPU-agnostic: uses only the platform_reg_read/
 * platform_reg_write/platform_delay_ms HAL declared in led_demo.h. See that
 * header for why this file must stay platform-independent.
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
 * Keep this demo UART-independent so LED behavior is visible even when no
 * terminal session is attached.
 */

#include "led_demo.h"

#define LED_CTRL_REG_VERSION     0x00u
#define LED_CTRL_REG_LED_PATTERN 0x04u
#define LED_CTRL_REG_EVENTS      0x08u
#define LED_CTRL_EVENTS_HEARTBEAT_TOGGLED (1u << 1)

#define EXPECTED_VERSION 0x00000100u /* MAJOR=1, MINOR=0 */

static const uint8_t patterns[] = {
    0x01, 0x03, 0x07, 0x0F, 0x1F, 0x3F, 0x7F, 0xFF,
    0x7F, 0x3F, 0x1F, 0x0F, 0x07, 0x03, 0x01, 0x00,
    0xAA, 0x55, 0xFF, 0x00,
};

void run_led_demo(void)
{
    uint32_t idx = 0;
    const uint32_t num_patterns = sizeof(patterns) / sizeof(patterns[0]);

    /* Startup self-test: VERSION must match what IPCraft generated. */
    uint32_t version = platform_reg_read(LED_CTRL_REG_VERSION);
    if (version != EXPECTED_VERSION) {
        while (1) {
            platform_reg_write(LED_CTRL_REG_LED_PATTERN, 0xAA);
            platform_delay_ms(150);
            platform_reg_write(LED_CTRL_REG_LED_PATTERN, 0x55);
            platform_delay_ms(150);
        }
    }

    while (1) {
        platform_reg_write(LED_CTRL_REG_LED_PATTERN, patterns[idx]);
        idx = (idx + 1) % num_patterns;
        platform_delay_ms(200);
    }
}
