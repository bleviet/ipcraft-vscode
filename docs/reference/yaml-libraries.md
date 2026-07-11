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

- `src/yamledit/` (`applyPathEdits`, `applyPathDeletes`) is the single format-preserving write-back path, built on `yaml` v2 `parseDocument`
- `src/webview/services/YamlService.ts` uses `js-yaml` for simple parse/dump (`parse`, `safeParse`, `dump`) and delegates `applyPathEdits` to `src/yamledit` for round-trip writes
- `src/domain/parse.ts` builds the normalized domain model from `js-yaml`-parsed raw objects
- Host-side services (`YamlValidator`, `BusLibraryService`, the VHDL/HwTcl/ComponentXml parsers, `ScaffoldPackLoader`) use `js-yaml` for read-only parsing and validation
