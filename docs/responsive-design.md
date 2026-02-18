# Responsive Design Technical Documentation

## Overview

This document explains the technical implementation of responsive design in the IP Core Editor VS Code extension. The responsive system adapts the UI for mobile (phones), tablet, and desktop screens using CSS media queries and dynamic component behavior.

## Breakpoint System

### CSS Variables

Defined in `src/webview/index.css`:

```css
:root {
    --sidebar-width: 300px;
    --sidebar-width-tablet: 240px;
    --sidebar-width-mobile: 280px;
    --breakpoint-mobile: 640px;
    --breakpoint-tablet: 900px;
    --breakpoint-desktop: 1200px;
    --touch-target-min: 44px;
}
```

### Breakpoints

| Name | Width | Target Devices |
|---|---|---|
| Mobile | `< 640px` | Phones (portrait & landscape) |
| Tablet | `640px - 900px` | Tablets, small laptops |
| Desktop | `> 900px` | Standard laptops, desktops |

## Core Components

### 1. Responsive Sidebar

**Location:** Both Memory Map Editor (`index.tsx`) and IP Core Editor (`ipcore/IpCoreApp.tsx`)

**Implementation:**

```tsx
// State management
const [sidebarOpen, setSidebarOpen] = useState(false);

// Toggle button (mobile only)
<button 
  className="sidebar-toggle-btn"
  onClick={() => setSidebarOpen(!sidebarOpen)}
>
  <span className="codicon codicon-menu"></span>
</button>

// Backdrop (overlay when sidebar open on mobile)
{sidebarOpen && (
  <div 
    className="sidebar-backdrop active" 
    onClick={() => setSidebarOpen(false)} 
  />
)}

// Sidebar with dynamic class and flex properties
<aside className={`sidebar flex flex-col shrink-0 overflow-y-auto ${sidebarOpen ? 'sidebar-open' : ''}`}>
```

**Key Layout Properties:**

The sidebar uses a combination of Tailwind and custom CSS to maintain visibility:

- `shrink-0` - Prevents the sidebar from shrinking when content grows
- `overflow-y-auto` - Enables vertical scrolling within the sidebar
- `flex-shrink: 0` - CSS property ensuring fixed width
- Fixed width via CSS variables

**CSS Behavior:**

```css
/* Base sidebar - fixed width, no shrinking */
.sidebar {
    width: var(--sidebar-width);
    flex-shrink: 0;
    border-right: 1px solid var(--vscode-panel-border);
    overflow-y: auto;
    background-color: var(--vscode-sideBar-background);
}

/* Mobile: Overlay sidebar */
@media (max-width: 640px) {
  .sidebar {
    position: fixed;
    left: -300px;
    width: var(--sidebar-width-mobile);
    z-index: 100;
    transition: left 0.3s;
  }
  
  .sidebar.sidebar-open {
    left: 0;
  }
  
  .sidebar-toggle-btn {
    display: inline-flex;
  }
}

/* Tablet: Narrower sidebar */
@media (min-width: 641px) and (max-width: 900px) {
  .sidebar {
    width: var(--sidebar-width-tablet);
  }
  
  .sidebar-toggle-btn {
    display: none;
  }
}

/* Desktop: Full width */
@media (min-width: 901px) {
  .sidebar {
    width: var(--sidebar-width);
  }
  
  .sidebar-toggle-btn {
    display: none;
  }
}
```

**Main Content Area:**

The content area (DetailsPanel/EditorPanel) must use proper flex constraints to prevent pushing the sidebar:

```tsx
// Memory Map Editor
{activeTab === 'yaml' ? (
  <section className="flex-1 vscode-surface overflow-auto min-w-0">
    <div className="p-6">
      <pre className="font-mono text-sm">{rawText}</pre>
    </div>
  </section>
) : (
  <section className="flex-1 overflow-hidden min-w-0">
    <DetailsPanel ... />
  </section>
)}

// IP Core Editor
<EditorPanel className="flex-1 overflow-y-auto min-w-0" ... />
```

**Critical Properties:**
- `flex-1` - Takes remaining space
- `min-w-0` - Prevents flex items from expanding beyond container
- `overflow-hidden` or `overflow-auto` - Constrains content within bounds

### 2. Responsive Visualizers

