"""cocotb tests for led_controller_avmm, wrapped as individual pytest functions.

Each function here maps 1-to-1 to a @cocotb.test() in led_controller_avmm_test.py,
so VS Code's Testing panel and ``pytest tb/`` both show them as separate tests.

Run all tests:            pytest tb/
Run one test:             pytest tb/ -k test_register_access
Use a different simulator: SIM=icarus pytest tb/

The HDL is compiled once by the ``sim_runner`` fixture in conftest.py.
"""

def test_register_access(sim_runner):
    """Read/write all registers via the AVMM bus interface."""
    sim_runner("test_register_access")


def test_version_register(sim_runner):
    """VERSION reads back its fixed reset value."""
    sim_runner("test_version_register")


def test_led_pattern_passthrough(sim_runner):
    """LED_PATTERN writes reach both the register and the led port."""
    sim_runner("test_led_pattern_passthrough")


def test_heartbeat_event_w1c(sim_runner):
    """EVENTS.HEARTBEAT_TOGGLED sets on transition and clears on W1C."""
    sim_runner("test_heartbeat_event_w1c")

