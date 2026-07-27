# Design-Aware Documentation

## Status

Idea with preliminary architecture decisions. This document describes a
possible IPCraft feature and is not yet an implementation plan. The vendor
integration recommendations were reviewed against vendor documentation on
2026-07-24.

## Problem

Documentation for FPGA systems is often separated from the Vivado Block Design
or Quartus Platform Designer system that it describes. Developers have to
switch between the design tool and prose documentation, which interrupts the
workflow and makes it easy for the two representations to drift apart.

Traditional generated documentation only solves part of the problem. It can
list components, addresses, parameters, and connections, but it cannot reliably
explain why a component exists, why a particular configuration was chosen, or
which system-level assumptions must remain true.

IPCraft could provide a design-aware documentation workspace that combines:

- a navigable system block diagram;
- documentation attached to design entities;
- deterministic detection of design changes;
- ordinary Markdown that developers can edit themselves; and
- optional, reviewable LLM assistance.

The central principle is:

> Synchronization means detecting and explaining design changes, not allowing
> an LLM to silently rewrite human intent.

## Proposed User Experience

IPCraft opens a Vivado Block Design or Platform Designer system as a navigable
diagram.

- Hovering over a component shows a short documentation preview.
- Clicking a component pins it and opens the complete documentation in a side
  panel.
- Selecting an interface or connection explains the corresponding data flow.
- Components whose source has changed show a documentation status badge.
- The developer can edit Markdown in the panel or open the file in the normal
  VS Code editor.
- An optional AI action proposes updates as a reviewable diff.

Hover should remain a preview interaction. Requiring a click to pin the full
document prevents the side panel from changing constantly while moving across
a dense diagram and also provides an accessible keyboard interaction.

Documentation should eventually be attachable to:

- the complete system;
- component instances;
- interfaces and connections;
- clock and reset domains;
- address regions;
- interrupt paths; and
- user-defined groups or subsystems.

Connections deserve first-class documentation. The reason why two components
are connected is often more valuable than another description of either
component.

## Information Ownership

The feature should explicitly separate three kinds of information.

### Extracted Facts

Names, types, parameters, interfaces, addresses, clocks, resets, interrupts,
and connectivity come from the vendor design. IPCraft can update these facts
deterministically.

### Human Intent

Purpose, design decisions, assumptions, limitations, operational behavior, and
debugging advice belong to the developer. These sections must never be
overwritten by regeneration.

### AI Suggestions

An LLM can propose changes using the structural design diff, relevant source
files, and existing documentation. Suggestions must remain reviewable changes
rather than silently becoming the new documentation.

This separation prevents regeneration from destroying the explanation that
makes the document useful.

## Vendor-Neutral System Graph

Vendor importers should produce a normalized system graph, similar in spirit
to IPCraft's normalized IP-core and memory-map domain models.

An illustrative representation is:

```yaml
schemaVersion: 1

source:
  vendor: vivado
  path: hardware/system.bd
  importedFrom: hardware/system.tcl

components:
  - id: /axi_dma_0
    type: xilinx.com:ip:axi_dma:7.1
    parameters:
      addressWidth: 32
    interfaces:
      - id: m_axi_mm2s
        mode: master

connections:
  - id: /axi_dma_0/m_axi_mm2s->/smartconnect_0/s00_axi
    from: /axi_dma_0/m_axi_mm2s
    to: /smartconnect_0/s00_axi
```

The normalized graph is an IPCraft runtime contract, not a replacement source
format. The checked-in vendor design remains authoritative.

Vendor adapters should use a two-level extraction strategy:

1. Run the vendor's supported scripting API in batch mode and serialize its
   object model into the normalized graph.
2. Offer a clearly marked partial, offline importer only for formats that can
   be read reliably without executing untrusted scripts.

IPCraft must not implement a general Tcl interpreter or source arbitrary
project scripts merely to draw a diagram. A script may execute commands well
beyond system construction. Vendor execution therefore requires an explicit
user action and the same trust boundary as launching a vendor build.

### Vendor Source Recommendations