**Affected Components:**
- `AddressMapVisualizer.tsx`
- `RegisterMapVisualizer.tsx`
- `BitFieldVisualizer.tsx`

**Horizontal Scroll Pattern:**

```tsx
<div className="w-full">
  <div className="relative w-full flex items-start overflow-x-auto pb-2">
    <div className="relative flex flex-row items-end gap-0 pt-12 pb-2 min-h-[64px] min-w-max">
      {/* Content that may exceed container width */}
    </div>
  </div>
</div>
```

**Key Classes:**
- `overflow-x-auto` - Enables horizontal scrolling
- `min-w-max` - Prevents content squashing
- `pb-2` - Padding for scrollbar visibility

**Dynamic Block Sizing:**

```tsx
// Responsive min-width calculation
const minWidth = typeof window !== 'undefined' && window.innerWidth < 900 
  ? '80px'  // Tablet/mobile
  : '120px'; // Desktop

<div style={{ width: `${widthPercent}%`, minWidth }}>
```

**BitField Cell Sizing:**

Original implementation used `2.5rem` (40px) per bit cell, resulting in 1280px for 32-bit registers. This was reduced to `2rem` (32px), bringing the total to 1024px for better fit on smaller screens.

```css
/* CSS override for smaller screens */
@media (max-width: 900px) {
  .bitfield-visualizer .bit-cell {
    width: 1.5rem !important;
    height: 1.5rem !important;
  }
}
```

### 3. Responsive Tables

**Column Hiding on Tablet:**

```css
@media (min-width: 641px) and (max-width: 900px) {
  .fields-table th:nth-child(3),
  .fields-table td:nth-child(3) {
    display: none; /* Hide Access column */
  }
}
```

**Mobile Card View System:**

Prepared CSS classes for future card-based layout on mobile:

```css
@media (max-width: 640px) {
  .fields-table {
    display: none;
  }
  
  .fields-table-mobile {
    display: block;
  }
  
  .field-card {
    border: 1px solid var(--vscode-panel-border);
    padding: 12px;
    margin-bottom: 8px;
  }
}
```

### 4. Touch-Friendly Forms

**Mobile Optimizations:**

```css
@media (max-width: 640px) {
  /* Single column layout */
  .compact-form-grid {
    grid-template-columns: 1fr;
  }
  
  /* Touch-friendly sizes */
  input, select, textarea, button {
    min-height: var(--touch-target-min); /* 44px */
    font-size: 16px; /* Prevents iOS auto-zoom */
  }
  
  .form-group label {
    font-size: 14px;
  }
}
```

## Utility Classes

**Visibility:**
- `.hide-on-mobile` - Hidden on screens < 641px
- `.show-on-mobile-only` - Visible only < 641px
- `.hide-on-tablet` - Hidden on 641-900px range

**Layout:**
- `.stack-on-mobile` - Flexbox column on mobile, row on desktop
- `.responsive-container` - Full width with auto overflow

## Design Decisions

### Why These Breakpoints?

- **640px**: Typical landscape phone width threshold
- **900px**: Matches VS Code's existing responsive behavior
- **1200px**: Desktop optimization threshold

### Mobile-First vs Desktop-First

The implementation uses a **hybrid approach**:
- Base styles target desktop (most common use case)
- Mobile/tablet styles applied via `max-width` media queries
- This minimizes CSS override complexity

### Sidebar Toggle Approach

**Why not always show toggle button?**

The sidebar toggle is mobile-only by design because:
1. Desktop users need persistent navigation
2. VS Code paradigm keeps sidebars visible on desktop
3. Screen real estate is sufficient on desktop (>900px)

If users want a collapsible sidebar on desktop, this can be added as an enhancement.

### Left Alignment vs Centering

Initially, visualizers used `mx-auto` (center alignment). This was changed to left alignment to:
1. Maximize usable space on smaller screens
2. Create consistent left-to-right reading pattern
3. Align with standard web application conventions

## Testing Responsive Behavior

### Browser DevTools

