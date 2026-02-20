# Beginner's Guide

This guide is for contributors new to VS Code extension development and new to this repository.

---

## 1) Understand the Two Processes

This project runs in two separate runtimes:

1. **Extension Host** (Node.js in VS Code)
   - can read/write files, register commands, open editors
   - cannot render complex UI directly

2. **Webview** (embedded browser)
   - renders React UI for Memory Map and IP Core editors
   - cannot directly access user files

They communicate via `postMessage`.

---

## 2) Important Files to Start With

### Extension host

- `src/extension.ts` – activation + provider registration
- `src/providers/MemoryMapEditorProvider.ts`
- `src/providers/IpCoreEditorProvider.ts`
- `src/services/MessageHandler.ts`

### Memory Map webview

- `src/webview/index.tsx` – main app shell
- `src/webview/components/Outline.tsx`
- `src/webview/components/DetailsPanel.tsx`
- `src/webview/components/register/RegisterEditor.tsx`
- `src/webview/components/register/FieldsTable.tsx`
- `src/webview/components/BitFieldVisualizer.tsx`

### IP Core webview

- `src/webview/ipcore/IpCoreApp.tsx`

### Shared behavior

- `src/webview/hooks/useMemoryMapState.ts`
- `src/webview/hooks/useSelection.ts`
- `src/webview/hooks/useYamlSync.ts`
- `src/webview/services/SpatialInsertionService.ts`

---

## 3) Local Setup

```bash
npm install
npm run compile
```

Then press **F5** in VS Code to launch an Extension Development Host.

Open either:

- a `*.mm.yml` file (Memory Map editor)
- a `*.ip.yml` file (IP Core editor)

---

## 4) Typical Edit Loop

1. Start watch build:

```bash
npm run watch
```

2. Make code changes.
3. Reload extension host window when needed.
4. Validate by running focused tests.

---

## 5) Useful Test Commands

```bash
# Unit tests (Jest)
npm run test:unit

# Default test command
npm run test

# Type checking
npm run type-check

# Lint
npm run lint
```

---

## 6) Keyboard Behavior in Register Field Table

When the register fields table is focused:

- `h j k l` and arrow keys navigate cells
- `F2` or `e` enters edit mode on current cell
- `d` or `Delete` removes selected field
- `o` inserts field after selected field
- `O` (shift+o) inserts field before selected field
- `Alt+Up` / `Alt+Down` moves selected field
- `Escape` returns focus to table container

---

## 7) First Good Tasks

- Add or update unit tests in `src/test/suite/**`
- Fix UI behavior in a focused component (register editor, outline, visualizer)
- Improve docs in `docs/**`
- Improve validation or error text in services/hooks

---

## 8) Troubleshooting

- **Editor not updating**: check webview console + extension host logs.
- **YAML update issues**: inspect `YamlPathResolver` and `YamlService`.
- **Bit-field behavior issues**: inspect `BitFieldVisualizer`, `useFieldEditor`, `SpatialInsertionService`.

For deeper details, continue with:

- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/BIT_FIELD_INTERACTION.md`