| Vendor flow | Authoritative project source | Preferred extraction boundary | Notes |
|---|---|---|---|
| AMD Vivado IP Integrator | Checked-in `.bd`, or a checked-in recreation Tcl flow | Open or recreate the design in the matching Vivado release, then query `get_bd_cells`, `get_bd_intf_*`, `get_bd_nets`, `get_bd_addr_*`, and object properties in batch mode | Do not parse `.bd` JSON as the primary contract. AMD changed `.bd` from XML to JSON in Vivado 2018.3. |
| Intel Quartus Platform Designer | `.qsys`, or an exported system Tcl flow when the project is script-owned | Use `qsys-script`/Platform Designer scripting to load the system and query instances, interfaces, parameters, connections, and system information | Treat `.sopcinfo` as supplemental generated data for the resolved software-visible system, not as the editable source. |
| Microchip Libero SmartDesign | Libero project plus exported SmartDesign component-description Tcl | Recreate or open the design with the matching Libero release and extract from supported reports or Tcl interfaces | Start with a feasibility adapter. Public SmartDesign Tcl is strong for construction, but extraction completeness must be characterized before support is promised. |
| Lattice Propel Builder | Propel project plus its generated recreation Tcl | Use the matching Propel release and supported Tcl flow | Start with a feasibility adapter. Propel documents project export through `sbp_design gen_tcl`; a stable read/query API still needs characterization. |
| IEEE 1685 IP-XACT | IP-XACT `design`, `designConfiguration`, and referenced `component` documents | Parse and validate the standard XML directly | Support as a vendor-neutral import when the project already provides a complete system description, not as a substitute for vendor extraction. |

