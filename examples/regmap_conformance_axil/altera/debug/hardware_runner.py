#!/usr/bin/env python3
"""Manifest-driven DE10-Nano register verification through System Console.

AXI4-Lite variant of regmap_conformance_avmm's hardware_runner.py -- same
JTAG-to-Avalon-MM System Console transport, since Platform Designer's
Avalon<->AXI4 bridge makes the two indistinguishable to this master. Only
SystemConsoleTransport.supports_unmapped_read_zero differs: an unmapped
AXI4-Lite read returns SLVERR, not a defined zero value, so that one check is
not_applicable here (see conformance_scenarios.py).
"""

import argparse
import asyncio
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone


EXAMPLE_DIR = pathlib.Path(__file__).resolve().parents[2]
REPO_DIR = pathlib.Path(__file__).resolve().parents[4]
TB_DIR = EXAMPLE_DIR / "tb"
sys.path.insert(0, str(TB_DIR))

from conformance_scenarios import DEFAULT_RANDOM_SEED, run_conformance_scenarios
from register_model import RegisterModel, load_manifest


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _sha256(path):
    digest = hashlib.sha256()
    with open(str(path), "rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run(command, cwd=None):
    completed = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
    )
    return completed.stdout.strip()


class SystemConsoleTransport:
    """One-shot Tcl bridge from the shared scenarios to JTAG-to-Avalon-MM."""

    def __init__(self, executable, base_address, timeout):
        self.executable = executable
        self.base_address = base_address
        self.timeout = timeout
        self.master_path = None
        self.supports_priority_races = False
        self.supports_unmapped_read_zero = False
        self.supports_byte_enable = False

    def connect(self):
        response = self._run_tcl(
            """
set paths [get_service_paths master]
if {[llength $paths] == 0} {
    puts "@@ERROR no JTAG-to-Avalon master service found"
} else {
    puts "@@MASTER [lindex $paths 0]"
}
puts "@@END"
"""
        )
        for line in response.splitlines():
            if line.startswith("@@MASTER "):
                self.master_path = line[len("@@MASTER ") :].strip().strip("{}")
                return self.master_path
            if line.startswith("@@ERROR "):
                raise ConnectionError(line[len("@@ERROR ") :])
        raise ConnectionError("System Console did not report a JTAG master service")

    async def read(self, offset):
        return self._read(offset)

    async def write(self, offset, value, byte_enable=None):
        self._write_sequence([(offset, value, byte_enable)])

    async def write_sequence(self, writes):
        self._write_sequence(writes)

    def _read(self, offset):
        self._require_connection()
        address = self.base_address + offset
        response = self._run_tcl(
            """
set masterPath {{{master_path}}}
if {{[catch {{
    open_service master $masterPath
    set value [lindex [master_read_32 $masterPath {address} 1] 0]
    close_service master $masterPath
    puts [format "@@VALUE 0x%08X" $value]
}} message]}} {{
    catch {{close_service master $masterPath}}
    puts "@@ERROR $message"
}}
puts "@@END"
""".format(master_path=self.master_path, address=address)
        )
        for line in response.splitlines():
            if line.startswith("@@VALUE "):
                return int(line[len("@@VALUE ") :], 0)
            if line.startswith("@@ERROR "):
                raise IOError(line[len("@@ERROR ") :])
        raise IOError("System Console read produced no value")

    def _write_sequence(self, writes):
        self._require_connection()
        commands = []
        for offset, value, byte_enable in writes:
            address = self.base_address + offset
            if byte_enable is None or byte_enable == 0xF:
                commands.append(
                    "master_write_32 $masterPath {} [list {}]".format(address, value)
                )
                continue
            for lane in range(4):
                if byte_enable & (1 << lane):
                    lane_value = (value >> (lane * 8)) & 0xFF
                    commands.append(
                        "master_write_8 $masterPath {} [list {}]".format(
                            address + lane, lane_value
                        )
                    )
        command_text = "\n    ".join(commands)
        response = self._run_tcl(
            """
set masterPath {{{master_path}}}
if {{[catch {{
    open_service master $masterPath
    {commands}
    close_service master $masterPath
    puts "@@WROTE"
}} message]}} {{
    catch {{close_service master $masterPath}}
    puts "@@ERROR $message"
}}
puts "@@END"
""".format(master_path=self.master_path, commands=command_text)
        )
        if "@@WROTE" in response:
            return
        error = next(
            (line[len("@@ERROR ") :] for line in response.splitlines() if line.startswith("@@ERROR ")),
            "System Console write did not complete",
        )
        raise IOError(error)

    def _run_tcl(self, script):
        with tempfile.NamedTemporaryFile("w", suffix=".tcl") as script_file:
            script_file.write(script)
            script_file.flush()
            completed = subprocess.run(
                [self.executable, "--cli"],
                input="source {{{}}}\n".format(script_file.name),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                timeout=self.timeout,
            )
        output = completed.stdout + completed.stderr
        marker_lines = []
        for line in output.splitlines():
            stripped = line.strip()
            if stripped.startswith("% "):
                stripped = stripped[2:]
            if stripped.startswith(
                ("@@MASTER ", "@@VALUE ", "@@WROTE", "@@ERROR ", "@@END")
            ):
                marker_lines.append(stripped)
        if completed.returncode != 0:
            raise RuntimeError(
                "System Console exited with code {}: {}".format(
                    completed.returncode, output[-1000:]
                )
            )
        return "\n".join(marker_lines)

    def _require_connection(self):
        if not self.master_path:
            raise ConnectionError("System Console transport is not connected")


