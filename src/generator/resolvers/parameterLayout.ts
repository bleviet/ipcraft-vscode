import { toTclBraceText } from './tclString';

/**
 * Target-neutral page/group layout for IP core parameters.
 *
 * `uiPage` / `uiGroup` describe one logical two-level tree that every vendor
 * parameter GUI has to render: Vivado's xGUI (`ipgui::add_page` /
 * `ipgui::add_group`) and Platform Designer's display items
 * (`add_display_item`). This module owns that tree so both targets agree on
 * page order, group order and parameter order; per-target flattening lives in
 * the target's own module (see `displayItems.ts` for Platform Designer).
 */

/** A parameter as laid out in a vendor parameter GUI: name plus a tooltip string. */
export interface LayoutParam {
  name: string;
  /** Description sanitized for a Tcl brace-quoted `set_property tooltip {...}`. */
  tooltip: string;
}

export interface LayoutGroup {
  name: string;
  tcl_var: string;
  params: LayoutParam[];
}

export interface LayoutPage {
  name: string;
  tcl_var: string;
  /**
   * True when this page collects parameters that declared no `uiPage`. Vivado
   * requires every parameter to sit on a page, so those get the synthetic
   * `Page 0`; Platform Designer has no page concept and renders them at the
   * root instead of inside a group.
   */
  isDefault: boolean;
  groups: LayoutGroup[];
  ungrouped_params: LayoutParam[];
}

/** Page name used for parameters that declare no `uiPage` (Vivado's default page). */
export const DEFAULT_PAGE_NAME = 'Page 0';

/**
 * Internal-only key for the "no uiPage declared" bucket. Distinct from any
 * string an author could put in `uiPage` (including the literal text
 * "Page 0") so an explicit `uiPage: "Page 0"` cannot merge with — and
 * silently inherit `isDefault` from — the synthetic default-page bucket.
 */
const DEFAULT_PAGE_KEY = '__ipcraft_default_page__';

const toTclVar = (s: string) => s.replace(/[\s\-.]/g, '_');

export function buildParameterLayout(generics: Array<Record<string, unknown>>): LayoutPage[] {
  const pageOrder: string[] = [];
  const pageDisplayName: Map<string, string> = new Map();
  const groupOrder: Map<string, string[]> = new Map();
  const groupParams: Map<string, Map<string, LayoutParam[]>> = new Map();
  const ungroupedParams: Map<string, LayoutParam[]> = new Map();

  for (const g of generics) {
    const hasPage = Boolean(g.ui_page);
    const pageKey = hasPage ? String(g.ui_page) : DEFAULT_PAGE_KEY;
    const pageName = hasPage ? String(g.ui_page) : DEFAULT_PAGE_NAME;
    const group = g.ui_group ? String(g.ui_group) : '';
    const param: LayoutParam = {
      name: String(g.name ?? ''),
      tooltip: toTclBraceText(g.description ? String(g.description) : ''),
    };

    if (!pageOrder.includes(pageKey)) {
      pageOrder.push(pageKey);
      pageDisplayName.set(pageKey, pageName);
      groupOrder.set(pageKey, []);
      groupParams.set(pageKey, new Map());
      ungroupedParams.set(pageKey, []);
    }

    if (group) {
      const groups = groupOrder.get(pageKey)!;
      if (!groups.includes(group)) {
        groups.push(group);
        groupParams.get(pageKey)!.set(group, []);
      }
      groupParams.get(pageKey)!.get(group)!.push(param);
    } else {
      ungroupedParams.get(pageKey)!.push(param);
    }
  }

  return pageOrder.map((pageKey) => {
    const name = pageDisplayName.get(pageKey)!;
    return {
      name,
      tcl_var: `Page_${toTclVar(name)}`,
      isDefault: pageKey === DEFAULT_PAGE_KEY,
      groups: (groupOrder.get(pageKey) ?? []).map((group) => ({
        name: group,
        tcl_var: `Group_${toTclVar(name)}_${toTclVar(group)}`,
        params: groupParams.get(pageKey)!.get(group) ?? [],
      })),
      ungrouped_params: ungroupedParams.get(pageKey) ?? [],
    };
  });
}
