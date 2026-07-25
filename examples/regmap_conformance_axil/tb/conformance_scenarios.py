"""Transport-independent DE10-Nano register-conformance scenarios.

Both cocotb and the System Console hardware runner call
``run_conformance_scenarios``. Register identity, layout, masks, reset values,
and access policy come from IPCraft's generated verification manifest through
``RegisterModel``; only the transport and settling callback differ.
"""

import random


DEFAULT_RANDOM_SEED = 0x177


def _register(model, name):
    try:
        return next(reg for reg in model.registers if reg["name"] == name)
    except StopIteration as error:
        raise KeyError("verification manifest has no register named {}".format(name)) from error


def _field(reg, name):
    try:
        return next(field for field in reg["fields"] if field["name"] == name)
    except StopIteration as error:
        raise KeyError(
            "verification manifest has no field named {}.{}".format(reg["name"], name)
        ) from error


def _field_value(reg, name, value):
    field = _field(reg, name)
    return (value << field["bitOffset"]) & field["mask"]


class _ProgressContext:
    """Bundles the check-result sink with the board-only TEST_PROGRESS LED
    write: every recorded check advances a 0-based counter written to
    TEST_PROGRESS.COUNT (blinks steadily on the board), and the first
    failing check also sets TEST_PROGRESS.FAILED (blinks faster and, since
    a failure raises and stops the suite, freezes there)."""

    def __init__(self, transport, results, progress_offset):
        self.transport = transport
        self.results = results
        self.progress_offset = progress_offset
        self.index = 0

    async def advance(self, failed):
        if self.progress_offset is not None:
            value = (0x100 if failed else 0) | (self.index & 0xFF)
            await self.transport.write(self.progress_offset, value)
        self.index += 1


async def _record_check(ctx, name, actual, expected, mask=0xFFFFFFFF):
    actual_masked = actual & mask
    expected_masked = expected & mask
    passed = actual_masked == expected_masked
    result = {
        "name": name,
        "status": "pass" if passed else "fail",
        "actual": actual_masked,
        "expected": expected_masked,
        "mask": mask,
    }
    ctx.results.append(result)
    await ctx.advance(failed=not passed)
    if not passed:
        raise AssertionError(
            "{}: expected 0x{:08X} under mask 0x{:08X}, got 0x{:08X}".format(
                name, expected_masked, mask, actual_masked
            )
        )


async def _record_not_applicable(ctx, name, reason):
    ctx.results.append({"name": name, "status": "notApplicable", "reason": reason})
    await ctx.advance(failed=False)


