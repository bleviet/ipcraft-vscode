"""cocotb tests for regmap_conformance, wrapped as individual pytest functions.

Each function here maps 1-to-1 to a @cocotb.test() in regmap_conformance_test.py,
so VS Code's Testing panel and ``pytest tb/`` both show them as separate tests.

Run all tests:            pytest tb/
Run one test:             pytest tb/ -k test_link_change_of_state
Use a different simulator: SIM=icarus pytest tb/

The HDL is compiled once by the ``sim_runner`` fixture in conftest.py.

Hand-written; managed: false in regmap_conformance.ip.yml.
"""


def test_id_readonly(sim_runner):
    """ID reads back its fixed magic constant; writes have no effect."""
    sim_runner("test_id_readonly")


def test_scratch_rw_roundtrip(sim_runner):
    """SCRATCH is a plain RW round-trip register."""
    sim_runner("test_scratch_rw_roundtrip")


def test_scratch_byte_strobe(sim_runner):
    """A byte-strobed write to SCRATCH only alters the strobed lane."""
    sim_runner("test_scratch_byte_strobe")


def test_status_tracks_stimulus(sim_runner):
    """STATUS is RO, sourced live from STIMULUS via the loopback core."""
    sim_runner("test_status_tracks_stimulus")


def test_int_status_hw_set_sw_clear(sim_runner):
    """INT_STATUS: HW pulse sets a bit; SW W1C clears it."""
    sim_runner("test_int_status_hw_set_sw_clear")


def test_int_status_hw_set_beats_sw_clear(sim_runner):
    """INT_STATUS: a concurrent HW-set beats an SW-clear attempt."""
    sim_runner("test_int_status_hw_set_beats_sw_clear")


def test_irq_legacy_not_readable(sim_runner):
    """IRQ_LEGACY is a plain (non-readable) W1C -- always reads 0."""
    sim_runner("test_irq_legacy_not_readable")


def test_command_not_readable(sim_runner):
    """COMMAND is write-self-clearing and non-readable -- always reads 0."""
    sim_runner("test_command_not_readable")


def test_busy_self_clearing_readable(sim_runner):
    """BUSY is read-write-self-clearing: readable while set, HW-cleared."""
    sim_runner("test_busy_self_clearing_readable")


def test_busy_hw_clear_beats_sw_set(sim_runner):
    """BUSY: a concurrent HW-clear beats an SW-set attempt."""
    sim_runner("test_busy_hw_clear_beats_sw_set")


def test_write_only_reaches_hardware(sim_runner):
    """DIAG (write-only) reads 0; WO_MIRROR echoes the value back."""
    sim_runner("test_write_only_reaches_hardware")


def test_link_change_of_state(sim_runner):
    """LINK: mixed register, monitorChangeOf SPEED sets SPEED_CHANGED."""
    sim_runner("test_link_change_of_state")


def test_control_enum_and_nonzero_reset(sim_runner):
    """CONTROL.MODE has a non-zero reset value and an enumerated field."""
    sim_runner("test_control_enum_and_nonzero_reset")


def test_channel_array_no_aliasing(sim_runner):
    """CHANNEL register array: independent per-index storage, no aliasing."""
    sim_runner("test_channel_array_no_aliasing")
