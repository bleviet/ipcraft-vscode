# Bus Port Polarity Design

**Date:** 2026-08-16

**Status:** Approved

## Summary

IPCraft will model selectable assertion polarity as a property of one logical
bus port rather than as separate positive- and negative-polarity ports. The
bus contract keeps a canonical port identity, declares the vendor role for
each supported polarity, and supplies a default. Each bus-interface instance
may override that default independently.

The built-in use of this capability is limited to the five Avalon-MM functions
currently represented by positive and `_n` variants:

- `byteenable`
- `readdatavalid`
- `waitrequest`
- `read`
- `write`

The schema capability remains generic so user-defined bus contracts can opt in.
Avalon-ST and AXI transaction ports do not opt in. Clock and reset polarity
continues to use IPCraft's existing reset model.

This design replaces the uncommitted `portsMutuallyExclusive` solution. It
removes duplicate Avalon-MM logical ports and the need for editor-side
alternative replacement.

## Motivation

The positive and `_n` names describe one protocol function with different
assertion levels. Treating them as independent optional ports makes one
logical feature appear twice in the port map and allows invalid coexistence.
Mutual-exclusion constraints prevent the invalid state, but they preserve the
underlying modeling error and make generators, importers, and the editor reason
about two identities for one function.

Polarity and physical spelling are also independent. Imported source can
legitimately describe an active-low `byteenable` role using a physical port
named `byteenable`, or an active-high role using a physical port named
`byteenable_n`. IPCraft must preserve that spelling without treating `_n` as
authoritative semantic metadata.

## Goals

- Represent each bus function once in the canonical contract.
- Allow polarity selection only when the contract explicitly supports it.
- Resolve polarity per bus-interface instance.
- Preserve exact imported physical names.
- Use canonical active-high semantics inside generated HDL.
- Generate the correct polarity-specific vendor interface role.
- Read every document supported by `main`, including legacy `_n` selections.
- Avoid dual-state compatibility fields and hidden import provenance.

## Non-goals

- Making arbitrary bus ports polarity-configurable.
- Adding configurable polarity to Avalon-ST or AXI transaction signals.
- Replacing the existing reset or interrupt-sensitivity models.
- Guaranteeing that an older IPCraft version interprets new active-low
  polarity overrides correctly.
- Inferring certain polarity from raw HDL when the source contains no semantic
  role or polarity metadata.

## Bus contract model

A polarity-capable contract port declares its default and the vendor logical
role for both assertion levels:

```yaml
- name: byteenable
  width: 4
  presence: optional
  role: byteQualifier
  polarity:
    default: activeHigh
    roles:
      activeHigh: byteenable
      activeLow: byteenable_n
```

The port `name` is the stable canonical identity used by conformance,
generation logic, templates, width derivation, and instance override maps.
The values under `polarity.roles` are boundary-facing vendor roles.

If `polarity` is absent, the port is not polarity-configurable. If it is
present, `default`, `roles.activeHigh`, and `roles.activeLow` are required.
Role names must be non-empty and unique case-insensitively across all roles in
the bus definition. Polarity-capable ports must have scalar or vector `in` or
`out` direction; an `inout` polarity-capable port is invalid.

Avalon-MM removes the separate `byteenable_n`, `readdatavalid_n`,
`waitrequest_n`, `read_n`, and `write_n` declarations. Width and dependency
rules refer only to the canonical names. The generic
`portsMutuallyExclusive` constraint introduced by the superseded solution is
removed.

## Interface-instance model

An interface continues to select optional features by canonical name and
stores only deviations from contract defaults:

```yaml
useOptionalPorts:
  - byteenable
  - read
  - write
portPolarityOverrides:
  byteenable: activeLow
  read: activeLow
```

`write` uses its contract default because it has no override. The
`portPolarityOverrides` values are limited to `activeHigh` and `activeLow`.
Keys must resolve to ports in the selected bus contract, and those ports must
declare polarity support.

Like existing width and name overrides, a polarity override may remain while
an optional port is disabled. It is ignored while the port is inactive and
becomes effective if the port is enabled again. Returning a port to its
contract default through the editor removes the override entry; an empty map
is removed from the document.

## Resolution model

The shared bus-contract resolver is the single source of truth for active-port
polarity. For each active canonical port it computes:

```text
effective polarity = instance override ?? contract default
interface role     = polarity.roles[effective polarity]
physical suffix    = explicit portNameOverrides value ?? interface role
```

Ports without polarity metadata use their canonical name as both the
interface role and default physical suffix. `physicalPrefix` is applied after
the suffix is resolved.

A resolved bus port therefore exposes distinct values for:

- Canonical identity, such as `byteenable`
- Effective polarity, such as `activeLow`
- Vendor interface role, such as `byteenable_n`
- Physical name, such as `avs_strange_enable`

Consumers must not reconstruct these values from one another or infer
polarity from a physical suffix.

## Generation

Generated internal bus logic uses canonical active-high semantics regardless
of the external interface polarity. A focused generator boundary adapter
applies inversion between the external physical port and the canonical
internal signal:

- For an input, the canonical internal signal is the inverse of the active-low
  external signal.
- For an output, the active-low external signal is the inverse of the canonical
  internal signal.
- Multibit qualifiers such as `byteenable` use bitwise inversion.

This keeps protocol templates keyed by canonical names and avoids duplicating
active-low branches throughout generated logic. The generator's template
context must keep canonical logical identity separate from the vendor
interface role. Vendor artifacts such as `_hw.tcl` and IP-XACT use the
polarity-specific interface role, while HDL declarations use the resolved
physical name.

An explicit `portNameOverrides` value always wins literally. Changing
polarity never changes an explicit physical name. Without an explicit name
override, IPCraft-created interfaces use the polarity-specific role as the
default suffix, so selecting active-low `read` produces `read_n` by default.

