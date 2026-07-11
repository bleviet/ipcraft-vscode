#!/usr/bin/env python3
"""
debug_console.py -- System Console transport for register peek/poke on hardware.

This script demonstrates the sentinel-framed persistent-process transport
pattern proposed in ipcraft-vscode issue #36 (Part B/C): it spawns
`system-console --cli` as a single long-lived subprocess, frames each
request with a sentinel marker, and reads stdout until the sentinel is
found. This is the exact protocol the TypeScript `SystemConsoleTransport`
in ipcraft-vscode will implement for the Memory Map editor's live-debug
mode.

Usage:
    python3 debug/debug_console.py --base 0x00010010 dump
    python3 debug/debug_console.py --base 0x00010010 read VERSION
    python3 debug/debug_console.py --base 0x00010010 write LED_PATTERN 0xFF
    python3 debug/debug_console.py --base 0x00010010 read EVENTS
    python3 debug/debug_console.py --base 0x00010010 poll EVENTS 10 0.5

Register names are resolved from led_controller_avmm.mm.yml (the same
single source of truth the ipcraft-vscode extension uses).

Requirements:
    - PyYAML (for .mm.yml parsing)
    - system-console in PATH (Quartus installation or cvsoc/quartus Docker image)

Run inside Docker:
    docker run --rm --privileged -v /dev/bus/usb:/dev/bus/usb \
      -v $(realpath ../..):/work cvsoc/quartus:23.1 \
      python3 /work/16_ipcraft_led_avmm/debug/debug_console.py --base 0x00010010 dump
"""

import argparse
import os
import select
import subprocess
import sys
import tempfile
import time

# Try PyYAML first; fall back to a minimal parser for the simple .mm.yml
# structure (the cvsoc/quartus:23.1 Docker image has no PyYAML/setuptools).
try:
    import yaml
    _HAS_PYYAML = True
except ImportError:
    _HAS_PYYAML = False


def _parse_simple_yaml(text):
    """Minimal YAML parser for the .mm.yml register-map structure.
    Handles: nested lists with '- name:', scalar key: value, and
    folded '>' block scalars (consumed but not parsed into the model).
    This is NOT a general YAML parser -- it covers exactly the subset
    that led_controller_avmm.mm.yml uses."""
    # Strip comments and blank lines
    lines = []
    for line in text.splitlines():
        # Remove comments (but not '#' inside quoted strings)
        if '#' in line and not line.strip().startswith("'") and not line.strip().startswith('"'):
            line = line[:line.index('#')]
        if line.strip():
            lines.append(line.rstrip())

    # Parse folded block scalars (lines after '>')
    result = [{}]
    i = 0
    current_map = result[0]
    # Stack of (indent, container) for nesting
    # container is a dict or list
    stack = [(0, current_map)]
    pending_key = None

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip folded block scalar content (after '>' or '|')
        if pending_key == '__folded__':
            if stripped and not stripped.startswith('-') and ':' not in stripped:
                # This is continuation of the folded scalar -- skip
                i += 1
                continue
            else:
                pending_key = None

        indent = len(line) - len(line.lstrip())

        # Pop stack to current indent level
        while stack and stack[-1][0] > indent:
            stack.pop()

        if stripped.startswith('- '):
            # New list item
            content = stripped[2:].strip()
            # Find the parent list container
            # The parent should be the value of the last key at this indent
            parent_dict = stack[-1][1] if stack else current_map
            # Navigate to the right dict in the stack
            for s_indent, s_cont in stack:
                if s_indent == indent:
                    parent_dict = s_cont
                    break

            # If parent is a dict and the last key maps to a list, append
            # This is simplified -- we need to find the right list
            # For our .mm.yml, list items always start with 'name:' or a key
            item = {}
            if ':' in content:
                k, v = content.split(':', 1)
                k = k.strip()
                v = v.strip()
                if v:
                    item[k] = _coerce_value(v)
                else:
                    # Could be a nested structure or folded scalar
                    if k in ('description',):
                        # Check next line for '>'
                        if i + 1 < len(lines) and lines[i + 1].strip().startswith('>'):
                            pending_key = '__folded__'
                            item[k] = ''
                        else:
                            item[k] = ''
                    else:
                        # Nested -- will be filled by subsequent lines
                        pass

            # Append to the right list in the parent
            # Find the last list-valued key in the parent
            if isinstance(parent_dict, dict):
                # Find the key whose value is a list at this level
                for pk, pv in parent_dict.items():
                    if isinstance(pv, list):
                        pv.append(item)
                        break
                else:
                    # No list found -- this is a top-level list item
                    if not result or (len(result) == 1 and not result[0]):
                        result[0] = item
                    else:
                        result.append(item)
                        current_map = item

            stack.append((indent + 2, item))
            i += 1
            continue

        if ':' in stripped:
            k, v = stripped.split(':', 1)
            k = k.strip()
            v = v.strip()

            target = stack[-1][1] if stack else current_map

            if v:
                target[k] = _coerce_value(v)
            else:
                # Empty value -- could be nested dict or list or folded
                if i + 1 < len(lines):
                    next_stripped = lines[i + 1].strip()
                    if next_stripped.startswith('- '):
                        target[k] = []
                    elif next_stripped.startswith('>'):
                        pending_key = '__folded__'
                        target[k] = ''
                    else:
                        target[k] = {}
                        stack.append((indent + 2, target[k]))

            i += 1
            continue

        i += 1

    return result


