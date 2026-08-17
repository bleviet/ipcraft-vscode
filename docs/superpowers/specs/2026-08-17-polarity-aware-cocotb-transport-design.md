# Polarity-Aware Cocotb Transport Design

## Problem

The generated Avalon-MM cocotb transport constructs signal handles from
`bus_prefix` and canonical active-high suffixes. A polarity-configured interface
instead exposes physical ports such as `avs_read_n`, so the generated testbench
fails before it can exercise the register model. Literal `portNameOverrides`
have the same underlying mismatch.

## Design

`CocotbFramework` will derive one Avalon transport signal map from the primary
interface entries already present in `templateContext.bus_ports`. Each entry
identifies the canonical logical name, final physical HDL name, and effective
polarity. Missing metadata retains the existing `bus_prefix` fallback so custom
and minimal template contexts remain compatible.

The cocotb template will resolve handles once in `AvalonTransport.__init__` and
will drive or sample those handles thereafter. Active-low command and handshake
signals use zero as their asserted level and one as their deasserted level.
Active-low byte enables invert the requested lane mask within `_FULL_BYTE_ENABLE`.
Address, write-data, and read-data signals only use the resolved physical name.

The register manifest, `RegisterModel`, transaction ordering, wait behavior, and
the `AvalonTransport.write`/`read` API remain unchanged.

## Testing

A focused `CocotbFramework` unit regression will render an Avalon context with
active-low `read`, `write`, `waitrequest`, `readdatavalid`, and `byteenable`
ports and assert the generated Python uses the physical names and correct
assertion levels. Existing active-high transport tests characterize the fallback.
The integration HDL suite is the end-to-end gate when cocotb and simulators are
available; CI must return green before merge.
