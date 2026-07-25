"""
Transport-independent register scoreboard for generated cocotb tests.

The verification manifest is derived once from IPCraft's normalized memory-map
model. This module deliberately knows nothing about AXI4-Lite or Avalon-MM.
"""

import json


def load_manifest(path):
    with open(str(path), encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    if manifest.get("schemaVersion") != 1:
        raise ValueError(
            "Unsupported verification manifest: {}".format(manifest.get("schemaVersion"))
        )
    return manifest


class RegisterModel:
    def __init__(self, manifest):
        self.manifest = manifest
        self.registers = list(manifest["registers"])
        self.by_offset = {reg["offset"]: reg for reg in self.registers}
        self.data_width = manifest["bus"]["dataWidth"]["value"]
        self.lane_count = manifest["bus"]["byteEnable"]["value"]["laneCount"]
        self.full_byte_enable = (1 << self.lane_count) - 1
        self.word_mask = (1 << self.data_width) - 1
        self.state = {}
        self.reset()

    def reset(self):
        self.state = {
            reg["offset"]: reg["resetValue"] & self.word_mask for reg in self.registers
        }

    def expected_read(self, offset):
        reg = self.by_offset.get(offset)
        if reg is None:
            return 0
        return self.state[offset] & reg["readableMask"] & self.word_mask

    def apply_write(
        self,
        offset,
        value,
        byte_enable=None,
        hardware_set_mask=0,
        hardware_clear_mask=0,
    ):
        reg = self.by_offset.get(offset)
        if reg is None:
            return
        if byte_enable is None:
            byte_enable = self.full_byte_enable

        lane_mask = 0
        for lane in range(self.lane_count):
            if byte_enable & (1 << lane):
                lane_mask |= 0xFF << (lane * 8)

        old_value = self.state[offset]
        new_value = old_value
        for field in reg["fields"]:
            targeted_mask = field["mask"] & lane_mask
            write_bits = value & targeted_mask
            effect = field["writeEffect"]
            if effect == "replace":
                new_value = (new_value & ~targeted_mask) | write_bits
            elif effect == "clearOnOne":
                new_value &= ~write_bits
            elif effect == "setOnOne":
                new_value |= write_bits

        # The generated register file resolves simultaneous events after the
        # software operation: hardware set wins over W1C, and hardware clear
        # wins over a self-clearing software set.
        for field in reg["fields"]:
            if field["writeEffect"] == "clearOnOne":
                new_value |= hardware_set_mask & field["mask"]
            elif field["writeEffect"] == "setOnOne":
                new_value &= ~(hardware_clear_mask & field["mask"])

        self.state[offset] = new_value & self.word_mask

    def readable_registers(self):
        return [reg for reg in self.registers if reg["readableMask"] != 0]

    def writable_registers(self):
        return [reg for reg in self.registers if reg["writableMask"] != 0]

    def observable_writable_registers(self):
        return [
            reg
            for reg in self.registers
            if reg["writableMask"] != 0 and reg["readableMask"] != 0
        ]
