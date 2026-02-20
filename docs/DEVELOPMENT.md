# Development Guide

## Prerequisites

- Node.js 20+
- npm
- VS Code

## Setup

```bash
npm install
npm run generate-types
npm run compile
```

Launch extension dev host with **F5**.

---

## Repository Layout (Current)

```text
src/
  extension.ts
  commands/
  providers/
  services/
  parser/
  generator/
  utils/
  webview/
    index.tsx
    ipcore/
    components/
    hooks/
    services/
    algorithms/
    shared/
    types/
src/test/suite/
test/
docs/
ipcraft-spec/
```

---

## Build, Lint, Type Check

```bash
npm run compile       # dev build
npm run watch         # webpack watch
npm run package       # production webpack build
npm run lint
npm run type-check
```

---

## Test Commands

```bash
npm run test:unit          # Jest unit suites (src/test/suite/**)
npm run test:unit -- useFieldEditor.test.ts
npm run test               # default test command (currently same as test:unit)
npm run test:all           # unit tests + default test command
```

Notes:

- `pretest` runs compile-tests + compile + lint before `npm run test`.
- For fast local iteration, run targeted `test:unit` first.

---

## Debugging

### Extension Host

- Add breakpoints in `src/**/*.ts`.
- View logs in the extension host debug console.
- Logging utilities: `src/utils/Logger.ts` and `src/utils/ErrorHandler.ts`.

### Webview

- Open **Developer: Toggle Developer Tools** in the Extension Development Host.
- Inspect console/runtime errors for React webview code.
- Trace message flow with:
  - provider `onDidReceiveMessage`
  - `useYamlSync`
  - `MessageHandler`

---

## Common Tasks

### Add a new command

1. Implement in `src/commands/*`.
2. Register in `src/extension.ts`.
3. Add command contribution in `package.json`.

### Add a memory-map interaction feature

1. UI behavior in relevant component/hook.
2. Core algorithm in `src/webview/algorithms` or service in `src/webview/services`.
3. Tests in `src/test/suite`.
4. Docs update in `docs/`.

### Add generator behavior

1. Update `src/generator/*` and templates in `src/generator/templates/*`.
2. Validate with sample specs in `ipcraft-spec/examples/*`.

---

## Typical Validation Flow for a Feature

```bash
npm run lint
npm run type-check
npm run test:unit -- <target-test-file>
npm run test:unit
npm run compile
```

If extension-host behavior changed, also run:

```bash
npm run test
```

---

## Troubleshooting

### Custom editor does not appear

- Verify file extension and `package.json` custom editor selector.
- Check provider registration in `src/extension.ts`.
- Check extension host output for activation/runtime errors.

### Webview opens but no data

- Ensure webview posts `{ type: 'ready' }`.
- Verify provider sends `type: 'update'`.
- Check parse/normalize path in `useMemoryMapState`.

### YAML updates not persisted

- Verify `sendUpdate` call path and message payload.
- Check `MessageHandler.handleUpdate` and `DocumentManager.updateDocument`.