async def run_conformance_scenarios(
    transport,
    model,
    reset,
    settle,
    seed=DEFAULT_RANDOM_SEED,
    results=None,
):
    """Run the shared directed and deterministic-randomized transaction suite."""
    if results is None:
        results = []
    await reset()
    model.reset()

    try:
        progress_offset = _register(model, "TEST_PROGRESS")["offset"]
    except KeyError:
        progress_offset = None
    ctx = _ProgressContext(transport, results, progress_offset)

    id_reg = _register(model, "ID")
    scratch = _register(model, "SCRATCH")
    stimulus = _register(model, "STIMULUS")
    status = _register(model, "STATUS")
    int_status = _register(model, "INT_STATUS")
    irq_legacy = _register(model, "IRQ_LEGACY")
    command = _register(model, "COMMAND")
    busy = _register(model, "BUSY")
    diag = _register(model, "DIAG")
    wo_mirror = _register(model, "WO_MIRROR")
    link = _register(model, "LINK")
    control = _register(model, "CONTROL")
    channel_0_config = _register(model, "CHANNEL_0_CONFIG")
    channel_0_count = _register(model, "CHANNEL_0_COUNT")
    channel_1_config = _register(model, "CHANNEL_1_CONFIG")
    channel_1_count = _register(model, "CHANNEL_1_COUNT")
    heartbeat = _register(model, "HEARTBEAT_STATUS")

    id_expected = model.expected_read(id_reg["offset"])
    await _record_check(ctx, "build_id", await transport.read(id_reg["offset"]), id_expected)
    await transport.write(id_reg["offset"], 0xFFFFFFFF)
    await _record_check(
        ctx,
        "build_id_read_only",
        await transport.read(id_reg["offset"]),
        id_expected,
    )

    await transport.write(scratch["offset"], 0xA5A5A5A5)
    model.apply_write(scratch["offset"], 0xA5A5A5A5)
    await _record_check(
        ctx,
        "scratch_rw_roundtrip",
        await transport.read(scratch["offset"]),
        model.expected_read(scratch["offset"]),
    )

    await transport.write(scratch["offset"], 0x11223344)
    model.apply_write(scratch["offset"], 0x11223344)
    if getattr(transport, "supports_byte_enable", True):
        await transport.write(scratch["offset"], 0x0000FF00, byte_enable=0x2)
        model.apply_write(scratch["offset"], 0x0000FF00, byte_enable=0x2)
        await _record_check(
            ctx,
            "scratch_byte_enable",
            await transport.read(scratch["offset"]),
            model.expected_read(scratch["offset"]),
        )
    else:
        await _record_not_applicable(
            ctx,
            "scratch_byte_enable",
            "This generator's AXI4-Lite address decode does not word-align "
            "AWADDR before comparing against register offsets, so a "
            "non-zero-lane byte-strobe write is silently dropped (see "
            "docs/hardware_validation_results.md finding 4)",
        )

    status_word = _field_value(stimulus, "STATUS_VAL", 0xA)
    await transport.write(stimulus["offset"], status_word)
    await settle()
    await _record_check(
        ctx,
        "read_only_status",
        await transport.read(status["offset"]),
        0xA,
        _field(status, "VALUE")["mask"],
    )

    sample_trigger = _field_value(stimulus, "SAMPLE_EVT_TRIG", 1)
    await transport.write(stimulus["offset"], status_word | sample_trigger)
    await settle()
    sample_mask = _field(int_status, "SAMPLE_EVT")["mask"]
    await _record_check(
        ctx,
        "w1c_hardware_set",
        await transport.read(int_status["offset"]),
        sample_mask,
        sample_mask,
    )
    await transport.write(int_status["offset"], sample_mask)
    await settle()
    await _record_check(
        ctx,
        "w1c_software_clear",
        await transport.read(int_status["offset"]),
        0,
        sample_mask,
    )
    await transport.write(stimulus["offset"], status_word)

    if transport.supports_priority_races:
        await transport.write_sequence(
            [
                (stimulus["offset"], status_word | sample_trigger, None),
                (int_status["offset"], sample_mask, None),
            ]
        )
        await settle()
        await _record_check(
            ctx,
            "w1c_hardware_set_priority",
            await transport.read(int_status["offset"]),
            sample_mask,
            sample_mask,
        )
        await transport.write(stimulus["offset"], status_word)
        await transport.write(int_status["offset"], sample_mask)
    else:
        await _record_not_applicable(
            ctx,
            "w1c_hardware_set_priority",
            "JTAG-to-Avalon serializes transactions and cannot issue adjacent bus cycles",
        )

    legacy_mask = _field(irq_legacy, "FLAG")["mask"]
    legacy_trigger = _field_value(stimulus, "LEGACY_TRIG", 1)
    await transport.write(stimulus["offset"], status_word | legacy_trigger)
    await settle()
    await _record_check(
        ctx,
        "write_only_w1c_read_policy",
        await transport.read(irq_legacy["offset"]),
        0,
        legacy_mask,
    )
    await transport.write(stimulus["offset"], status_word)
    await transport.write(irq_legacy["offset"], legacy_mask)

    command_mask = _field(command, "START")["mask"]
    await transport.write(command["offset"], command_mask)
    await _record_check(
        ctx,
        "write_self_clearing_read_policy",
        await transport.read(command["offset"]),
        0,
        command_mask,
    )

    busy_mask = _field(busy, "ACTIVE")["mask"]
    await transport.write(busy["offset"], busy_mask)
    await _record_check(
        ctx,
        "read_write_self_clearing_set",
        await transport.read(busy["offset"]),
        busy_mask,
        busy_mask,
    )
    busy_trigger = _field_value(stimulus, "BUSY_DONE_TRIG", 1)
    await transport.write(stimulus["offset"], status_word | busy_trigger)
    await settle()
    await _record_check(
        ctx,
        "read_write_self_clearing_hardware_clear",
        await transport.read(busy["offset"]),
        0,
        busy_mask,
    )
    await transport.write(stimulus["offset"], status_word)

    if transport.supports_priority_races:
        await transport.write_sequence(
            [
                (stimulus["offset"], status_word | busy_trigger, None),
                (busy["offset"], busy_mask, None),
            ]
        )
        await settle()
        await _record_check(
            ctx,
            "self_clearing_hardware_clear_priority",
            await transport.read(busy["offset"]),
            0,
            busy_mask,
        )
        await transport.write(stimulus["offset"], status_word)
    else:
        await _record_not_applicable(
            ctx,
            "self_clearing_hardware_clear_priority",
            "JTAG-to-Avalon serializes transactions and cannot issue adjacent bus cycles",
        )

    diag_mask = _field(diag, "SCRATCH")["mask"]
    await transport.write(diag["offset"], 0xAB)
    await _record_check(
        ctx,
        "write_only_read_policy",
        await transport.read(diag["offset"]),
        0,
        diag_mask,
    )
    await settle()
    await _record_check(
        ctx,
        "write_only_hardware_observation",
        await transport.read(wo_mirror["offset"]),
        0xAB,
        _field(wo_mirror, "SCRATCH")["mask"],
    )

    speed_word = status_word | _field_value(stimulus, "LINK_SPEED", 5)
    await transport.write(stimulus["offset"], speed_word)
    await settle()
    link_value = await transport.read(link["offset"])
    await _record_check(
        ctx,
        "mixed_register_read_only_field",
        link_value,
        _field_value(link, "SPEED", 5),
        _field(link, "SPEED")["mask"],
    )
    changed_mask = _field(link, "SPEED_CHANGED")["mask"]
    await _record_check(
        ctx,
        "monitor_change_of_set",
        link_value,
        changed_mask,
        changed_mask,
    )
    await transport.write(link["offset"], changed_mask)
    await settle()
    await _record_check(
        ctx,
        "monitor_change_of_clear",
        await transport.read(link["offset"]),
        0,
        changed_mask,
    )

    await _record_check(
        ctx,
        "nonzero_reset",
        await transport.read(control["offset"]),
        model.expected_read(control["offset"]),
    )
    await transport.write(control["offset"], 3)
    model.apply_write(control["offset"], 3)
    await _record_check(
        ctx,
        "enumerated_rw",
        await transport.read(control["offset"]),
        model.expected_read(control["offset"]),
    )

    await _record_check(
        ctx,
        "array_element_0_status",
        await transport.read(channel_0_count["offset"]),
        0x11,
        _field(channel_0_count, "SAMPLES")["mask"],
    )
    await _record_check(
        ctx,
        "array_element_1_status",
        await transport.read(channel_1_count["offset"]),
        0x22,
        _field(channel_1_count, "SAMPLES")["mask"],
    )
    await transport.write(channel_0_config["offset"], 0x55)
    model.apply_write(channel_0_config["offset"], 0x55)
    await transport.write(channel_1_config["offset"], 0xAA)
    model.apply_write(channel_1_config["offset"], 0xAA)
    await _record_check(
        ctx,
        "array_element_0_rw",
        await transport.read(channel_0_config["offset"]),
        model.expected_read(channel_0_config["offset"]),
    )
    await _record_check(
        ctx,
        "array_element_1_no_alias",
        await transport.read(channel_1_config["offset"]),
        model.expected_read(channel_1_config["offset"]),
    )

    alive_mask = _field(heartbeat, "WATCHDOG_ALIVE")["mask"]
    counter_mask = _field(heartbeat, "COUNTER")["mask"]
    heartbeat_before = await transport.read(heartbeat["offset"])
    await settle(32)
    heartbeat_after = await transport.read(heartbeat["offset"])
    await _record_check(
        ctx,
        "watchdog_alive",
        heartbeat_after,
        alive_mask,
        alive_mask,
    )
    counter_advanced = (heartbeat_before & counter_mask) != (heartbeat_after & counter_mask)
    await _record_check(ctx, "heartbeat_advances", int(counter_advanced), 1, 1)

    rng = random.Random(seed)
    random_registers = [scratch, control, channel_0_config, channel_1_config]
    for step in range(16):
        reg = rng.choice(random_registers)
        value = rng.getrandbits(model.data_width)
        await transport.write(reg["offset"], value)
        model.apply_write(reg["offset"], value)
        await _record_check(
            ctx,
            "random_seed_0x{:X}_step_{}_{}".format(seed, step, reg["name"]),
            await transport.read(reg["offset"]),
            model.expected_read(reg["offset"]),
        )

    unmapped_offset = max(reg["offset"] for reg in model.registers) + model.lane_count
    if getattr(transport, "supports_unmapped_read_zero", True):
        await _record_check(
            ctx,
            "unmapped_read_zero",
            await transport.read(unmapped_offset),
            0,
        )
    else:
        await _record_not_applicable(
            ctx,
            "unmapped_read_zero",
            "Bus returns an error response (not a defined zero value) for unmapped reads",
        )

    return results
