# AI Design Guide

This guide provides best practices for using AI (like Antigravity or ChatGPT) to accelerate your IP core development with IPCraft.

## AI Roles

When working with IPCraft, treat your AI assistant as a specialist in one of the following roles:

| Role | Responsibility |
|------|----------------|
| **IP Architect** | Designs the VLNV, bus interfaces, and memory map structure. |
| **Verification Engineer** | Writes `cocotb` testbenches and automated test scripts. |
| **RTL Specialist** | Helps refactor manual VHDL into IPCraft-managed registers. |

---

## Prompting Templates

### 1. Generating a New IP Core
Use this template to start a new design:
> "I want to design a [Function Name] IP core with a [Bus Type] interface. It needs [Number] registers for [Functionality]. Please generate the `.ip.yml` and `.mm.yml` files using the IPCraft specification."

### 2. Adding Registers to Existing Core
> "I have an existing `.mm.yml`. I need to add a status register at offset [Offset] with these fields: [Field 1: 2 bits], [Field 2: 1 bit]. Please provide the updated YAML."

### 3. Generating a Testbench
> "I've generated the VHDL for my [Entity Name] IP. Please write a `cocotb` Python testbench that verifies the reset values of all registers in the attached `.mm.yml`."

---

## Best Practices

### Aligning to Word Boundaries
IPCraft works best with 32-bit word-aligned registers. Always ask the AI to ensure offsets are multiples of 4 (0x0, 0x4, 0x8, etc.).

### Using Logical Names
Always define clear `logicalName` properties for ports and clocks. This allows IPCraft to automatically associate signals in the vendor-specific files (Altera `.tcl`, AMD `.xml`).

### Spatial Interaction
If the AI generates a layout that feels "cramped," you can use the **IPCore Editor** in VS Code to drag and resize bit fields visually. The AI is excellent at initial layout, while the visual editor is best for fine-tuning.

---

## Built-in AI Skills
If you are using a workspace-aware AI like Antigravity, you can use the following specialized skills:
- `@/ip-architect`: For IP and memory map design.
- `@/cocotb-test-gen`: For verification and testbench scaffolding.
- `@/new-ip-foundry`: A workflow for starting new projects.
- `@/legacy-vhdl-importer`: A workflow for migrating old code.