1. Open VS Code extension webview
2. Right-click → Inspect
3. Toggle device toolbar (Cmd+Shift+M / Ctrl+Shift+M)
4. Test at various widths:
   - 375px (iPhone SE)
   - 768px (iPad)
   - 1024px (iPad Pro)
   - 1280px (13" MacBook)
   - 1920px (Desktop)

### Test Scenarios

- [ ] Sidebar overlays on mobile (<640px)
- [ ] Hamburger menu appears/disappears
- [ ] Visualizers scroll horizontally
- [ ] Tables hide columns on tablet
- [ ] Forms stack on mobile
- [ ] Touch targets meet 44px minimum

## Performance Considerations

### CSS-Only Transitions

Sidebar animations use CSS transitions (not JavaScript) for 60fps performance:

```css
.sidebar {
  transition: left 0.3s ease-in-out;
}
```

### Window Resize Handling

Dynamic calculations (like `window.innerWidth < 900`) are performed during render, not on resize events, to avoid performance issues.

### Lazy Loading

The extension doesn't implement lazy loading currently, but future optimizations could include:
- Virtualizing long field tables on mobile
- Progressive rendering for large register maps

## Future Enhancements

1. **Table Card Views**: Implement mobile card layout for field tables
2. **Swipe Gestures**: Close sidebar on swipe left
3. **Adaptive Typography**: Further scale font sizes based on screen
4. **Landscape Tablet**: Specific optimizations for 768px+ landscape
5. **Desktop Toggle**: Optional sidebar collapse on desktop

## Troubleshooting

### Outline/Sidebar Getting Pushed Off Screen

**Problem**: When adding many registers to an address block table, the outline (sidebar) gets pushed out of view and becomes invisible.

**Root Cause**: Without proper flex constraints, the content area can expand beyond its container, pushing the fixed-width sidebar off screen. This occurs when:
1. The sidebar lacks `flex-shrink: 0` property
2. The main content area doesn't have `min-w-0` constraint
3. Tables or content grow horizontally without overflow handling

**Solution**: Ensure proper flex layout constraints are applied:

```tsx
// Sidebar must have shrink-0 and overflow-y-auto
<aside className="sidebar flex flex-col shrink-0 overflow-y-auto">
  <Outline ... />
</aside>

// Content area must have flex-1, min-w-0, and overflow handling
<section className="flex-1 overflow-hidden min-w-0">
  <DetailsPanel ... />
</section>
```

```css
/* Sidebar CSS must include flex-shrink: 0 */
.sidebar {
    width: var(--sidebar-width);
    flex-shrink: 0;  /* Critical - prevents shrinking */
    overflow-y: auto;
    /* ... */
}
```

**Key Points:**
- `flex-shrink: 0` (or `shrink-0` class) prevents the sidebar from losing its width
- `min-w-0` on content prevents flex items from expanding past bounds
- `overflow-y-auto` on sidebar enables scrolling when content is tall
- `overflow-hidden` on content wrapper constrains growing content

### Visualizer Cropping

**Problem**: BitField visualizer gets cut off on smaller screens

**Solution**: Ensure parent containers have `overflow-x-auto` and child has `min-w-max`:

```tsx
<div className="overflow-x-auto">
  <div className="min-w-max">
    {/* visualizer content */}
  </div>
</div>
```

### Sidebar Not Opening on Mobile

**Problem**: Hamburger menu doesn't appear

**Solution**: Check CSS. Button visibility is controlled by media query:

```css
@media (max-width: 640px) {
  .sidebar-toggle-btn {
    display: inline-flex;
  }
}
```

### Touch Targets Too Small

**Problem**: Buttons hard to tap on mobile

**Solution**: Apply minimum height via CSS variable:

```css
button {
  min-height: var(--touch-target-min); /* 44px */
}
```

## File Reference

**CSS:**
- `src/webview/index.css` - All responsive styles

**Components:**
- `src/webview/index.tsx` - Memory Map Editor
- `src/webview/ipcore/IpCoreApp.tsx` - IP Core Editor
- `src/webview/ipcore/components/layout/NavigationSidebar.tsx`
- `src/webview/components/AddressMapVisualizer.tsx`
- `src/webview/components/RegisterMapVisualizer.tsx`
- `src/webview/components/BitFieldVisualizer.tsx`
- `src/webview/components/DetailsPanel.tsx`

## Summary

The responsive design implementation provides a foundation for multi-device support while maintaining desktop productivity. The hybrid approach balances mobile usability with VS Code extension conventions, using CSS-first techniques for performance and maintainability.
