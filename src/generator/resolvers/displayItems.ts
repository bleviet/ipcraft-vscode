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
 * GROUP ids are internal and globally unique. Their authored uiPage/uiGroup
 * labels are carried separately through DISPLAY_NAME, as defined by Platform
 * Designer's display-item property API. This preserves labels when the same
 * group name is reused on multiple pages or collides with a parameter name.
 *
 * The legacy alternative, `set_parameter_property <p> GROUP <name>`, takes a
 * single flat group name and cannot express nesting, which is why it is not
 * used here.
 */

export type DisplayItemKind = 'GROUP' | 'PARAMETER';

export interface DisplayItem {
  /**
   * Globally unique internal display-item id. For `PARAMETER` items it is the
   * parameter name as declared by `add_parameter`.
   */
  id: string;
  /** Parent group id (already escaped), or `''` for a root-level item. */
  parent: string;
  kind: DisplayItemKind;
  /** Authored label for GROUP items. */
  display_name?: string;
  /** Tcl-double-quote-escaped copy of display_name. */
  display_name_tcl?: string;
}

/**
 * Display-item ids share one global namespace in Platform Designer, so a group
 * id may still collide with a parameter authored using IPCraft's internal
 * prefix. Parameter names are fixed, so internal ids gain a numeric suffix.
 */
function makeIdAllocator(reserved: Set<string>): (base: string) => string {
  return (base) => {
    if (!reserved.has(base.toUpperCase())) {
      reserved.add(base.toUpperCase());
      return base;
    }
    let n = 2;
    while (reserved.has(`${base}_${n}`.toUpperCase())) {
      n += 1;
    }
    reserved.add(`${base}_${n}`.toUpperCase());
    return `${base}_${n}`;
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
  const claim = makeIdAllocator(reserved);

  const items: DisplayItem[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    // Parameters that declared no uiPage sit at the root rather than in a
    // group named after Vivado's synthetic default page.
    const pageId = page.isDefault ? '' : claim(`ipcraft_page_${pageIndex}`);
    if (pageId) {
      items.push({
        id: pageId,
        parent: '',
        kind: 'GROUP',
        display_name: page.name,
        display_name_tcl: toTclQuotedString(page.name),
      });
    }

    for (const param of page.ungrouped_params) {
      items.push({
        id: param.name.toUpperCase(),
        parent: pageId,
        kind: 'PARAMETER',
      });
    }

    for (const [groupIndex, group] of page.groups.entries()) {
      const groupId = claim(`ipcraft_group_${pageIndex}_${groupIndex}`);
      items.push({
        id: groupId,
        parent: pageId,
        kind: 'GROUP',
        display_name: group.name,
        display_name_tcl: toTclQuotedString(group.name),
      });
      for (const param of group.params) {
        items.push({
          id: param.name.toUpperCase(),
          parent: groupId,
          kind: 'PARAMETER',
        });
      }
    }
  }

  return items;
}
