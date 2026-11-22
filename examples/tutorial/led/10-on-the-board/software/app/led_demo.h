#ifndef LED_DEMO_H
#define LED_DEMO_H

#include <stdint.h>

/*
 * Platform HAL for the LED animation demo. Written once against these
 * four primitives and reused unchanged by every CPU platform port -- see
 * ../../../../../regmap_conformance_avmm/software/app/conformance_checks.h for
 * the same convention applied to the register-conformance example.
 */
uint32_t platform_reg_read(uint32_t byte_offset);
void platform_reg_write(uint32_t byte_offset, uint32_t value);
void platform_delay_ms(uint32_t ms);
void platform_log(const char *label, uint32_t value);

/*
 * Runs the LED animation demo: a startup VERSION self-test (drives an
 * obvious 0xAA/0x55 fail-safe pattern forever on mismatch), shows 0xA5 for
 * a second, then runs a single lit LED back and forth. Reports over
 * platform_log. Never returns.
 */
void run_led_demo(void);

#endif /* LED_DEMO_H */