## Import behavior

Importers that receive separate semantic-role and physical-name metadata map
them independently. For example:

```tcl
add_interface_port AVMM strange_enable byteenable_n Input 4
```

normalizes to canonical `byteenable`, an `activeLow` polarity override, and a
physical-name override of `strange_enable`.

The inverse naming mismatch is also preserved. A physical port named
`byteenable_n` with the semantic role `byteenable` normalizes to active-high
canonical `byteenable` plus the literal physical-name override
`byteenable_n`.

The same rule applies to IP-XACT and other formats that separate logical roles
from physical names. The importer determines polarity from explicit semantic
metadata, not from physical spelling.

Raw HDL does not provide independent semantic-role or polarity metadata.
Protocol matching may use conventional names as a best-effort initial
suggestion, as it already does for interface recognition, but it preserves the
exact physical name and allows the user to correct polarity in the inspector.
The inferred result is not treated as stronger evidence than an explicit user
selection.

No stored `imported` flag is required. A physical-name override is sufficient
to preserve non-default spelling in every subsequent round trip.

## Migration and compatibility

The new normalizer accepts the legacy positive and `_n` logical names present
on `main`. Positive names remain canonical and use the contract default.
Legacy negative names become the canonical port plus an `activeLow` override.

Legacy name and width override keys, along with legacy `absentPorts` entries,
move to the canonical key or name. If both aliases occur in the same keyed
map, document order applies and the last entry wins. If the original physical
suffix differs from the new polarity-derived default, migration stores a
literal name override so generated HDL keeps the same external port.

If a legacy `useOptionalPorts` list contains both polarity forms for one
function, the last occurrence wins. This matches the former editor's append
order and deterministically repairs documents created by the coexistence bug.
The normalized model contains the canonical port only once.

Legacy input is accepted at the normalization boundary but is never emitted.
An existing document changes on disk only after a write operation serializes
the normalized form. Generation and validation use the normalized form even
before such a write.

Compatibility guarantees are deliberately directional:

- The new IPCraft version reads all bus-interface documents supported by
  `main`.
- Existing active-high documents retain their behavior and generated names.
- New active-low documents require the new IPCraft version.

An older IPCraft version ignores `portPolarityOverrides` and therefore cannot
interpret canonical active-low selections correctly. Writing both the new
override and a legacy `_n` selection would create two sources of truth and is
forbidden.

## Editor behavior

The canvas and inspector show one row or sub-port for each canonical function.
Polarity-capable ports expose an H/L selector consistent with the existing
reset presentation. Other bus ports have no polarity control.

Changing polarity updates only the relevant override. Enabling or disabling a
port updates canonical `useOptionalPorts` membership and does not discard its
width, name, or polarity overrides. The gesture remains one atomic document
update with existing undo behavior.

If no physical-name override exists, the displayed derived name follows the
selected polarity. If a physical-name override exists, the displayed and
generated physical name remains unchanged when polarity changes.

## Validation and diagnostics

Bus-definition validation rejects:

- Missing defaults or role mappings
- Values other than `activeHigh` and `activeLow`
- Empty or case-insensitively duplicate roles
- Role collisions with another canonical port or polarity role
- Polarity metadata on an `inout` port

Interface conformance rejects:

- Override keys that do not resolve to a declared canonical port after legacy
  normalization
- Overrides on ports without polarity metadata
- Invalid override values

Diagnostics point to the exact bus definition or
`busInterfaces[index].portPolarityOverrides[port]` path. An override for an
inactive but otherwise valid port is not an error.

## Built-in protocol scope

Only the five Avalon-MM functions listed in the summary declare configurable
polarity. Avalon-ST signal roles are active-high. AXI4-Lite, AXI4-Full, and
AXI4-Stream transaction signals have fixed protocol semantics and do not
receive polarity metadata.

AXI `ARESETn` and Avalon reset roles remain associated reset signals. Their
polarity continues to be modeled by IPCraft reset objects and must not be
duplicated as bus-port polarity overrides. Interrupt assertion behavior
continues to use the existing sensitivity model.

## Testing strategy

Schema and contract tests cover valid polarity declarations, all malformed
declarations, role collisions, and generated TypeScript types.

Normalization and conformance tests cover:

- All five Avalon-MM legacy `_n` aliases
- Active-high documents remaining unchanged
- Legacy name and width override-key migration
- Both legacy polarities being resolved by last occurrence
- Overrides on inactive ports
- Unknown, incapable, and invalid override entries
- Custom contracts with and without polarity metadata

Parser round-trip tests cover `_hw.tcl` and IP-XACT cases where semantic
polarity and physical `_n` spelling agree and disagree. Raw-HDL tests establish
that physical names are preserved and inferred polarity remains editable.

Generator tests cover:

- Correct polarity-specific vendor roles
- Literal physical-name overrides
- Derived default physical names
- Scalar input and output inversion
- Multibit `byteenable` inversion
- Unchanged active-high output
- Correct behavior for both producer and consumer interface modes

Browser tests cover one canonical canvas sub-port per function, polarity
selection, persistence, default-name changes, and preservation of imported
physical names. Existing interface activation, grouping, and undo behavior
remain covered.

Final verification includes lint, type-check, compile after type generation,
the full unit suite, the relevant Playwright suite, generator snapshots, and
targeted HDL/vendor integration tests.

## Implementation boundary

The implementation removes the current uncommitted mutual-exclusion schema,
normalization, evaluation, activation policy, Avalon declarations, tests, and
documentation. It then implements this design through cohesive contract,
normalization, parser, generator, and editor seams. No compatibility fallback
may read or write both a canonical polarity override and a duplicate `_n`
selection as authoritative state.
