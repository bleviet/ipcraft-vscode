---
description: 'Step-by-step workflow to go from an IP core idea to a generated project.'
---

# New IP Foundry Workflow

Follow these steps to design and generate a new IP core using IPCraft.

1. **Information Gathering**
   - Ask the user for the IP core name, function, and target vendor (AMD, Altera, or both).
   - Identify the bus interface needed (AXI4L, AVALON_MM).
   - List key parameters (e.g., `ADDR_WIDTH`, `DATA_WIDTH`).

2. **Core Specification (`.ip.yml`)**
   - Use the `IpArchitect` skill to define the VLNV and port mappings.
   - Create a clock/reset definition.
   - Map bus interfaces to logical prefixes (e.g., `s00_axi_`).

3. **Memory Map Design (`.mm.yml`)**
   - Define address blocks (e.g., `CONTROL_BLOCK`).
   - Group registers logically (0x0 for Control, 0x4 for Status, 0x8 for Data).
   - Define bit fields with appropriate access (RW/RO).

4. **YAML Generation**
   - Provide the complete, valid YAML for both files.
   - Save to the `ipcraft-spec/examples/` or a new project directory.

5. **RTL Generation**
   - Instruct the user to open the IP core in the IPCraft VS Code extension.
   - Use the "Generator Panel" to select the vendor and target folder.
   - Click "Generate IP Core" to produce the VHDL and vendor files.

6. **Verification**
   - Use the `CocotbTestGen` skill to create a testbench for the new design.
   - Run simulation and verify correctness.
