# Development Setup

## Prerequisites

- Node.js 20+
- npm
- VS Code

## Setup

```bash
npm install
npm run generate-types   # generate TypeScript types from JSON schemas
npm run compile
```

Launch the Extension Development Host with **F5**.

## Repository Layout

```text
src/
  extension.ts           # entry point
  commands/              # VS Code command implementations
  providers/             # custom editor providers
  services/              # extension host services
  parser/                # VHDL parser
  generator/             # VHDL scaffolding + Nunjucks templates
  utils/                 # logging, error handling, helpers
  webview/
    index.tsx            # Memory Map app shell
    ipcore/              # IP Core app and components
    components/          # React components
    hooks/               # React hooks
    services/            # webview-side services
    algorithms/          # repacking algorithms
    shared/              # shared utilities
    types/               # TypeScript type definitions
  test/suite/            # Jest unit tests
docs/                    # this documentation
ipcraft-spec/            # specification schemas + examples (git submodule)
```

## Build, Lint, Type Check

| Command | Purpose |
|---------|---------|
| `npm run compile` | Dev build (webpack) |
| `npm run watch` | Webpack watch mode |
| `npm run package` | Production build |
| `npm run lint` | Run ESLint (zero warnings) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run type-check` | TypeScript check without emit |
| `npm run format` | Prettier format |
| `npm run generate-types` | Regenerate types from JSON schemas |

## Testing

| Command | Purpose |
|---------|---------|
| `npm run test:unit` | Jest unit tests (`src/test/suite/**`) |
| `npm run test:unit -- <file>` | Run a single test file |
| `npm run test:unit:coverage` | Tests with coverage report |
| `npm run test` | Default (currently same as `test:unit`) |

!!! note
    `npm run pretest` runs compile + lint before tests. For fast iteration, run `test:unit` directly.

## Debugging

### Extension Host

- Set breakpoints in `src/**/*.ts`
- View logs in the Extension Host debug console
- Logging: `src/utils/Logger.ts` and `src/utils/ErrorHandler.ts`

### Webview

- Open **Developer: Toggle Developer Tools** in the Extension Development Host
- Inspect console for React webview errors
- Trace message flow: provider `onDidReceiveMessage` -> `useYamlSync` -> `MessageHandler`

## Common Development Tasks

### Add a new command

1. Implement in `src/commands/*`
2. Register in `src/extension.ts`
3. Add command contribution in `package.json`

### Add a memory map feature

1. UI behavior in the relevant component or hook
2. Algorithm in `src/webview/algorithms/` or service in `src/webview/services/`
3. Tests in `src/test/suite/`
4. Update docs

### Add generator behavior

1. Update `src/generator/*` and templates in `src/generator/templates/*`
2. Validate with sample specs in `ipcraft-spec/examples/*`

## Validation Flow

Run these before submitting changes:

```bash
npm run lint
npm run type-check
npm run test:unit
npm run compile
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Custom editor does not appear | Verify file extension and `package.json` custom editor selector. Check provider registration in `src/extension.ts`. |
| Webview opens but no data | Ensure webview posts `{ type: 'ready' }`. Verify provider sends `type: 'update'`. Check `useMemoryMapState`. |
| YAML updates not persisted | Verify `sendUpdate` call path. Check `MessageHandler.handleUpdate` and `DocumentManager.updateDocument`. |
| Editor not updating | Check webview console + extension host logs. |