def _coerce_value(v):
    """Convert a YAML scalar string to int/str."""
    v = v.strip().strip("'\"")
    if v.startswith('0x') or v.startswith('0X'):
        try:
            return int(v, 16)
        except ValueError:
            return v
    try:
        return int(v)
    except ValueError:
        pass
    if v.lower() in ('true', 'false'):
        return v.lower() == 'true'
    return v


# ---------------------------------------------------------------------------
# Register model: load .mm.yml and resolve register names to byte offsets
# ---------------------------------------------------------------------------

class RegisterMap(object):
    """Minimal .mm.yml loader -- mirrors what tb/mm_loader.py (from
    mm_loader.py.j2) does in cocotb, and what src/domain/parse.ts does in
    the VS Code extension. The register MODEL is bus- and language-agnostic;
    only the TRANSPORT differs."""

    def __init__(self, mm_yml_path):
        with open(mm_yml_path) as f:
            text = f.read()
        if _HAS_PYYAML:
            maps = yaml.safe_load(text)
        else:
            maps = _parse_simple_yaml(text)
        self.registers = {}
        for mmap in maps:
            for block in mmap.get("addressBlocks", []):
                base = int(block.get("baseAddress", 0))
                for reg in block.get("registers", []):
                    name = reg["name"]
                    offset = int(reg["offset"])
                    fields = {}
                    for field in reg.get("fields", []):
                        bits = field["bits"]
                        msb, lsb = self._parse_bits(bits)
                        fields[field["name"]] = {
                            "bits": bits,
                            "msb": msb,
                            "lsb": lsb,
                            "mask": ((1 << (msb - lsb + 1)) - 1) << lsb,
                            "access": field.get("access", "read-write"),
                            "resetValue": field.get("resetValue", 0),
                        }
                    self.registers[name] = {
                        "offset": base + offset,
                        "access": reg.get("access", "read-write"),
                        "fields": fields,
                    }

    @staticmethod
    def _parse_bits(bits_str):
        s = bits_str.strip("[]")
        parts = s.split(":")
        return int(parts[0]), int(parts[-1])

    def get_offset(self, name):
        if name not in self.registers:
            available = list(self.registers.keys())
            raise KeyError("Unknown register: %s. Available: %s" % (name, available))
        return self.registers[name]["offset"]

    def get_field_mask(self, reg_name, field_name):
        return self.registers[reg_name]["fields"][field_name]["mask"]

    def dump(self):
        lines = []
        for name, info in self.registers.items():
            lines.append("  %-20s offset=0x%04X  access=%s" %
                         (name, info["offset"], info["access"]))
            for fname, finfo in info["fields"].items():
                lines.append("    %-20s bits=%s  mask=0x%08X" %
                             (fname, finfo["bits"], finfo["mask"]))
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# SystemConsoleTransport: one-process-per-transaction Tcl bridge
# ---------------------------------------------------------------------------

