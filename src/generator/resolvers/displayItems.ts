import { toTclQuotedString } from './tclString';
import type { LayoutPage } from './parameterLayout';

/**
 * Platform Designer parameter display layout.
 *
 * Platform Designer builds its parameter editor from `add_display_item <parent>
 * <id> <type>` records: `GROUP` items form the (nestable) sections, `PARAMETER`
 * items place a parameter inside one. This module flattens the shared
 * `parameterLayout` tree into those records — one root group per `uiPage`, one
 * nested group per `uiGroup`.
 *
 * Quartus renders a GROUP display item's own id as its visible label; it does
 * not use `set_display_item_property ... DISPLAY_NAME` to rename a GROUP the
 * way an earlier version of this module assumed (verified against Quartus
 * 21.1 during review of #194 — see the stub's rejection of that call for
 * GROUP items). So the authored `uiPage`/`uiGroup` text must BE the id, not a
 * separate rename target reachable through DISPLAY_NAME.
 *
 * Ids share one global namespace with PARAMETER items (whose id is fixed to
 * the `add_parameter` name), so an authored label that collides with another
 * label or with a parameter name is disambiguated with a small, visible
 * qualifier — there is no way to hide the disambiguation behind an internal
 * id for this item kind.
 *
 * The legacy alternative, `set_parameter_property <p> GROUP <name>`, takes a
 * single flat group name and cannot express nesting, which is why it is not
 * used here.
 */

export type DisplayItemKind = 'GROUP' | 'PARAMETER';

export interface DisplayItem {
  /**
   * Globally unique display-item id. For `GROUP` items this is also the
   * visible label Platform Designer renders, so it starts from the authored
   * `uiPage`/`uiGroup` text (disambiguated on collision). For `PARAMETER`
   * items it is the parameter name as declared by `add_parameter`.
   */
  id: string;
  /** `id` escaped for embedding in a double-quoted Tcl string. */
  id_tcl: string;
  /** Parent group id, or `''` for a root-level item. */
  parent: string;
  /** `parent` escaped for embedding in a double-quoted Tcl string. */
  parent_tcl: string;
  kind: DisplayItemKind;
}

/**
 * Claims a display-item id starting from an authored label. On collision
 * (case-insensitive, since ids share a namespace with uppercased parameter
 * names) appends a visible `(2)`, `(3)`, ... qualifier rather than silently
 * renaming — GROUP labels have no other way to be disambiguated.
 */
function makeLabelIdAllocator(reserved: Set<string>): (label: string) => string {
  return (label) => {
    if (!reserved.has(label.toUpperCase())) {
      reserved.add(label.toUpperCase());
      return label;
    }
    let n = 2;
    let candidate = `${label} (${n})`;
    while (reserved.has(candidate.toUpperCase())) {
      n += 1;
      candidate = `${label} (${n})`;
    }
    reserved.add(candidate.toUpperCase());
    return candidate;
  };
}

function makeItem(id: string, parent: string, kind: DisplayItemKind): DisplayItem {
  return {
    id,
    id_tcl: toTclQuotedString(id),
    parent,
    parent_tcl: toTclQuotedString(parent),
    kind,
  };
}

export function buildDisplayItems(pages: LayoutPage[]): DisplayItem[] {
  const reserved = new Set<string>();
  for (const page of pages) {
    for (const param of page.ungrouped_params) {
      reserved.add(param.name.toUpperCase());
    }
    for (const group of page.groups) {
      for (const param of group.params) {
        reserved.add(param.name.toUpperCase());
      }
    }
  }
  const claim = makeLabelIdAllocator(reserved);

  const items: DisplayItem[] = [];
  for (const page of pages) {
    // Parameters that declared no uiPage sit at the root rather than in a
    // group named after Vivado's synthetic default page.
    const pageId = page.isDefault ? '' : claim(page.name);
    if (pageId) {
      items.push(makeItem(pageId, '', 'GROUP'));
    }

    for (const param of page.ungrouped_params) {
      items.push(makeItem(param.name.toUpperCase(), pageId, 'PARAMETER'));
    }

    for (const group of page.groups) {
      const groupId = claim(group.name);
      items.push(makeItem(groupId, pageId, 'GROUP'));
      for (const param of group.params) {
        items.push(makeItem(param.name.toUpperCase(), groupId, 'PARAMETER'));
      }
    }
  }

  return items;
}