AMD documents that `write_bd_tcl` can recreate a design and may include layout,
but it writes only user-changed parameters rather than all defaults and
tool-propagated values. It is therefore a good source-control format but an
incomplete effective-state extractor. Vivado also embeds its release in the
export and expects recreation with the same release. See the
[Vivado block-design Tcl export documentation](https://docs.amd.com/r/en-US/ug835-vivado-tcl-commands/write_bd_tcl),
[Vivado block-design object properties](https://docs.amd.com/r/en-US/ug912-vivado-properties/BD_CELL),
and [AMD revision-control guidance](https://docs.amd.com/r/en-US/ug994-vivado-ip-subsystems/Revision-Control-Methodology).

Intel exposes supported Platform Designer scripting commands such as
`load_system`, `get_instances`, `get_instance_parameters`, interface queries,
and connection queries. Platform Designer also supports exporting a system as
Tcl and comparing `.qsys` files with its System Diff Tool. See the
[Platform Designer scripting command reference](https://www.intel.com/content/www/us/en/docs/programmable/683609/25-1/faq.html),
[`get_instances` reference](https://www.intel.com/content/www/us/en/docs/programmable/683609/24-3/get-instances-25806.html),
and [system Tcl export command](https://www.intel.com/content/www/us/en/programmable/quartushelp/19.1/system/qsys/qsys_com_export_as_script.htm).

Microchip supports hierarchical SmartDesign component export as Tcl, while
Lattice documents recreation of Propel projects from generated Tcl. These are
credible future integration points but should not be presented as equivalent
to a proven full graph-query API until tested across representative projects.
See the [Libero SmartDesign export documentation](https://onlinedocs.microchip.com/oxy/GUID-AFCB5DCC-964F-4BE7-AA46-C756FA87ED7B-en-US-20/GUID-BA52F539-E830-4341-B5FA-D07408FE99BC.html)
and [Lattice Propel revision-control flow](https://www.latticesemi.com/-/media/LatticeSemi/Documents/UserManuals/RZ2/FPGA-UG-02214-1-0-Revision-Control-Propel-Builder-2024-1.ashx?document_id=54240).

IEEE 1685-2022 defines component, design, and design-configuration documents
for hierarchy, interfaces, interconnection, address maps, registers, and file
sets. IPCraft should accept it where available, while expecting vendor
extensions and incomplete export coverage in real projects. See the
[Accellera IP-XACT resources](https://www.accellera.org/downloads/standards/ip-xact)
and [IP-XACT 2022 user guide](https://www.accellera.org/images/downloads/standards/ip-xact/IPXACT-2022_user_guide.pdf).

Every extracted graph should record:

- vendor and edition;
- exact tool version;
- source file and source content hash;
- extraction capability flags;
- whether the result is authoritative or partial; and
- warnings for unavailable defaults, propagated parameters, address maps, or
  hierarchy.

Keep vendor parsing, tool execution, and filesystem access in extension-host
services. Send only the typed normalized graph across the webview boundary.

The current `IpBlockCanvas` represents the external shape of one IP core. A
system diagram represents instances, connections, hierarchy, address paths,
and clock domains. It should therefore be a separate cohesive feature while
reusing suitable visual primitives and VS Code theme conventions.

## Markdown as the Documentation Source

Long-form documentation should not live in a generated graph or vendor design
file. It should remain ordinary, version-controlled Markdown.

An example layout is:

```text
docs/design/
  system.md
  components/
    axi-dma-0.md
    smartconnect-0.md
  connections/
    dma-to-memory.md
```

Each document can contain small machine-readable front matter:

```markdown
---
ipcraft:
  schemaVersion: 1
  entityId: /axi_dma_0
  observedFingerprint: sha256:...
---

# AXI DMA

## Role

Moves captured samples into DDR without processor intervention.

## Design Decisions

The scatter-gather engine is disabled because buffers are statically allocated.

## Operational Behavior

Describe the expected initialization and transfer sequence here.

## Generated Design Facts

<!-- ipcraft:generated:start -->
| Property | Value |
|---|---|
| IP type | `xilinx.com:ip:axi_dma:7.1` |
| Memory interface | `m_axi_mm2s` |
<!-- ipcraft:generated:end -->

## Verification and Debugging

Describe useful probes, expected interrupts, and common failure modes here.
```

Only explicitly marked generated regions are machine-owned. Everything else
remains human-owned.

A standard template gives developers and an LLM useful semantic sections:

- Role
- Design decisions
- Operational behavior
- Interface and software contract
- Assumptions and limitations
- Verification and debugging

Git already records history, so documents should not require a manually
maintained change log.

### Reusable and Group Documentation

Documentation needs three scopes:

| Scope | Example | Binding |
|---|---|---|
| Type | How any AXI DMA of a given IP version behaves | Component VLNV or equivalent type and compatible version range |
| Instance | Why `/capture/axi_dma_0` is configured this way | IPCraft `docId` bound to one vendor instance |
| Group | Capture path containing DMA, FIFO, interconnect, and interrupt logic | IPCraft group ID with explicit members or a hierarchy selector |

Type documentation provides reusable background. Instance documentation adds
project-specific intent and configuration. IPCraft should render them as
separate sections rather than merging their Markdown into an ambiguous derived
file.

Native vendor hierarchy should automatically appear as a documentable group.
Developers should also be able to define logical groups that cross hierarchy
boundaries, such as a video pipeline or a safety island. Explicit member
bindings are the default because name-pattern membership can silently change.
A selector may be used for intentionally open groups, but membership changes
must mark the group document stale.

A reusable subsystem should have a type-level document attached to its
subsystem definition and an optional instance-level document for each
instantiation. This avoids duplicating generic behavior while preserving local
facts such as addresses, clocks, and connections.

### Documentation Templates

Templates should be project-configurable, but through a constrained contract.

- IPCraft ships versioned built-in templates for systems, component types,
  component instances, connections, and groups.
- A project may select a built-in template or point to a checked-in Markdown
  template under `docs/`.
- Standard section identifiers are declared in template metadata so IPCraft
  and an LLM can target a section without matching translated display text.
- Projects may add arbitrary human sections.
- Generated-region markers and required front matter remain controlled by
  IPCraft and are validated.
- Changing a template never rewrites existing documents automatically. IPCraft
  may offer an explicit migration preview.

The MVP should ship only built-in templates. Project overrides can follow once
the section contract is proven by real documents.

## Synchronization Model

On each design refresh, IPCraft should:

1. Extract the normalized system graph.
2. Compute a semantic fingerprint for each documentable entity.
3. Compare it with the last observed graph.
4. Classify each document as current, source changed, unvalidated, missing,
   orphaned, or ambiguously renamed.
5. Update deterministic generated facts.
6. Offer manual or AI-assisted updates for human-owned sections.

Fingerprints should include only documentation-relevant properties. Moving a
component on the vendor canvas should not make its documentation stale. A
change to its clock frequency, address, interfaces, connections, or important
parameters should.

Use a layered semantic policy instead of hashing every vendor property.

The following facts always affect the fingerprint:

- component type and version;
- hierarchical location;
- interfaces, protocol roles, port widths, and externally visible exports;
- connection endpoints and interface-level connection properties;
- assigned address segments and software-visible address span;
- interrupt source, destination, number, trigger type, and concatenation order;
- clock frequency, phase where relevant, domain membership, and interface
  association;
- reset polarity, synchrony, domain membership, and interface association; and
- parameters that change generated hardware, enabled interfaces, memory size,
  data width, burst behavior, buffering, or software-visible behavior.

The following facts affect the fingerprint conditionally:

- user-modified parameters, unless the adapter classifies them as presentation
  only;
- tool-propagated values when they change an interface or resolved system
  behavior;
- parameters explicitly referenced by a documentation file; and
- project-selected parameters pinned by the user as documentation-relevant.

Exclude canvas coordinates, colors, collapsed state, timestamps, generated
file paths, report ordering, and other presentation or build metadata.

The vendor adapter should classify known parameters where possible. Unknown
user-set parameters should default to semantic because missing a meaningful
change is worse than one extra review notification. IPCraft should show which
facts produced a stale status and allow the developer to exclude a noisy
property through checked-in project configuration.

### Declared and Resolved State

The graph should distinguish developer-declared state from tool-resolved state.
They answer different documentation questions:

| State | Meaning | Documentation use |
|---|---|---|
| Declared | Instance type, user-set parameters, explicit connections, and explicit address assignments present in the source | Explain developer intent and review source changes |
| Resolved | Values after vendor synchronization, parameter propagation, address calculation, and design validation | Describe the hardware and software-visible system that the tool will generate |

For Vivado, extract declared state after opening or recreating the block design,
then run `validate_bd_design` and extract resolved state. AMD documents that
validation runs parameter propagation and that interface parameters have
`USER`, `CONSTANT`, `PROPAGATED`, or `DEFAULT` strengths. See
[`validate_bd_design`](https://docs.amd.com/r/2024.1-English/ug835-vivado-tcl-commands/validate_bd_design)
and [Vivado parameter propagation](https://docs.amd.com/r/en-US/ug994-vivado-ip-subsystems/Propagating-Parameters-in-IP-Integrator).

For Platform Designer, extract declared state after `load_system`, then run
`sync_sysinfo_parameters` and `validate_system` before extracting resolved
state. Intel lists these as supported validation commands in the
[Platform Designer scripting reference](https://www.intel.com/content/www/us/en/docs/programmable/683609/25-1/faq.html).

Resolved state is the primary fingerprint for externally visible behavior.
Declared state is retained so the diff can say whether a change was made by the
developer or propagated by the vendor tool.

Validation must run in a disposable working copy or read-only flow that does
not save changes back to the authoritative project. If validation fails,
IPCraft should:

- retain and display the declared graph;
- mark the resolved graph unavailable rather than reusing an old one;
- show vendor validation diagnostics;
- mark affected documentation as `unvalidated`; and
- avoid accepting a new reviewed baseline until the user explicitly overrides
  the failure.

### Markdown Facts Versus Dynamic Facts

Markdown should contain the small set of stable facts needed when reading the
document outside IPCraft:

- component or subsystem identity and version;
- purpose-facing interface summary;
- software-visible address and interrupt assignments;
- clock and reset requirements;
- external connections that define the documented role;
- source tool/version and last-reviewed fingerprint; and
- any fact directly referenced by human prose.

The side panel should render volatile or exhaustive data dynamically:

- complete parameter and port lists;
- all internal nets;
- canvas geometry;
- generated file locations;
- vendor diagnostics and validation warnings;
- tool-propagated values not selected as documentation-relevant; and
- live navigation to neighboring components.

This keeps Markdown useful in code review, static sites, and printed output
without turning every vendor regeneration into a large documentation diff.
Users may promote a dynamic fact into the Markdown summary, which also pins it
as fingerprint-relevant.

Possible document states are:

| State | Meaning |
|---|---|
| Current | The documented entity has no relevant source changes |
| Source changed | Relevant properties or connections changed |
| Unvalidated | Declared state was extracted, but current resolved behavior could not be validated |
| Missing | The design entity has no attached document |
| Orphaned | The documented entity no longer exists |
| Ambiguous rename | A similar new entity may be the renamed original |
| Suggested update | A proposed AI or manual patch awaits review |

### Stable Identity

Stable identity is one of the main technical risks.

- Do not assume that a portable vendor identity survives rename, copy, export,
  or recreation. The documented AMD and Intel scripting interfaces primarily
  expose object or instance names.
- Give each documentation target an IPCraft-owned immutable `docId`.
- Bind the `docId` to the current vendor selector, such as design identity plus
  hierarchical instance path.
- Preserve previous selectors as aliases after an accepted rename.
- When an old path disappears and a structurally similar instance appears,
  suggest a rename or relink operation.
- Do not automatically move documentation when the match is ambiguous.
- Treat a copied instance as a new entity even when it has the same type and
  parameters.

Rename matching should score component type and version, parent hierarchy,
interfaces, parameters, and neighboring connection endpoints. A unique,
high-confidence match may be suggested, but the user must approve the binding
change. This separates durable documentation identity from unstable vendor
names.

Diagram layout preferences should also be keyed by stable entity identity so
that a refresh does not destroy IPCraft-specific positioning.

## Stored State and Version Control

The complete normalized graph should be a derived cache, not a checked-in
source artifact. Checking it in would create a second representation of the
vendor system, produce large diffs, and invite users to edit generated state.

Store the full graph under IPCraft's workspace cache and reconstruct it when:

- the vendor source hash changes;
- the adapter or normalized schema version changes;
- the configured vendor tool version changes; or
- the user explicitly requests a refresh.

A small, checked-in documentation manifest should contain:

- design source locators and required tool version or compatible version range;
- `docId` to vendor-selector bindings and accepted aliases;
- document and group mappings;
- template selection;
- fingerprint inclusion or exclusion overrides; and
- the last reviewed semantic baseline for each documented entity.

The reviewed baseline must contain enough normalized facts to explain a change,
not only a hash. Without it, another developer or CI job could detect staleness
but could not show what changed. It should omit exhaustive vendor metadata and
remain stable and human-reviewable.

The minimum baseline for each entity is:

- `docId`, entity kind, current vendor selector, and accepted aliases;
- component or subsystem type and version;
- parent hierarchy and group membership;
- interface identity, protocol, role, width, and external-export state;
- canonical connection endpoints;
- clock frequency, phase where relevant, and domain association;
- reset polarity, synchrony, and domain association;
- address-space owner, base, span, and access properties;
- interrupt source, destination, number or order, and trigger properties;
- semantic parameter name, normalized value, source strength when available,
  and whether it was declared or propagated;
- validation status and tool version; and
- one fingerprint computed from this canonical semantic subset.

Sort maps by canonical key, connections by normalized endpoint tuple, and
numeric values by integer value rather than vendor spelling. This prevents
ordering, hexadecimal formatting, and report presentation from creating false
changes.

This gives the project three clear ownership levels:

| Data | Ownership | Checked in |
|---|---|---|
| Vendor design | Vendor tool and developer | Yes |
| Documentation, manifest, and reviewed semantic baseline | Developer with IPCraft assistance | Yes |
| Full normalized graph and indexes | IPCraft-derived cache | No |

## Optional LLM Assistance

The LLM should receive a focused evidence package rather than an unrestricted
copy of the workspace:

- the existing document;
- a structured before-and-after design diff;
- current component parameters;
- direct connections and neighboring components;
- explicitly selected HDL or software sources; and
- the target documentation template.

The model should return a constrained patch for named sections, not a complete
replacement Markdown file.

For example:

> AXI DMA changed from simple mode to scatter-gather mode. Generated facts were
> updated automatically. Update the Design Decisions and Operational Behavior
> sections?

The user should then review an ordinary diff:

```diff
- The scatter-gather engine is disabled because buffers are statically allocated.
+ Scatter-gather mode is enabled to support chained receive buffers.
```

Potential AI actions include:

- Draft missing documentation.
- Explain a detected source change.
- Propose updates for selected stale sections.
- Find prose claims contradicted by the current design.
- Summarize a subsystem.
- Draft a bring-up or debugging checklist.

Suggestions should identify the evidence that caused them. When the source
shows configuration but does not establish intent, the model should state that
the reason is unknown rather than inventing one.

### Source Privacy and Model Providers

LLM integration must be opt-in and disabled by default for a workspace. IPCraft
should support three explicit modes:

- `off`: no model calls or model-oriented context preparation;
- `external`: send only a user-approved evidence bundle to a configured
  provider; and
- `local`: use a configured local or organization-hosted model endpoint.

Before every external request, show the exact files and structured design facts
that will be sent. Default to the normalized diff and selected documentation;
do not include HDL, constraints, generated netlists, memory initialization
files, credentials, or the entire workspace. Additional source files require
explicit selection.

The provider boundary should be narrow and independent of the documentation
logic. IPCraft should not claim that a hardware project remains private merely
because a provider offers a no-training setting; retention, regional
processing, contractual controls, and organization policy are separate
concerns.

A bundled local model is not required for the first AI release. A configurable
local endpoint is sufficient initially. However, external AI must remain
optional, and an offline path is required before positioning the feature for
air-gapped or highly confidential FPGA programs.

The evidence bundle and returned patch may be saved locally for audit only
after an explicit project setting. Provider credentials must use VS Code secret
storage and must never appear in documentation metadata.

## Manual Editing and Direction of Synchronization

The side panel should support:

- rendered Markdown;
- direct Markdown editing;
- opening the source document in the VS Code editor;
- reviewing source changes;
- accepting or rejecting AI suggestions;
- marking a document reviewed without changing its text; and
- relinking an orphaned document to a renamed entity.

Editing documentation should not modify the Vivado or Platform Designer
design. Documentation is a view of and explanation for the design, not a
second configuration interface.

Carefully selected structured properties could become bidirectional in a later
feature, but that should not be combined with the first implementation because
it would make source ownership unclear.

## Suggested Delivery Phases

### Phase 1: Useful Without AI

- Import one vendor system format.
- Normalize components and connections.
- Render a read-only system diagram.
- Pin a selected component in a documentation panel.
- Map components to Markdown files.
- Show missing and orphaned documentation.

### Phase 2: Deterministic Synchronization

- Store semantic snapshots and fingerprints.
- Show graph, parameter, and connection diffs.
- Generate protected facts tables.
- Detect likely instance renames.
- Add documentation status badges.

### Phase 3: Optional AI Assistance

- Draft documents from templates.
- Update individual sections from a structured diff.
- Review suggestions through the VS Code diff UI.
- Show which evidence files informed a suggestion.

### Phase 4: System-Level Documentation

- Document connections, address paths, interrupts, clocks, and resets.
- Group components into documented subsystems.
- Generate system architecture overviews and bring-up guides.
- Detect incomplete or contradictory documentation.

## Recommended Minimum Viable Product

Start with Vivado IP Integrator, Markdown sidecars, and deterministic
stale-document detection.

The first adapter should accept either a checked-in `.bd` or a project
recreation Tcl flow, open it with a configured matching Vivado release, and
extract the effective graph through supported `get_bd_*` queries. Static
inspection of `write_bd_tcl` may be offered later as a partial mode, but it
must not be presented as equivalent because default and propagated parameters
are absent.

The first version should not require an LLM. If developers find the diagram,
documentation mapping, and change detection useful by themselves, AI assistance
can be added to an already trustworthy workflow.

The proposed product promise is:

> IPCraft keeps generated design facts synchronized automatically, identifies
> explanations that may have become stale, and optionally helps developers
> update them. Human intent always remains under developer control.

## Architecture Decisions

The initial open questions are resolved as follows:

| Question | Decision |
|---|---|
| Stable vendor representation | Keep the vendor's checked-in source authoritative and extract through the matching vendor release's supported object API. Recreation Tcl is supported as source, but is not assumed to contain complete effective state. |
| Normalized graph storage | Keep the full graph as a derived cache. Check in only documentation bindings and a compact reviewed semantic baseline. |
| Fingerprint parameters | Always include externally visible structure and behavior. Include unknown user-set parameters conservatively, with adapter classification and project overrides for noise. |
| Stable entity identity | Use IPCraft-owned `docId` values. Bind them to vendor paths and preserve approved aliases; do not assume vendor names survive rename or export. |
| Groups and reusable subsystems | Support separate type, instance, and explicit group documentation. Treat vendor hierarchy as a built-in group and allow checked-in logical groups. |
| Configurable templates | Yes, after the built-in template contract is proven. Templates may customize prose structure but not generated markers or identity metadata. |
| LLM source access | Default off. Send an explicit, previewed allowlist. Support external and configurable local endpoints without making AI a core dependency. |
| Markdown versus dynamic facts | Put stable review-facing facts and prose dependencies in Markdown. Render exhaustive, volatile, and navigational data dynamically. |

## Answers to Prototype Questions

### Extraction Lifecycle and Performance

Do not keep a persistent vendor process in the MVP. Vendor processes consume
substantial memory, may hold floating licenses, accumulate project state, and
complicate cancellation and extension shutdown. Use one batch extraction,
write the normalized cache atomically, then exit.

The interaction model should be:

1. Opening documentation reads the last valid cache immediately.
2. A changed source hash marks the view as stale without launching a tool.
3. The user runs Refresh, or enables refresh-on-save for that project.
4. IPCraft shows batch progress and supports cancellation.
5. A successful extraction atomically replaces the cache.

Measure cold tool startup, project load, validation, query, and serialization
separately. Use representative designs at approximately 20, 100, and 500
instances with flat and three-level hierarchical variants. The initial product
budgets are:

| Operation | Target |
|---|---|
| Display cached diagram and documentation | Less than 500 ms |
| Detect source-hash change | Less than 100 ms after file notification |
| Serialize graph after the vendor design is loaded | Less than 2 s for 100 instances |
| Complete cold refresh | Report progress within 1 s; no fixed promise until measured |

Only introduce a reusable worker process if measurements show that startup
dominates refresh time and the vendor supports a clean project close/reopen
cycle. Even then, make it an opt-in session worker with an idle timeout, one
queued extraction at a time, and an explicit license-use indicator.

### Tool-Version Compatibility

Use one normalized adapter per vendor flow, with capability probing at runtime,
rather than a separate adapter selected only by release number. Core Vivado
`get_bd_*` and Platform Designer system-query command families exist across
multiple releases, but individual properties, IP parameters, validation
behavior, and Standard-versus-Pro capabilities can differ.

Each extractor should emit a capability record such as:

```yaml
capabilities:
  hierarchy: complete
  connections: complete
  addresses: complete
  clocks: partial
  resets: partial
  declaredParameters: complete
  propagatedParameters: complete
  layout: unavailable
```

The support policy should be:

- certify the exact release used by IPCraft CI and one immediately preceding
  release;
- treat other releases as best-effort until a golden fixture passes;
- maintain separate certification rows for Quartus Standard and Pro;
- fail with a precise unsupported-command report rather than guessing from a
  version string; and
- isolate release-specific property mappings inside the vendor adapter.

Adding a release requires running the same golden designs and comparing the
normalized semantic graph, not only checking that the extraction script exits
successfully.

### Intended Versus Effective Parameters

Neither pre-validation nor post-validation state alone is sufficient.

- Pre-validation state best represents explicit developer input.
- Post-validation state best represents generated hardware behavior.
- Documentation should show both when they differ.
- The resolved post-validation graph drives behavioral staleness.
- The declared graph explains causality and supports source review.

For example, a user may set one AXI data width while Vivado propagates a
different width through a connected interface, or Platform Designer may insert
adaptation based on connected Avalon properties. The documentation diff should
say that the user changed one endpoint and the tool propagated the downstream
effect.

### Rename Detection

Rename detection should optimize for precision rather than recall. Missing a
rename suggestion costs a manual relink; a false rename can attach engineering
intent to the wrong hardware.

Apply these rules:

1. Exclude candidates already bound to another `docId`.
2. Require the same entity kind and a compatible component identity.
3. Prefer the same parent hierarchy and unchanged interface signature.
4. Compare semantic parameters and connection neighborhoods after replacing
   the old instance name with the candidate name.
5. Reject automatic confidence when more than one candidate has an equivalent
   score.
6. Present the before-and-after evidence and require user confirmation.

A changed name with the same parent, type, parameters, interfaces, and
neighbors is a strong rename candidate. Two identical newly created instances
are ambiguous. Copy followed by delete cannot be distinguished reliably from
rename using graph state alone, which is why IPCraft must never relink without
confirmation.

Build a characterization corpus containing rename, move into hierarchy,
IP-version upgrade, duplicate, copy-and-delete, and swap-name operations. The
acceptance criterion is no silent relinking and very high suggestion precision;
low-confidence cases should deliberately remain orphaned.

### Minimum Reviewed Baseline

The baseline defined in Stored State and Version Control is sufficient for
useful system documentation diffs. In particular, it preserves:

- endpoint tuples for structural connection changes;
- clock and reset domain semantics;
- address owner, base, and span;
- interrupt routing and order;
- component type and version;
- declared-versus-propagated semantic parameters; and
- validation/tool provenance.

Do not store every pin or vendor property by default. A document can promote an
additional fact into its baseline when prose depends on it. Golden tests should
prove that reordering, layout changes, hexadecimal spelling, and regenerated
temporary paths do not alter the fingerprint.

### Microchip and Lattice Scope

The first Microchip and Lattice adapters should explicitly advertise reduced
capabilities.

For Libero SmartDesign, combine the vendor-generated component-description Tcl
with the IP report. The documented IP report includes core instances, VLNV
identity, state, and Tcl parameters, while SmartDesign Tcl represents
construction and pin connectivity. A first adapter can reasonably target
hierarchy, instances, parameters, pins, and explicit connections. Address
maps, derived clock/reset domains, and effective propagated values remain
unavailable unless a supported report or query is demonstrated. See the
[Libero IP Report description](https://onlinedocs.microchip.com/oxy/GUID-AFCB5DCC-964F-4BE7-AA46-C756FA87ED7B-en-US-20/GUID-DD5BFD75-BB76-49D8-99EA-EC328F43A5FD.html).

For Lattice Propel, consume only canonical Tcl emitted by the documented
`sbp_design gen_tcl` flow. Recognize the finite set of commands emitted by
supported Propel releases; do not execute or attempt to interpret arbitrary
user Tcl offline. Initially target instances, IP identity, parameters,
interfaces, connections, and explicit address assignments. Mark inferred
domains and resolved interconnect behavior unavailable until Propel exposes
them through a characterized supported API.

For both vendors:

- validate canonical exports against projects recreated by the vendor tool;
- reject or require vendor execution when the script contains unsupported Tcl
  control flow;
- expose missing capabilities in the UI and normalized graph;
- never fill an unavailable fact with an inference presented as authoritative;
  and
- graduate a capability from partial to complete only after golden-project
  comparison across two tool releases.

## Remaining Measurements

The architecture questions now have provisional answers. The following values
still require access to licensed vendor installations and representative
projects:

- cold and warm extraction duration by design size;
- memory and license behavior of a possible session worker;
- exact Vivado, Quartus Standard, and Quartus Pro certification matrix;
- parameter-property coverage before and after validation for representative
  AMD and Intel IP;
- rename-suggestion precision on the characterization corpus; and
- Libero and Propel normalized-graph completeness compared with their GUIs and
  generated reports.
