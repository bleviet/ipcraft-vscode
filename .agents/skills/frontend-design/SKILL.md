---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality anchored to bahonavi's brand. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics and stays on-brand for bahonavi.
---

This skill guides creation of distinctive, production-grade frontend interfaces for bahonavi that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices, always grounded in the bahonavi brand identity.

> **Brand reference**: Always consult `skills/brand-guidelines/SKILL.md` for the full bahonavi color system, typography, gradients, and design tokens before generating any UI.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

---

## Design Thinking

Before writing code, understand the context and commit to a clear aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose a deliberate aesthetic direction — brutally minimal, maximalist, retro-futuristic, editorial/magazine, luxury/refined, brutalist/raw, art deco/geometric, industrial/utilitarian, etc. Use these as a starting point and execute one that is true to the bahonavi brand context.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What single thing will someone remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and fully functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

---

## bahonavi Brand Constraints

All generated interfaces must respect the bahonavi brand system. Key rules:

### Color
- **Dark theme is the default**. Start with `--bg: #050811` and the dark token set unless explicitly asked for light.
- **Brand gradient** (`linear-gradient(135deg, #ff512f 0%, #dd2476 100%)`) is reserved for CTAs, step badges, and high-importance highlights — do not dilute it.
- **Cyan accent** (`#00f2fe` dark / `#0097c4` light) marks informational elements, links, and chips.
- Use `--muted` grays for supporting text — never compete with the primary hierarchy.
- Support light theme by overriding only the tokens documented in `brand-guidelines`.

### Typography
- **Display/Headings**: Space Grotesk (500, 700) — tight letter-spacing (`−0.03em` to `−0.04em`), line-height `1.03–1.12`.
- **Body**: Manrope (400, 500, 700) — `line-height: 1.6`.
- Section labels: uppercase Space Grotesk, `0.76rem`, `letter-spacing: 0.18em`.
- Load from Google Fonts: `Space Grotesk` + `Manrope`.

### Layout Tokens
- Border radius: `--r: 20px` for cards and panels.
- Max content width: `--max: 1140px`.
- Use `width: min(var(--max), calc(100% - 2.5rem)); margin: 0 auto` for containers.

### CSS Variable Usage
Always declare and consume the full token set in `:root` and `[data-theme="light"]` overrides. Never hardcode colors that belong to the token system.

---

## Frontend Aesthetics Guidelines

Within the bahonavi brand constraints, push creative boundaries on:

- **Typography**: Pair Space Grotesk's sharp geometry with Manrope's warmth. Use `clamp()` for fluid type scaling. Exploit letter-spacing, contrast between display and body weights, and `.grad-text` (background-clip gradient) for hero headlines.
- **Color & Theme**: Commit fully to the dark-first aesthetic. Layer depth with `--surface`, `--bg-card`, and `--bg` as distinct elevation levels. Use the brand gradient sparingly but boldly.
- **Motion**: Prioritize CSS-only animations. One well-orchestrated page-load with staggered `animation-delay` reveals beats scattered micro-interactions. Use `backdrop-filter: blur()` for frosted glass navbars/modals. Animate logo nodes, radar ripples, and glows consistent with the homepage's animation language.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Grid-breaking elements. Generous negative space OR controlled density — never the forgettable middle ground.
- **Backgrounds & Visual Depth**: Avoid flat solid backgrounds. Use radial gradients for hero glows (matching `--hero-glow-1`/`--hero-glow-2` tokens), noise textures, layered transparencies, and `box-shadow` drama. The `--shadow` token (`0 20px 60px rgba(0,0,0,0.36)`) sets the baseline — go deeper for featured elements.

---

## What to Avoid

- **Generic AI aesthetics**: Predictable card grids, purple-on-white gradients, cookie-cutter layouts.
- **Off-brand choices**: Do not introduce new accent or brand colors not in the brand-guidelines skill. Do not swap out Space Grotesk or Manrope for unrelated fonts on bahonavi surfaces.
- **Hardcoded colors**: Any value that exists as a CSS token must be used through the token, not hardcoded.
- **Timid palettes**: Evenly distributed, low-contrast color usage. The brand's deep dark backgrounds exist to make the orange→pink gradient and cyan accent pop — use that contrast.
- **Over-animated interfaces**: Motion should feel purposeful. Every animated element must serve the user's comprehension or emotional response, not decorate aimlessly.

---

## Implementation Checklist

Before delivering any UI output, verify:

- [ ] Full CSS token set declared in `:root` (dark) and `[data-theme="light"]` override block
- [ ] Google Fonts import for Space Grotesk + Manrope
- [ ] Brand gradient used only on CTAs / high-importance highlights
- [ ] No hardcoded hex values that belong to the token system
- [ ] Responsive — tested at mobile, tablet, and desktop breakpoints
- [ ] Dark theme renders correctly as the default
- [ ] Animations are CSS-only (or Motion library for React) and feel deliberate
- [ ] Accessibility: sufficient color contrast, `aria-label` on icon-only buttons, semantic HTML

