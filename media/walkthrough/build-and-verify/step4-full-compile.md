## Full synthesis and implementation

Once OOC timing is clean, run full synthesis + place + route to get final, board-specific results.

### When to use full implementation

| Scenario | Use |
|----------|-----|
| IP verification, iteration | OOC synthesis |
| Final timing signoff on a specific board | Full implementation |
| Place-and-route specific optimisations | Full implementation |
| Board bring-up / release | Full implementation |

### Prerequisites

Full implementation requires a board project:

- **Vivado:** A `.xpr` project file pointing at your board (device + constraints)
- **Quartus:** A `.qpf` project file with device and pin assignments

Run **IPCraft: Generate Vivado Project** or **IPCraft: Generate Quartus Project** to create these from your `.ip.yml`.

### Running the build

Run **IPCraft: Build** (or click the status bar button). IPCraft auto-detects available targets from your workspace and prompts if both Vivado and Quartus projects exist.

### Build jobs

Set `ipcraft.build.jobs` to control parallel synthesis threads. The default is 4. Higher values speed up synthesis but require more memory (each Vivado job uses ~2–4 GB RAM).

### Iterating after implementation

If timing fails in full implementation but passed OOC:

1. Check whether board-specific constraints are tighter than the OOC clock period
2. Look for paths that cross between clock domains — CDC violations show in the Build Reports panel
3. Add pipeline registers to the critical path in `*_core.vhd` and re-scaffold

> **Tip:** Keep OOC green before running full implementation. A failing OOC almost always fails full implementation too — and OOC is 10× faster to iterate on.
