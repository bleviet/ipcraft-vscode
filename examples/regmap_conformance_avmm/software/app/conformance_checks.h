#ifndef CONFORMANCE_CHECKS_H
#define CONFORMANCE_CHECKS_H

#include <stdint.h>

/*
 * Platform HAL for the register access-type conformance self-test.
 *
 * This is the single source of truth for the conformance check sequence
 * (docs/hardware-conformance-test-plan.md, "Component 3" -- the bare-metal
 * host). It is written once here, against these four primitives, and
 * reused unchanged by every CPU platform port. Porting to a new CPU (e.g.
 * an Arm Cortex-A/M target) means implementing this HAL in
 * software/platform/<name>/ -- not rewriting the check sequence.
 */

/* Read/write a 32-bit register at the given byte offset from the IP's base
 * address. The base address itself is a platform/board concern (e.g. a
 * qsys-assigned Avalon-MM address, or an HPS bridge physical address) --
 * out of scope for this HAL. */
uint32_t platform_reg_read(uint32_t byte_offset);
void platform_reg_write(uint32_t byte_offset, uint32_t value);

/* Report one PASS/FAIL check result, however the platform surfaces it
 * (JTAG UART, semihosting, etc.). */
void platform_report(const char *name, int pass);

/* Settle delay: headroom for the write -> regs.vhd -> core -> regs.vhd
 * read-mux chain (a two-hop record chain) to propagate before the next
 * read. Implemented per-platform since the right primitive (a few
 * busy-loop iterations, a cycle-accurate delay, etc.) is platform-specific. */
void platform_settle(void);

/* Runs the full register access-type conformance sequence via the HAL
 * above. Returns the number of failed checks (0 = ALL PASS). */
uint32_t run_conformance_checks(void);

#endif /* CONFORMANCE_CHECKS_H */
