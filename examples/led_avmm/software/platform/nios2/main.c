/*
 * main.c -- Nios II entry point for the LED animation demo (cvsoc roadmap
 * Phase 2.2, built with IPCraft instead of hand-written VHDL).
 *
 * All demo logic lives in ../../app/led_demo.c (portable across CPU
 * platforms); this file only wires it to the Nios II HAL (platform.c).
 */

#include "../../app/led_demo.h"

int main(void)
{
    run_led_demo();
    return 0;
}
