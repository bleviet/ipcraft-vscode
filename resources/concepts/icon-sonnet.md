# Icon concept — variant S (Sonnet 5)

**Concept: "Portcore."** The mark renders the IP core itself as a compact chip
block whose silhouette is broken by six connection points: two padded
bus-interface stubs on the left, two mirrored on the right (the AXI-Lite /
Avalon-MM style interfaces a user drags and wires in the IP Core canvas), and
two slimmer single-signal pins top and bottom (clock/reset-style ports). Every
pin shares the block's own stroke weight and gradient, so the whole thing reads
as one continuous line system rather than "border plus decoration" — that is
what keeps it a single committed idea rather than a diagram.

Inside the block sits a small 3x2 grid with one cell lit solid: the
register/bitfield map, present but clearly subordinate to the block-and-ports
silhouette. At Marketplace size it reads as "there's structured data in here,
and one field is active"; at 32-40px it recedes to a soft texture while the
thick-stroked, round-capped chip-with-pins outline stays crisp — a shape no
other extension icon in this space claims.

**Color:** kept the existing `#FF512F -> #DD2476` gradient, but mapped it once
across the whole composition (`gradientUnits="userSpaceOnUse"`) so the block,
pins, and pads all sit on one continuous color field instead of each shape
re-gradienting independently — preserving brand recognition while giving the new
geometry a coherent, confident finish in both themes.

Verified at 512px, 128px, 40px, and 32px against both white and dark (#1e1e1e)
backgrounds.
