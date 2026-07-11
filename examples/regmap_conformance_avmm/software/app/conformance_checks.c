/*
 * conformance_checks.c -- register access-type conformance self-test.
 *
 * Portable, bus/CPU-agnostic: walks the same check sequence already proven
 * green on GHDL by tb/regmap_conformance_test.py and via System Console
 * (../../altera/debug/conformance_sysconsole.tcl), using only the
 * platform_reg_read/platform_reg_write/platform_report/platform_settle HAL
 * declared in conformance_checks.h. See that header for why this file must
 * stay platform-independent.
 */

#include "conformance_checks.h"

#define REG_ID           0x00u
#define REG_SCRATCH      0x04u
#define REG_STIMULUS     0x08u
#define REG_STATUS       0x0Cu
#define REG_INT_STATUS   0x10u
#define REG_IRQ_LEGACY   0x14u
#define REG_COMMAND      0x18u
#define REG_BUSY         0x1Cu
#define REG_DIAG         0x20u
#define REG_WO_MIRROR    0x24u
#define REG_LINK         0x28u
#define REG_CONTROL      0x2Cu
#define REG_CHANNEL_0_CONFIG 0x30u
#define REG_CHANNEL_0_COUNT  0x34u
#define REG_CHANNEL_1_CONFIG 0x40u
#define REG_CHANNEL_1_COUNT  0x44u

/* STIMULUS bit positions -- must match regmap_conformance.mm.yml */
#define STIM_STATUS_VAL(v)      ((uint32_t)(v) & 0xFu)
#define STIM_SAMPLE_EVT_TRIG    (1u << 4)
#define STIM_ERROR_EVT_TRIG     (1u << 5)
#define STIM_LEGACY_TRIG        (1u << 6)
#define STIM_CMD_DONE_TRIG      (1u << 7)
#define STIM_BUSY_DONE_TRIG     (1u << 8)
#define STIM_LINK_SPEED(v)      (((uint32_t)(v) & 0xFu) << 9)

#define ID_MAGIC 0xC0FFEE01u

static uint32_t rd(uint32_t off)
{
    return platform_reg_read(off);
}

static void wr(uint32_t off, uint32_t val)
{
    platform_reg_write(off, val);
}

static uint32_t g_fail_count;

static void check(const char *name, int pass)
{
    platform_report(name, pass);
    if (!pass) {
        g_fail_count++;
    }
}

