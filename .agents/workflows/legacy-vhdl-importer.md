---
description: 'Workflow for extracting IPCraft specifications from existing VHDL entities.'
---

# Legacy VHDL Importer Workflow

Follow these steps to migrate an existing VHDL component into the IPCraft system.

1. **Source Analysis**
   - Identify the VHDL source file (`.vhd`).
   - Extract the entity name, generics, and ports.

2. **Automated Parsing**
   - Run the builtin `VhdlParser.ts` logic to generate the initial `.ip.yml`.
   - Use the `IpArchitect` skill to refine the generated specification.
   - Map remaining signals to logical names.

3. **Register Map Reconstruction**
   - Identify address decoding logic in the VHDL architecture.
   - map `std_logic_vector` registers to `.mm.yml` register and field definitions.
   - Assign bit ranges for control and status flags.

4. **IP Serialization**
   - Save the refined `.ip.yml` and `.mm.yml` in the project folder.
   - Use the IPCraft extension to open the new IP Core.

5. **Refactoring**
   - Optional: Replace the manual VHDL register logic with the IPCraft-generated `ip_core_regs.vhd`.
   - Connect user signals to the new register block ports.

6. **Validation**
   - Generate the code and verify the VLNV matches the project requirements.
   - Run existing simulation tests to ensure no regression.
