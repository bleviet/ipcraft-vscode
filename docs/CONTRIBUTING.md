# Contributing to FPGA Memory Map Visual Editor

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a feature branch
4. Make your changes
5. Submit a pull request

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup instructions.

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Write clean, maintainable code
- Follow existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run unit tests
npm run test

# Run linter
npm run lint

# Test in Extension Development Host (F5)
```

### 4. Commit Your Changes

Use clear, descriptive commit messages:

```bash
git commit -m "feat: add new algorithm for register repacking"
git commit -m "fix: resolve issue with empty field handling"
git commit -m "docs: update architecture diagram"
```

**Commit Message Format:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `chore`: Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/my-feature
```

Then create a Pull Request on GitHub.

## Code Style Guidelines

### TypeScript

**Use TypeScript strict mode:**
```typescript
// Good
function processData(input: string): number {
  return parseInt(input, 10);
}

// Avoid
function processData(input: any): any {
  return parseInt(input, 10);
}
```

**Prefer interfaces for object shapes:**
```typescript
// Good
interface User {
  name: string;
  age: number;
}

// Avoid (unless you need union/intersection types)
type User = {
  name: string;
  age: number;
};
```

**Use type guards instead of any:**
```typescript
// Good
function process(value: unknown): void {
  if (typeof value === 'string') {
    console.log(value.toUpperCase());
  }
}

// Avoid
function process(value: any): void {
  console.log(value.toUpperCase());
}
```

### React Components

**Use functional components:**
```typescript
// Good
export function MyComponent({ data }: MyComponentProps) {
  return <div>{data}</div>;
}

// Avoid class components (legacy codebase compatibility only)
```

**Extract complex logic to hooks:**
```typescript
// Good
function useComplexLogic(input: string) {
  const [state, setState] = useState(input);
  // ... complex logic
  return { state, setState };
}

function MyComponent() {
  const { state } = useComplexLogic('initial');
  return <div>{state}</div>;
}
```

**Keep components focused:**
- Single responsibility
- ~200 lines maximum
- Extract sub-components if needed

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files (Components) | PascalCase | `MyComponent.tsx` |
| Files (Utilities) | camelCase | `myUtility.ts` |
| Functions | camelCase | `processData()` |
| Classes | PascalCase | `DataProcessor` |
| Interfaces | PascalCase | `UserData` |
| React Hooks | use + PascalCase | `useMyHook()` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |

## Testing Requirements

### Unit Tests

**All new algorithms must have unit tests:**
```typescript
describe('MyAlgorithm', () => {
  it('should handle normal case', () => {
    expect(myAlgorithm(input)).toEqual(expected);
  });

  it('should handle edge case', () => {
    expect(myAlgorithm(edgeInput)).toEqual(edgeExpected);
  });

  it('should handle empty input', () => {
    expect(myAlgorithm([])).toEqual([]);
  });
});
```

**Target Coverage:**
- Algorithms: 90%+
- Services: 80%+
- Utilities: 80%+

### Manual Testing

Before submitting PR:
1. Launch Extension Development Host (F5)
2. Open sample `.mm.yml` file
3. Test your changes thoroughly
4. Test edge cases (empty files, large files, invalid data)

## Documentation Requirements

### Code Documentation

**Add JSDoc for public APIs:**
```typescript
/**
 * Processes user data and returns formatted result
 * @param data - User data to process
 * @param options - Processing options
 * @returns Formatted result string
 * @throws {Error} If data is invalid
 */
export function processUserData(
  data: UserData,
  options: Options
): string {
  // implementation
}
```

**Document complex logic:**
```typescript
// Calculate the next available bit position
// We need to find gaps in the existing bit allocations
const nextPosition = findGapInBitAllocations(fields);
```

### Documentation Files

Update relevant docs when making changes:
- `README.md` - For user-facing features
- `docs/ARCHITECTURE.md` - For architectural changes
- `docs/DEVELOPMENT.md` - For development workflow changes

## Pull Request Guidelines

### PR Title

Use the same format as commit messages:
- `feat: Add register array support`
- `fix: Resolve field overlap detection`
- `docs: Update architecture diagrams`

### PR Description

Include:
1. **What**: What does this PR do?
2. **Why**: Why is this change needed?
3. **How**: How does it work?
4. **Testing**: How was it tested?

**Example:**
```markdown
## What
Adds support for detecting overlapping bit fields in registers.

## Why
Users were able to create invalid memory maps with overlapping fields.

## How
Added validation in the BitFieldRepacker that checks for overlaps
before inserting new fields.

## Testing
- Added unit tests for overlap detection
- Manually tested with sample files
- Verified error messages are clear
```

### PR Checklist

Before submitting:
- [ ] Code follows style guidelines
- [ ] Tests added/updated and passing
- [ ] Linter passes (`npm run lint`)
- [ ] Documentation updated
- [ ] Manually tested in Extension Development Host
- [ ] No console errors or warnings

## Review Process

1. **Automated Checks**: CI/CD runs tests and linter
2. **Code Review**: Maintainer reviews code
3. **Feedback**: Address review comments
4. **Approval**: PR is approved
5. **Merge**: PR is merged to main

## Common Contribution Areas

### Easy First Issues

- Documentation improvements
- Test coverage improvements
- Code comments
- Bug fixes with clear reproduction

### Medium Complexity

- New utility functions
- Algorithm improvements
- UI enhancements
- Performance optimizations

### Advanced

- New features
- Architecture changes
- Major refactoring
- Integration with other tools

## Questions?

- Open an issue for questions
- Check existing issues for similar questions
- Review [DEVELOPMENT.md](DEVELOPMENT.md) for technical details

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