def _parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    # regmap_conformance_axil_system.tcl connects jtag_debug_master straight to
    # the AXI4-Lite slave at 0x0 -- no Nios2/onchip_mem sharing the address
    # map the way regmap_conformance_avmm does, hence the different default
    # from that example's hardware_runner.py (0x00010000).
    parser.add_argument("--base-address", type=lambda value: int(value, 0), default=0x00000000)
    parser.add_argument(
        "--manifest",
        type=pathlib.Path,
        default=TB_DIR / "verification_manifest.json",
    )
    parser.add_argument(
        "--bitstream",
        type=pathlib.Path,
        default=EXAMPLE_DIR / "altera" / "quartus" / "de10_nano.sof",
    )
    parser.add_argument(
        "--result",
        type=pathlib.Path,
        default=EXAMPLE_DIR / "altera" / "quartus" / "output_files" / "hardware-result.json",
    )
    parser.add_argument("--board-id", default=None)
    parser.add_argument("--repo", type=pathlib.Path, default=REPO_DIR)
    parser.add_argument("--seed", type=lambda value: int(value, 0), default=DEFAULT_RANDOM_SEED)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--system-console", default="system-console")
    return parser.parse_args()


async def _run_hardware(args, result):
    if shutil.which(args.system_console) is None:
        raise FileNotFoundError("required tool not found: {}".format(args.system_console))
    if not args.manifest.is_file():
        raise FileNotFoundError("verification manifest not found: {}".format(args.manifest))
    if not args.bitstream.is_file():
        raise FileNotFoundError("compiled bitstream not found: {}".format(args.bitstream))

    manifest = load_manifest(args.manifest)
    model = RegisterModel(manifest)
    transport = SystemConsoleTransport(args.system_console, args.base_address, args.timeout)
    master_path = transport.connect()
    result["boardIdentity"] = args.board_id or master_path

    async def reset():
        # The Makefile programs the SOF immediately before invoking this
        # process, so the first scenario observes a fresh hardware reset.
        return None

    async def settle(cycles=3):
        time.sleep(max(cycles / 50000000, 0.001))

    checks = []
    result["checks"] = checks
    await run_conformance_scenarios(
        transport,
        model,
        reset,
        settle,
        args.seed,
        checks,
    )
    id_check = next(check for check in checks if check["name"] == "build_id")
    result["buildId"] = {
        "actual": id_check["actual"],
        "expected": id_check["expected"],
    }


def main():
    args = _parse_args()
    started = time.monotonic()
    result = {
        "schemaVersion": 1,
        "status": "running",
        "startedAt": _utc_now(),
        "gitCommit": None,
        "gitDirty": None,
        "generatorVersion": None,
        "quartusVersion": None,
        "bitstreamSha256": None,
        "manifestSha256": None,
        "boardIdentity": None,
        "randomSeed": args.seed,
        "randomSeedHex": "0x{:X}".format(args.seed),
        "checks": [],
    }

    try:
        result["gitCommit"] = _run(["git", "rev-parse", "HEAD"], args.repo)
        result["gitDirty"] = bool(_run(["git", "status", "--porcelain"], args.repo))
        with open(str(args.repo / "package.json"), encoding="utf-8") as package_file:
            result["generatorVersion"] = json.load(package_file)["version"]
        result["quartusVersion"] = _run(["quartus_sh", "--version"]).splitlines()[0]
        result["bitstreamSha256"] = _sha256(args.bitstream)
        result["manifestSha256"] = _sha256(args.manifest)
        event_loop = asyncio.get_event_loop()
        event_loop.run_until_complete(_run_hardware(args, result))
        result["status"] = "pass"
    except Exception as error:
        result["status"] = "fail"
        result["error"] = "{}: {}".format(type(error).__name__, error)
    finally:
        result["finishedAt"] = _utc_now()
        result["durationSeconds"] = round(time.monotonic() - started, 3)
        args.result.parent.mkdir(parents=True, exist_ok=True)
        with open(str(args.result), "w", encoding="utf-8") as result_file:
            json.dump(result, result_file, indent=2)
            result_file.write("\n")
        print(json.dumps(result, indent=2))

    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