---

## Chart & Data Visualization Colors

Charts must feel like a natural part of the bahonavi UI — never a default-library color dump. All values below are tuned for eye comfort against both the dark and light backgrounds.

### Categorical Palette (series colors)

Use this ordered sequence for bars, pie/donut slices, and line series. Assign in order — do not skip.

| Index | Name | Dark value | Light value | Derivation |
|---|---|---|---|---|
| 1 | Cyan | `#4facfe` | `#005e9e` | `--node-cyan` |
| 2 | Coral | `#ff7354` | `#d63e1a` | `--brand` softened |
| 3 | Orchid | `#c76bff` | `#8a0ea8` | `--node-purple` muted |
| 4 | Rose | `#f5576c` | `#b51c3c` | `--node-pink` |
| 5 | Sky | `#74c7f0` | `#0079b3` | Cyan family, lighter step |
| 6 | Amber | `#f4a44a` | `#b06000` | Warm mid-range, distinct from brand |
| 7 | Mint | `#56d4b0` | `#1a7a62` | Cool-warm bridge |
| 8 | Mauve | `#9f7bea` | `#5c2e9a` | Purple family, muted |

> **Minimum contrast:** All series colors must meet WCAG AA (≥ 3:1) against `--bg-card` in the active theme. The values above are pre-validated for this. For ≤ 5 data series, use only indices 1–5 for cleaner visual separation.

### CSS Custom Properties for Charts

Declare these alongside the main token set so chart libraries can consume them via `getComputedStyle`:

```css
:root {
    /* Chart series — dark theme */
    --chart-1: #4facfe;
    --chart-2: #ff7354;
    --chart-3: #c76bff;
    --chart-4: #f5576c;
    --chart-5: #74c7f0;
    --chart-6: #f4a44a;
    --chart-7: #56d4b0;
    --chart-8: #9f7bea;

    /* Chart structural */
    --chart-bg:         var(--bg-card);
    --chart-grid:       rgba(255,255,255,0.06);
    --chart-axis:       rgba(255,255,255,0.12);
    --chart-label:      var(--muted);
    --chart-tooltip-bg: rgba(12,17,35,0.95);
}

[data-theme="light"] {
    --chart-1: #005e9e;
    --chart-2: #d63e1a;
    --chart-3: #8a0ea8;
    --chart-4: #b51c3c;
    --chart-5: #0079b3;
    --chart-6: #b06000;
    --chart-7: #1a7a62;
    --chart-8: #5c2e9a;

    --chart-grid:       rgba(0,0,0,0.05);
    --chart-axis:       rgba(0,0,0,0.12);
    --chart-tooltip-bg: rgba(241,244,251,0.97);
}
```

### Bar Chart Guidelines

- **Single-metric primary bar**: Fill with a subtle left→right gradient: `#4facfe → #00d4f5` (dark) / `#005e9e → #0079b3` (light).
- **Multi-series bars**: Use `--chart-1` through `--chart-N` in order. Keep bar opacity at `100%` — avoid transparency which muddies dark backgrounds.
- **Highlighted / max-value bar**: Apply the brand gradient (`--grad: linear-gradient(135deg, #ff512f, #dd2476)`) to the single standout bar only. Never to the whole series.
- **Bar background track** (horizontal ratio bars): `var(--chart-grid)` — just visible enough to show scale.
- **Bar radius**: `6px` rounded corners for standard; `999px` for compact pill bars.
- **Bar gap**: Minimum `30%` of bar width. Avoid cramped clusters.
- **Grid lines**: Horizontal only, `var(--chart-grid)`. No vertical grid lines.
- **Axis labels**: `var(--chart-label)`, Manrope `0.78rem`.
- **Value labels on bar**: `var(--text)`, Manrope `0.82rem` `font-weight: 700`.

### Pie / Donut Chart Guidelines

- Fill slices in `--chart-1` → `--chart-8` order.
- **Donut over pie**: Use inner radius ~55–60% of outer. The hole reduces visual weight and enables a center metric label.
- **Slice separation**: `2px` solid stroke using `var(--chart-bg)` — clean without harsh gaps.
- **Center label** (donut): Primary value in Space Grotesk 700 at `1.4rem`; sub-label in Manrope `0.78rem` `--muted`.
- **Hover**: Expand the hovered slice outward by `6–8px` (transform from slice center). Do not change slice color on hover — movement alone is sufficient feedback.
- **Legend**: Horizontal pill row below chart. Each item: `10px` circle swatch + Manrope `0.82rem` label, `1.2rem` gap between items.
- **Max slices**: 8. Group any tail beyond 8 categories as "Other" using `--chart-8` (mauve).

### Accessibility

- Never rely on color alone — pair each series with a pattern fill, shape, or direct data label.
- Wrap the chart in a container with `aria-label` describing what data it shows.
- Tooltips must be keyboard-reachable, or provide a visible `<table>` alternative.
- Re-verify `--chart-N` contrast against `--chart-bg` whenever theme tokens change.
