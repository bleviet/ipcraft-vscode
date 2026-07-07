# Gemini 3.5 Flash - Redesign Concept

This concept addresses the requirements of Issue #41 by redesigning the IPCraft extension icon to represent both the IP Core canvas and the Memory Map editors.

## Design Philosophy

The current icon only depicts register rows (Memory Map), completely missing the block-level layout (IP Core canvas). This redesign retains the distinctive identity (warm gradient, clean geometry) while introducing explicit visual representations of the block connectivity.

## Key Visual Elements

1. **Central Chip Frame (The Core Block)**
   - A bold, rounded rectangular block at the center representing the IP block container.
   - Using the brand gradient border for a strong, recognizable silhouette.

2. **External Ports & Bus Interfaces (IP Core Canvas)**
   - **Individual Port Pins**: Thin, rounded lines extending from the left and right edges. These represent discrete control signals (clock, reset, interrupts) commonly defined on the IP Core canvas.
   - **Bus Interfaces**: Stylized filled blocks touching the left and right edges of the main chip frame. These represent high-level bus interfaces (such as AXI-Lite or Avalon-MM) with embedded signal indicator lines.

3. **Internal Registers & Bitfields (Memory Map)**
   - Inside the core, three horizontal rows represent registers.
   - **Inactive Registers**: The top and bottom rows have a light opacity fill, representing unselected registers.
   - **Active Register**: The middle row is highlighted with a solid stroke and a fully-opaque active bitfield filled with the brand gradient.
   - Thin vertical dividers represent individual bitfields.

## Scalability & Theme Compatibility

- **High Contrast**: The warm orange-to-rose brand gradient (`#FF512F` -> `#DD2476`) is highly visible on both light and dark backgrounds.
- **Thicker Lines**: Increased stroke widths ensure that details do not disappear when downscaled to 32px or 40px in the VS Code marketplace.
- **Visual Balance**: Safe margins and padding prevent cropping when the platform applies rounded corners to the extension icon.
