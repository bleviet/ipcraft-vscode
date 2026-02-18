# Development Guide

## Getting Started

### Prerequisites

- Node.js 16+
- npm 8+
- VSCode 1.60+

### Initial Setup

```bash
# Clone repository
cd ipcore_lib/vscode-extension

# Install dependencies
npm install

# Generate TypeScript types from YAML schema
npm run generate-types

# Compile extension and webview
npm run compile
```

### Development Workflow

#### 1. Watch Mode

```bash
# Terminal 1: Watch extension and webview
npm run watch
```

This runs both TypeScript compiler and Webpack in watch mode.

#### 2. Launch Extension

1. Open VSCode in the `vscode-extension` directory
2. Press `F5` to launch Extension Development Host
3. Open a `.mm.yml` file

#### 3. Debugging

**Extension Host Debugging:**
- Breakpoints in `src/**/*.ts` work automatically
- View console output in Debug Console
- Use Logger for structured logging

**Webview Debugging:**
- Open Developer Tools: `Help → Toggle Developer Tools`
- Webview runs in isolated context
- Console logs appear in DevTools console
- React DevTools can be used

**Common Debug Scenarios:**

```typescript
// Extension host
import { Logger } from './utils/Logger';
const logger = new Logger('MyComponent');
logger.debug('Debug message', { data });
logger.error('Error occurred', error);

// Webview
console.log('[MyComponent]', data);
```

## Project Structure

```
vscode-extension/
├── src/
│   ├── extension.ts              # Entry point
│   ├── providers/                # Custom editor provider
│   ├── services/                 # Extension services
│   ├── utils/                    # Logger, ErrorHandler
│   ├── webview/
│   │   ├── index.tsx            # Webview entry
│   │   ├── components/          # React components
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # Webview services
│   │   ├── algorithms/          # Business logic
│   │   ├── utils/               # Utilities
│   │   └── types/               # TypeScript types
│   └── test/
│       ├── suite/               # Test files
│       ├── fixtures/            # Test data
│       └── __mocks__/           # Mocks
├── docs/                        # Documentation
├── schemas/                     # YAML schemas
├── dist/                        # Webview bundle (generated)
├── out/                         # Extension bundle (generated)
└── package.json
```

## Running Tests

### Unit Tests (Jest)

```bash
# Run all tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npx jest src/test/suite/algorithms/BitFieldRepacker.test.ts

# Watch mode
npm run test -- --watch
```

### Integration Tests (Mocha)

```bash
# Run extension tests
npm run test:extension
```

## Code Style

### TypeScript

- Use strict mode
- Avoid `any` types (use `unknown` + type guards)
- Use interfaces for object shapes
- Use type aliases for unions

```typescript
// Good
interface User {
  name: string;
  age: number;
}

function processUser(user: User): void {
  // ...
}

// Avoid
function processUser(user: any): void {
  // ...
}
```

### React Components

- Use functional components with hooks
- Extract complex logic to custom hooks
- Keep components focused (~200 lines max)
- Use prop interfaces

```typescript
interface MyComponentProps {
  data: DataType;
  onUpdate: (value: string) => void;
}

export function MyComponent({ data, onUpdate }: MyComponentProps) {
  // Component logic
}
```

### Naming Conventions

- **Files**: PascalCase for components, camelCase for utilities
- **Functions**: camelCase
- **Classes**: PascalCase
- **Constants**: UPPER_SNAKE_CASE (if truly constant)
- **React Hooks**: `use` prefix

## Common Tasks

### Adding a New Service

1. **Create the service:**

```typescript
// src/services/MyService.ts
export class MyService {
  constructor(private readonly dependency: SomeType) {}

  public doSomething(): void {
    // Implementation
  }
}
```

2. **Inject into provider:**

```typescript
// src/providers/MemoryMapEditorProvider.ts
export class MemoryMapEditorProvider {
  private readonly myService: MyService;

  constructor(context: vscode.ExtensionContext) {
    this.myService = new MyService(dependency);
  }
}
```

3. **Write tests:**

```typescript
// src/test/suite/services/MyService.test.ts
describe('MyService', () => {
  it('should do something', () => {
    const service = new MyService(mockDependency);
    expect(service.doSomething()).toBe(expected);
  });
});
```

### Adding a New Algorithm

1. **Create algorithm file:**

```typescript
// src/webview/algorithms/MyAlgorithm.ts
export function processData(input: InputType): OutputType {
  // Pure function implementation
  return result;
}
```

2. **Write tests:**

```typescript
// src/test/suite/algorithms/MyAlgorithm.test.ts
import { processData } from '../../../webview/algorithms/MyAlgorithm';

describe('MyAlgorithm', () => {
  it('should process data correctly', () => {
    const result = processData(input);
    expect(result).toEqual(expected);
  });
});
```

3. **Use in components:**

```typescript
import { processData } from '../algorithms/MyAlgorithm';

// In component
const result = processData(data);
```

### Adding a New Custom Hook

1. **Create hook:**

```typescript
// src/webview/hooks/useMyHook.ts
import { useState, useEffect } from 'react';

export function useMyHook(initialValue: string) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    // Side effects
  }, [value]);

  return { value, setValue };
}
```

2. **Use in components:**

```typescript
function MyComponent() {
  const { value, setValue } = useMyHook('initial');
  // ...
}
```

## Troubleshooting

### Extension Not Loading

1. Check Output panel: `View → Output → Extension Host`
2. Look for activation errors
3. Verify `package.json` activation events
4. Check `extension.ts` for errors

### Webview Not Updating

1. Open DevTools: `Help → Toggle Developer Tools`
2. Check Console for errors
3. Verify message passing:
   ```typescript
   vscode.postMessage({ type: 'update', text });
   ```
4. Check `useYamlSync` hook

### Type Errors

```bash
# Regenerate types from schema
npm run generate-types

# Type check without building
npx tsc --noEmit
```

### Test Failures

```bash
# Run single test file
npx jest path/to/test.ts

# Run with verbose output
npm run test -- --verbose

# Update snapshots (if using)
npm run test -- -u
```

## Release Process

1. **Update version:**
   ```bash
   npm version patch  # or minor, major
   ```

2. **Build production bundle:**
   ```bash
   npm run compile
   ```

3. **Package extension:**
   ```bash
   # Ensure 'publisher' and 'repository' fields are set in package.json
   npx vsce package
   ```

   This will generate a `.vsix` file (e.g., `fpga-memory-map-editor-0.0.1.vsix`) in the root directory.

4. **Test .vsix file:**
   - Install in VSCode: `Extensions → ... → Install from VSIX`
   - Test all features

5. **Publish (if configured):**
   ```bash
   vsce publish
   ```

## Useful Commands

```bash
# Clean build artifacts
rm -rf out/ dist/ node_modules/

# Reinstall dependencies
npm install

# Lint code
npm run lint

# Fix lint issues
npm run lint -- --fix

# Format code
npm run format

# Analyze bundle size
npm run analyze-bundle  # (if configured)
```

## Performance Profiling

### Extension Host

1. Launch with profiling: Add `--inspect` flag in launch.json
2. Open `chrome://inspect` in Chrome
3. Profile CPU/Memory usage

### Webview

1. Open DevTools
2. Go to Performance tab
3. Record interaction
4. Analyze flame graph

## Contributing Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes
3. Write tests
4. Run linter: `npm run lint`
5. Run tests: `npm run test`
6. Commit changes
7. Push to remote
8. Create Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.
