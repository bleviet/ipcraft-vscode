---
name: brand-guidelines
description: Applies bahonavi's official brand colors, gradients, and typography to any artifact that may benefit from having bahonavi's look-and-feel. Use it when brand colors or style guidelines, visual formatting, or company design standards apply.
---

# bahonavi Brand Styling

## Overview

bahonavi (*Back Home Navigation*) builds intelligent software, web applications, Python automation, and FPGA solutions. The visual identity bridges **technology and heritage** — modern, dark-first interfaces with warm brand accents that recall direction, guidance, and craftsmanship.

**Keywords**: branding, corporate identity, visual identity, styling, brand colors, typography, bahonavi brand, visual formatting, visual design, dark theme, light theme

---

## UI Color System

The website uses a token-based color system with a **dark theme (default)** and an optional **light theme**.

### Dark Theme (default)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#050811` | Page background |
| `--bg-card` | `#0c1123` | Card / panel background |
| `--surface` | `rgba(255,255,255,0.05)` | Elevated surfaces (buttons, chips) |
| `--line` | `rgba(255,255,255,0.08)` | Borders and dividers |
| `--text` | `#d4deee` | Primary body text (soft blue-white, reduced eye strain) |
| `--muted` | `#7a8fa8` | Secondary / muted text |
| `--accent` | `#00f2fe` | Highlight accent (cyan) |
| `--nav-bg` | `rgba(5,8,17,0.84)` | Navbar background (frosted glass) |
| `--shadow` | `0 20px 60px rgba(0,0,0,0.36)` | Card drop shadow |

### Light Theme

| Token | Value | Role |
|---|---|---|
| `--bg` | `#e8ecf5` | Page background (blue-gray, more character) |
| `--bg-card` | `#f1f4fb` | Card / panel background |
| `--surface` | `rgba(0,0,0,0.07)` | Elevated surfaces (buttons, chips) |
| `--line` | `rgba(0,0,0,0.14)` | Borders and dividers |
| `--text` | `#0d1120` | Primary body text |
| `--muted` | `#3d5370` | Secondary / muted text (deeper, more readable) |
| `--accent` | `#006ea3` | Highlight accent (richer cyan-blue) |
| `--nav-bg` | `rgba(232,236,245,0.93)` | Navbar background (frosted glass) |
| `--shadow` | `0 20px 60px rgba(0,0,0,0.12)` | Card drop shadow |

---

## Brand Colors (shared across both themes)

| Token | Value | Role |
|---|---|---|
| `--brand` | `#ff512f` | Primary brand color (orange-red) |
| `--brand-2` | `#dd2476` | Secondary brand color (pink) |
| `--grad` | `linear-gradient(135deg, #ff512f → #dd2476)` | CTA buttons, step badges, dividers |

> These two colors and the gradient are **never overridden** by the light theme — they are always used the same way regardless of theme.

---

## Brand Gradient

The signature gradient is used on all primary calls-to-action, step-number badges, and process dividers.

```css
background: linear-gradient(135deg, #ff512f 0%, #dd2476 100%);
```

**Usage:** CTA buttons (`.btn`), process step numbers (`.step-num`), gradient text on headings (`.grad-text`), process step dividers.

---

## Accent & Node Colors

Used in diagrams, SVG nodes, and decorative elements.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--node-cyan` | `#4facfe` | `#005e9e` | Primary diagram node |
| `--node-pink` | `#f5576c` | `#b51c3c` | Secondary diagram node |
| `--node-purple` | `#da22ff` | `#8a0ea8` | Tertiary diagram node |

---

## Logo SVG Gradients

The bahonavi logomark uses four internal gradients that are **theme-independent**.

| ID | Direction | Color Stop 1 | Color Stop 2 |
|---|---|---|---|
| `nPG` — pillar | top → bottom | `#FF512F` | `#DD2476` |
| `nLG` — left arm | bottom-right → top-left | `#DA22FF` | `#9733EE` |
| `nRG` — right arm | bottom-left → top-right | `#F5576C` | `#F093FB` |
| `nOG` — orbit glow | left → right | `#00f2fe` (80%) → `#4facfe` (10%) → `#00f2fe` (60%) |

---

## Typography

| Role | Font | Fallback | Weights |
|---|---|---|---|
| **Headings / Display** | Space Grotesk | system-ui, sans-serif | 500, 700 |
| **Body Text** | Manrope | system-ui, sans-serif | 400, 500, 700 |

### Typographic Rules

- Headings use **Space Grotesk** with tight letter-spacing (`−0.03em` to `−0.04em`) and line-height `1.03–1.12`.
- Body text uses **Manrope** at `line-height: 1.6`.
- Section labels are uppercase Space Grotesk at `0.76rem` with `letter-spacing: 0.18em`.
- Brand name accents (e.g. nav chips) use `letter-spacing: 0.08em` uppercase.

---

## Layout & Shape Tokens

| Token | Value | Usage |
|---|---|---|
| `--r` | `20px` | Default border radius for cards and panels |
| `--max` | `1140px` | Max content width |
| Base font | `"Manrope", sans-serif` | Body default |
| Body line-height | `1.6` | Comfortable reading |

---

## Color Application Principles

1. **Dark-first.** The default experience is dark (`#050811` background). Light theme is an opt-in alternative.
2. **Brand gradient for action.** The orange→pink gradient signals interactivity and importance. Reserve it for CTAs, key highlights, and step indicators.
3. **Cyan accent for information.** `--accent` (cyan `#00f2fe` / `#0097c4`) marks links, chips, and informational callouts.
4. **Muted for secondary content.** `--muted` grays carry supporting text, captions, and icon defaults. Use sparingly to preserve hierarchy.