uint32_t run_conformance_checks(void)
{
    uint32_t val;

    g_fail_count = 0;

    /* ID -- read-only constant readback */
    val = rd(REG_ID);
    check("id_readonly", val == ID_MAGIC);
    wr(REG_ID, 0xFFFFFFFFu);
    platform_settle();
    val = rd(REG_ID);
    check("id_readonly_write_noop", val == ID_MAGIC);

    /* SCRATCH -- plain RW round trip */
    wr(REG_SCRATCH, 0xA5A5A5A5u);
    val = rd(REG_SCRATCH);
    check("scratch_rw_roundtrip", val == 0xA5A5A5A5u);

    /* SCRATCH -- byte strobe (byte lane 1 only) */
    wr(REG_SCRATCH, 0x11223344u);
    platform_reg_write(REG_SCRATCH, 0x0000FF00u);
    val = rd(REG_SCRATCH);
    /* platform_reg_write always strobes all 4 lanes on this HAL -- a true
     * byte-strobe check needs a bus master that exposes partial-write
     * control (proven separately by the cocotb gate and System Console).
     * This call intentionally overwrites the whole word; the check
     * documents that fact. */
    check("scratch_full_word_overwrite", val == 0x0000FF00u);

    /* STATUS -- RO live value sourced from STIMULUS via the loopback core */
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA));
    platform_settle();
    val = rd(REG_STATUS);
    check("status_tracks_stimulus", val == 0xA);

    /* INT_STATUS -- HW pulse-set, SW W1C clear */
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_SAMPLE_EVT_TRIG);
    platform_settle();
    val = rd(REG_INT_STATUS);
    check("int_status_hw_set", (val & 0x1u) != 0);
    wr(REG_INT_STATUS, 0x1u);
    platform_settle();
    val = rd(REG_INT_STATUS);
    check("int_status_sw_clear", (val & 0x1u) == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA));
    platform_settle();

    /* INT_STATUS -- HW-set beats a back-to-back SW-clear attempt */
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_SAMPLE_EVT_TRIG);
    wr(REG_INT_STATUS, 0x1u); /* clear attempt, issued immediately after */
    platform_settle();
    val = rd(REG_INT_STATUS);
    check("int_status_hw_set_beats_sw_clear", (val & 0x1u) != 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA));
    wr(REG_INT_STATUS, 0x1u);
    platform_settle();

    /* IRQ_LEGACY -- plain (non-readable) W1C */
    val = rd(REG_IRQ_LEGACY);
    check("irq_legacy_reads_zero_initial", val == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_LEGACY_TRIG);
    platform_settle();
    val = rd(REG_IRQ_LEGACY);
    check("irq_legacy_not_readable", val == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA));
    wr(REG_IRQ_LEGACY, 0x1u);
    platform_settle();

    /* COMMAND -- write-self-clearing, non-readable */
    wr(REG_COMMAND, 0x1u);
    val = rd(REG_COMMAND);
    check("command_not_readable", val == 0);

    /* BUSY -- read-write-self-clearing (readable while set) */
    wr(REG_BUSY, 0x1u);
    val = rd(REG_BUSY);
    check("busy_readable_while_set", val == 1);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_BUSY_DONE_TRIG);
    platform_settle();
    val = rd(REG_BUSY);
    check("busy_hw_self_clear", val == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA));
    platform_settle();

    /* BUSY -- HW-clear beats a back-to-back SW-set attempt */
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_BUSY_DONE_TRIG);
    wr(REG_BUSY, 0x1u); /* set attempt, issued immediately after */
    platform_settle();
    val = rd(REG_BUSY);
    check("busy_hw_clear_beats_sw_set", val == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA));
    platform_settle();

    /* DIAG / WO_MIRROR -- write-only value reaches hardware via RO echo */
    wr(REG_DIAG, 0xABu);
    val = rd(REG_DIAG);
    check("diag_write_only_reads_zero", val == 0);
    platform_settle();
    val = rd(REG_WO_MIRROR);
    check("wo_mirror_echoes_diag", val == 0xABu);

    /* LINK -- mixed register, monitorChangeOf SPEED */
    val = rd(REG_LINK);
    check("link_no_spurious_cos_at_reset", val == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_LINK_SPEED(5));
    platform_settle();
    val = rd(REG_LINK);
    check("link_speed_tracks_stimulus", (val & 0xFu) == 5);
    check("link_speed_changed_set", ((val >> 8) & 0x1u) != 0);
    wr(REG_LINK, 0x1u << 8);
    platform_settle();
    val = rd(REG_LINK);
    check("link_speed_changed_cleared", ((val >> 8) & 0x1u) == 0);
    wr(REG_STIMULUS, STIM_STATUS_VAL(0xA) | STIM_LINK_SPEED(5));
    platform_settle();
    val = rd(REG_LINK);
    check("link_no_event_on_unchanged_value", ((val >> 8) & 0x1u) == 0);

    /* CONTROL -- enumerated field + non-zero reset value */
    val = rd(REG_CONTROL);
    check("control_nonzero_reset", val == 1);
    wr(REG_CONTROL, 3);
    val = rd(REG_CONTROL);
    check("control_enum_write", val == 3);

    /* CHANNEL array -- addressing + no-aliasing */
    val = rd(REG_CHANNEL_0_COUNT);
    check("channel0_count_distinct", val == 0x11u);
    val = rd(REG_CHANNEL_1_COUNT);
    check("channel1_count_distinct", val == 0x22u);
    wr(REG_CHANNEL_0_CONFIG, 0x55u);
    wr(REG_CHANNEL_1_CONFIG, 0xAAu);
    val = rd(REG_CHANNEL_0_CONFIG);
    check("channel0_config_rw", val == 0x55u);
    val = rd(REG_CHANNEL_1_CONFIG);
    check("channel1_config_not_aliased", val == 0xAAu);

    return g_fail_count;
}
