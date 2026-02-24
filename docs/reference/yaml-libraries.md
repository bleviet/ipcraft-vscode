# YAML Libraries

This project uses two YAML libraries by design. Choosing the correct one is important.

## When to Use Which

| Library | Package | Use case |
|---------|---------|----------|
| `js-yaml` v4 | `js-yaml` | Simple parse/dump where comment preservation is not needed |
| `yaml` v2 | `yaml` | Round-trip document manipulation that preserves comments and formatting |

## Rule of Thumb

- **Reading YAML only** -> `js-yaml` (`yaml.load()`)
- **Modifying YAML and writing back** -> `yaml` v2 (`YAML.parseDocument()`)

## Examples

### Simple parse (js-yaml)

```typescript
import yaml from 'js-yaml';

const data = yaml.load(text) as MemoryMap;
const output = yaml.dump(data);
```

### Round-trip edit (yaml v2)

```typescript
import { parseDocument } from 'yaml';

const doc = parseDocument(text);
doc.setIn(['registers', 0, 'name'], 'status');
const output = doc.toString();
// Comments and formatting are preserved
```

## Where They Are Used

- `YamlService` uses `yaml` v2 for document manipulation
- `DataNormalizer` uses `js-yaml` for initial parsing
- Host-side services use `js-yaml` for schema validation
