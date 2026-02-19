/**
 * Discriminated union types for editor selections.
 *
 * `EditorSelection` is the canonical lean type used by `DetailsPanel` and
 * related components to route rendering to the correct sub-editor, without
 * carrying navigation-history metadata (which lives in the `Selection`
 * interface inside `useSelection.ts`).
 */

import type { YamlPath } from '../services/YamlPathResolver';
import type { AddressBlock, RegisterDef, RegisterArray, MemoryMap } from './memoryMap';

/**
 * Represents what is currently focused in the editor detail panel.
 *
 * The `type` field is the discriminant — switch on it to narrow `data` to
 * the correct schema type.
 *
 * @example
 * function renderDetail(sel: EditorSelection) {
 *   switch (sel.type) {
 *     case 'register': return <RegisterEditor register={sel.data} />;
 *     case 'block':    return <BlockEditor block={sel.data} />;
 *     case 'array':    return <RegisterArrayEditor array={sel.data} />;
 *     case 'memoryMap': return <MemoryMapEditor map={sel.data} />;
 *     case 'none':     return <EmptyState />;
 *   }
 * }
 */
export type EditorSelection =
  | { type: 'register'; path: YamlPath; data: RegisterDef }
  | { type: 'block';    path: YamlPath; data: AddressBlock }
  | { type: 'array';    path: YamlPath; data: RegisterArray }
  | { type: 'memoryMap'; path: YamlPath; data: MemoryMap }
  | { type: 'none' };
