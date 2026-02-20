# Architecture Documentation

## Overview

`ipcraft-vscode` is a VS Code extension that provides two custom editors:

- **Memory Map editor** for `*.mm.yml`
- **IP Core editor** for `*.ip.yml`

Both editors share common extension-host services (message handling, document update, validation, HTML bootstrapping) while keeping editor-specific UI and domain workflows separate.

---

## High-Level Architecture

### 1) Extension Host (VS Code side)

Core entry points and providers:

- `src/extension.ts`
- `src/providers/MemoryMapEditorProvider.ts`
- `src/providers/IpCoreEditorProvider.ts`

Shared host-side services:

- `src/services/HtmlGenerator.ts`
- `src/services/MessageHandler.ts`
- `src/services/DocumentManager.ts`
- `src/services/YamlValidator.ts`
- `src/services/ImportResolver.ts` (IP Core flow)

Generator/parsing commands:

- `src/commands/FileCreationCommands.ts`
- `src/commands/GenerateCommands.ts`
- `src/generator/*` (TypeScript scaffolding + Nunjucks templates)
- `src/parser/VhdlParser.ts`

### 2) Webview (React side)

Memory Map app entry:

- `src/webview/index.tsx`

IP Core app entry:

- `src/webview/ipcore/IpCoreApp.tsx`

Memory Map UI structure:

- `Outline` tree/navigation (`src/webview/components/Outline.tsx`)
- `DetailsPanel` router (`src/webview/components/DetailsPanel.tsx`)
- detail editors:
  - register editor: `src/webview/components/register/*`
  - block editor: `src/webview/components/memorymap/BlockEditor.tsx`
  - memory map editor: `src/webview/components/memorymap/MemoryMapEditor.tsx`
  - register-array editor: `src/webview/components/memorymap/RegisterArrayEditor.tsx`

Key webview domain services and hooks:

- `src/webview/services/DataNormalizer.ts`
- `src/webview/services/YamlPathResolver.ts`
- `src/webview/services/YamlService.ts`
- `src/webview/services/SpatialInsertionService.ts`
- `src/webview/hooks/useMemoryMapState.ts`
- `src/webview/hooks/useSelection.ts`
- `src/webview/hooks/useYamlSync.ts`
- `src/webview/hooks/useFieldEditor.ts`

---

## Data Flow

### Document open / refresh

1. VS Code opens a matching YAML file.
2. Provider resolves webview HTML and waits for `type: 'ready'`.
3. Provider sends `type: 'update'` with text (+ filename; IP Core may include resolved imports).
4. Webview parses + normalizes, then renders state.

### User edit

1. User edits in webview UI.
2. Webview updates in-memory model and serializes YAML.
3. Webview posts `type: 'update'` with full text.
4. Host `MessageHandler` routes to `DocumentManager.updateDocument(...)`.
5. VS Code document updates and re-syncs if needed.

### Host command flow

Webview can post `type: 'command'` (`save`, `validate`, `openFile`).
Host executes VS Code actions and may show notifications.

---

## Memory Map Editing Model

The Memory Map editor keeps a normalized model for UI behavior while preserving YAML round-tripping:

- Input YAML can vary in shape (`memory_maps`, arrays, direct object).
- `DataNormalizer` produces consistent in-app structures.
- `YamlPathResolver` applies precise updates back to parsed YAML object.
- `YamlService` handles parse/dump and bit-field cleanup format.

Spatial editing is implemented with pure functions/services:

- bit fields: `BitFieldRepacker` + `SpatialInsertionService.insertField*`
- registers: `RegisterRepacker` + `SpatialInsertionService.insertRegister*`
- blocks: `AddressBlockRepacker` + `SpatialInsertionService.insertBlock*`

---

## Testing Architecture

## YAML Libraries

This project uses two YAML libraries by design:

| Library | Package | When to use |
|---------|---------|-------------|
| `js-yaml` (v4) | `js-yaml` | Simple parse/dump operations where comment preservation is not needed |
| `yaml` (v2) | `yaml` | When `YAML.parseDocument()` is needed for comment-preserving, round-trip document manipulation |

Rule of thumb: if you are only reading YAML, use `js-yaml`; if you need to modify YAML and write it back while preserving comments/formatting, use `yaml` v2 with `parseDocument`.

### Unit tests (Jest)

- Location: `src/test/suite/**`
- Focus: algorithms, services, hooks, and selected components

### Default test entrypoint

- `npm run test` currently runs the Jest suite (`npm run test:unit`)
- no dedicated VS Code extension-harness script is currently wired in `package.json`

---

## Build & Packaging

- `npm run compile` builds extension + webview for development
- `npm run package` creates production webpack output
- `npm run type-check` validates TypeScript without emit

Generated assets:

- extension bundle: `dist/extension.js`
- webview bundle: `dist/webview.js`
- compiled tests: `out/**`

---

## Security Notes

Webview HTML is generated with CSP in `HtmlGenerator` and currently permits Tailwind CDN and inline script/style in order to support current runtime styling setup.

If CSP tightening is required, first migrate external/runtime styling dependencies to local bundled assets.
