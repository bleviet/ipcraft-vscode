"""pytest fixtures for led_controller_avmm cocotb simulation.

Compatible with cocotb ≥ 1.7 and cocotb 2.x. Each test is run by invoking
``make`` with ``TESTCASE=<name>`` so only the requested ``@cocotb.test()``
function executes. make's dependency tracking recompiles the HDL only when
source files change, so repeated runs reuse the previous build.

Changing the simulator:
    SIM=icarus pytest tb/
    SIM=modelsim pytest tb/
    SIM=questa   pytest tb/
"""

import os
import pathlib
import subprocess
import pytest

TB_DIR = pathlib.Path(__file__).parent
BASE_DIR = TB_DIR.parent

SIM = os.environ.get("SIM", "ghdl")

# RTL sources — from ip.yml fileSets
RTL_SOURCES = [
    BASE_DIR / "rtl/led_controller_avmm_pkg.vhd",
    BASE_DIR / "rtl/led_controller_avmm_regs.vhd",
    BASE_DIR / "rtl/led_controller_avmm_core.vhd",
    BASE_DIR / "rtl/led_controller_avmm_avmm.vhd",
    BASE_DIR / "rtl/led_controller_avmm.vhd",
]


@pytest.fixture(scope="session")
def sim_runner():
    """Return a ``run(testcase)`` callable that drives cocotb via make.

    The first call compiles the HDL; subsequent calls within the same pytest
    session skip recompilation if no source files changed (make dependency
    tracking). Waveform generation is suppressed (``WAVES=0``) for speed;
    set ``WAVES=1`` in the environment to enable it.

    Example usage inside a test::

        def test_my_case(sim_runner):
            sim_runner("test_my_case")
    """
    missing = [str(s) for s in RTL_SOURCES if not s.exists()]
    if missing:
        raise FileNotFoundError(
            "RTL sources not found — run the IPCraft scaffolder first:\n"
            + "\n".join(f"  {s}" for s in missing)
        )

    def run(testcase: str) -> None:
        env = {**os.environ, "TESTCASE": testcase, "WAVES": os.environ.get("WAVES", "0")}
        result = subprocess.run(
            ["make", f"SIM={SIM}"],
            cwd=str(TB_DIR),
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            output = (result.stdout + result.stderr).strip()
            raise AssertionError(
                f"cocotb simulation failed for '{testcase}':\n\n{output[-3000:]}"
            )

    return run