class SystemConsoleTransport(object):
    """Executes each register transaction by spawning a short-lived
    system-console process that sources a generated Tcl script.

    This uses the proven 'printf "source file.tcl" | system-console --cli'
    pattern (one process per transaction) rather than a persistent
    subprocess, because system-console discovers JTAG services at startup
    and a persistent process may miss services that appear after startup.

    For the ipcraft-vscode TypeScript transport (issue #36 Part B), a
    persistent subprocess with sentinel framing is the target design —
    the TS transport can control system-console's startup timing and
    service discovery more precisely. This Python prototype uses the
    simpler one-shot approach for reliability on hardware.

    Each transaction:
      1. Generate a Tcl script with the command + @@END sentinel
      2. Pipe 'source /tmp/xxx.tcl' into system-console --cli
      3. Parse stdout for @@VAL / @@WROTE / @@ERROR markers
      4. system-console exits when stdin reaches EOF
    """

    def __init__(self, base_address=0, timeout=30.0):
        self.base_address = base_address
        self.timeout = timeout
        self.master_path = None

    def connect(self):
        """Discover the JTAG master service path."""
        tcl = (
            'set _paths [get_service_paths master]\n'
            'if {[llength $_paths] == 0} {\n'
            '  puts "@@ERROR no_master"\n'
            '} else {\n'
            '  puts "@@MP [lindex $_paths 0]"\n'
            '}\n'
            'puts "@@END"\n'
        )
        response = self._run_tcl(tcl)
        for line in response.split("\n"):
            line = line.strip()
            if line.startswith("@@MP "):
                # The path may contain spaces (from Tcl list formatting)
                # Extract everything after @@MP  and strip braces
                self.master_path = line[5:].strip().strip("{}")
                return
            if line.startswith("@@ERROR"):
                raise ConnectionError(
                    "No JTAG-to-Avalon master service found. "
                    "Ensure the debug variant bitstream is programmed: "
                    "make debug-build && make debug-program"
                )
        raise ConnectionError("Failed to discover JTAG master service")

    def read32(self, offset):
        """Read a 32-bit register at the given byte offset from base_address."""
        addr = self.base_address + offset
        # Brace the master path — it contains special Tcl chars like | ( . )
        tcl = (
            'set mp {%s}\n'
            'if {[catch {open_service master $mp} err]} {\n'
            '  puts "@@ERROR open: $err"\n'
            '  puts "@@END"\n'
            '  return\n'
            '}\n'
            'set _r [master_read_32 $mp %d 1]\n'
            'close_service master $mp\n'
            'puts "@@VAL $_r"\n'
            'puts "@@END"\n'
        ) % (self.master_path, addr)
        response = self._run_tcl(tcl)
        for line in response.split("\n"):
            line = line.strip()
            if line.startswith("@@VAL "):
                raw = line[6:].strip().strip("{}")
                return int(raw, 0)
            if line.startswith("@@ERROR"):
                raise IOError(line)
        raise ValueError("No @@VAL in response: %r" % response)

    def write32(self, offset, value):
        """Write a 32-bit value to a register at the given byte offset."""
        addr = self.base_address + offset
        tcl = (
            'set mp {%s}\n'
            'if {[catch {open_service master $mp} err]} {\n'
            '  puts "@@ERROR open: $err"\n'
            '  puts "@@END"\n'
            '  return\n'
            '}\n'
            'master_write_32 $mp %d [list %d]\n'
            'close_service master $mp\n'
            'puts "@@WROTE"\n'
            'puts "@@END"\n'
        ) % (self.master_path, addr, value)
        self._run_tcl(tcl)

    def close(self):
        """Nothing to clean up — each transaction is a separate process."""
        pass

    def _run_tcl(self, tcl_script):
        """Write Tcl to a temp file, pipe 'source file' into system-console,
        and return all output up to @@END. Uses subprocess.run with input=
        which is the exact equivalent of: printf "source file.tcl\\n" |
        system-console --cli — the proven pattern from the Tcl tests."""
        fd, tmp_path = tempfile.mkstemp(suffix=".tcl", prefix="sc_cmd_")
        try:
            os.write(fd, tcl_script.encode())
            os.close(fd)

            source_cmd = "source %s\n" % tmp_path
            try:
                proc = subprocess.Popen(
                    ["system-console", "--cli"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    universal_newlines=True,
                )
                output, _ = proc.communicate(input=source_cmd, timeout=self.timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                raise TimeoutError(
                    "system-console timed out after %ss" % self.timeout
                )

            # Parse output for @@END and extract lines before it
            output_lines = []
            saw_end = False
            for line in output.split("\n"):
                line = line.strip()
                # Strip % prompt prefix
                if line.startswith("% "):
                    line = line[2:].strip()
                elif line == "%":
                    continue

                if line == "@@END":
                    saw_end = True
                    break

                # Skip source echo
                if line.startswith("source ") and tmp_path in line:
                    continue
                # Skip empty
                if not line:
                    continue

                output_lines.append(line)

            if not saw_end:
                # Include last few lines of output for debugging
                dbg = "\n".join(output_lines[-5:]) if output_lines else "(no output)"
                raise TimeoutError(
                    "system-console did not emit @@END within %ss. Last output:\n%s" %
                    (self.timeout, dbg)
                )

            return "\n".join(output_lines)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Driver: binds RegisterMap to Transport for name-based access
# ---------------------------------------------------------------------------

class RegisterDriver(object):
    """Binds a RegisterMap to a SystemConsoleTransport, providing
    name-based register/field access -- mirrors the proposed mm_driver.py
    Driver/RegisterProxy/FieldProxy from issue #36 Part A/C.

    Usage:
        drv = RegisterDriver(regmap, transport)
        drv.connect()
        val = drv.read("VERSION")
        drv.write("LED_PATTERN", 0xFF)
        drv.write_field("LED_PATTERN", "PATTERN", 0xAA)
        drv.dump()
    """

    def __init__(self, regmap, transport):
        self.regmap = regmap
        self.transport = transport

    def connect(self):
        self.transport.connect()

    def close(self):
        self.transport.close()

    def read(self, reg_name):
        offset = self.regmap.get_offset(reg_name)
        return self.transport.read32(offset)

    def write(self, reg_name, value):
        offset = self.regmap.get_offset(reg_name)
        self.transport.write32(offset, value)

    def read_field(self, reg_name, field_name):
        raw = self.read(reg_name)
        mask = self.regmap.get_field_mask(reg_name, field_name)
        reg = self.regmap.registers[reg_name]
        lsb = reg["fields"][field_name]["lsb"]
        return (raw & mask) >> lsb

    def write_field(self, reg_name, field_name, value):
        """Read-modify-write a single field within a register."""
        raw = self.read(reg_name)
        mask = self.regmap.get_field_mask(reg_name, field_name)
        reg = self.regmap.registers[reg_name]
        lsb = reg["fields"][field_name]["lsb"]
        cleared = raw & ~mask
        new_val = cleared | ((value << lsb) & mask)
        self.write(reg_name, new_val)

    def dump(self):
        """Read all registers from hardware and format a dump."""
        lines = []
        lines.append("=" * 60)
        lines.append("Register dump (base=0x%08X)" % self.transport.base_address)
        lines.append("=" * 60)
        for name, info in self.regmap.registers.items():
            try:
                raw = self.read(name)
                lines.append("  %-20s = 0x%08X" % (name, raw))
                for fname, finfo in info["fields"].items():
                    lsb = finfo["lsb"]
                    msb = finfo["msb"]
                    field_val = (raw & finfo["mask"]) >> lsb
                    lines.append("    %-20s = 0x%X  (bits [%d:%d])" %
                                 (fname, field_val, msb, lsb))
            except Exception as e:
                lines.append("  %-20s = ERROR: %s" % (name, e))
        lines.append("=" * 60)
        return "\n".join(lines)

    def poll(self, reg_name, count, interval):
        """Poll a register N times at the given interval -- demonstrates the
        'Watch' feature (issue #36 Part B: periodic re-read of visible/
        selected registers)."""
        print("Polling %s %d times, every %ss:" % (reg_name, count, interval))
        for i in range(count):
            try:
                val = self.read(reg_name)
                print("  [%3d/%d] %s = 0x%08X" % (i + 1, count, reg_name, val))
            except Exception as e:
                print("  [%3d/%d] %s = ERROR: %s" % (i + 1, count, reg_name, e))
            if i < count - 1:
                time.sleep(interval)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="System Console register debug for led_controller_avmm"
    )
    parser.add_argument(
    "--base", default="0x00010010",
        help="Base address of the IP (default: 0x00010010, from the qsys map)"
    )
    parser.add_argument(
    "--mm-yml", default=None,
        help="Path to .mm.yml (default: ../../led_controller_avmm.mm.yml)"
    )
    parser.add_argument(
    "--timeout", type=float, default=10.0,
        help="Per-transaction timeout in seconds (default: 10)"
    )

    sub = parser.add_subparsers(dest="command")

    sub.add_parser("dump", help="Read and display all registers")
    sub.add_parser("list", help="List registers from .mm.yml (no hardware)")

    p_read = sub.add_parser("read", help="Read a register by name")
    p_read.add_argument("register", help="Register name (e.g. VERSION)")

    p_write = sub.add_parser("write", help="Write a register by name")
    p_write.add_argument("register", help="Register name (e.g. LED_PATTERN)")
    p_write.add_argument("value", help="Value to write (e.g. 0xFF or 255)")

    p_wfield = sub.add_parser("write-field", help="Write a single field")
    p_wfield.add_argument("register")
    p_wfield.add_argument("field")
    p_wfield.add_argument("value")

    p_poll = sub.add_parser("poll", help="Poll a register repeatedly")
    p_poll.add_argument("register")
    p_poll.add_argument("count", type=int, help="Number of reads")
    p_poll.add_argument("interval", type=float, help="Seconds between reads")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    # Resolve .mm.yml path
    mm_yml = args.mm_yml
    if mm_yml is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        mm_yml = os.path.join(script_dir, "..", "..", "led_controller_avmm.mm.yml")

    regmap = RegisterMap(mm_yml)

    # Commands that don't need hardware
    if args.command == "list":
        print("Register map from", mm_yml)
        print(regmap.dump())
        return

    # Commands that need hardware
    base = int(args.base, 0) if isinstance(args.base, str) else args.base
    transport = SystemConsoleTransport(base_address=base, timeout=args.timeout)
    drv = RegisterDriver(regmap, transport)

    try:
        drv.connect()
        print("Connected to System Console (base=0x%08X)" % base)
        print("")

        if args.command == "dump":
            print(drv.dump())

        elif args.command == "read":
            val = drv.read(args.register)
            print("%s = 0x%08X (%d)" % (args.register, val, val))

        elif args.command == "write":
            val = int(args.value, 0)
            drv.write(args.register, val)
            readback = drv.read(args.register)
            status = "PASS" if readback == val else "FAIL"
            print("Wrote %s = 0x%08X, readback = 0x%08X [%s]" %
                  (args.register, val, readback, status))

        elif args.command == "write-field":
            val = int(args.value, 0)
            drv.write_field(args.register, args.field, val)
            readback = drv.read_field(args.register, args.field)
            status = "PASS" if readback == val else "FAIL"
            print("Wrote %s.%s = 0x%X, readback = 0x%X [%s]" %
                  (args.register, args.field, val, readback, status))

        elif args.command == "poll":
            drv.poll(args.register, args.count, args.interval)

    except Exception as e:
        print("ERROR: %s" % e, file=sys.stderr)
        sys.exit(1)
    finally:
        drv.close()


if __name__ == "__main__":
    main()
