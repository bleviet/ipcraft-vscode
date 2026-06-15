import type { ContextResolver, ResolverInput } from './types';

/** A parameter as laid out for the Vivado xGUI: name plus a tooltip string. */
export interface XguiParam {
  name: string;
  /** Description sanitized for a Tcl brace-quoted `set_property tooltip {...}`. */
  tooltip: string;
}

/**
 * Sanitize a parameter description for safe use inside a Tcl brace-quoted
 * string (`{...}`) in the xGUI tooltip: collapse whitespace/newlines onto one
 * line and neutralize characters that would unbalance the braces.
 */
function toTclBraceText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}

function resolveGenericDefault(
  value: number | string | undefined,
  type: string
): number | string | null {
  const t = type.toLowerCase().trim();
  if (t === 'string') {
    const raw = value !== undefined && value !== null ? String(value) : '';
    const inner =
      raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    return `"${inner}"`;
  }
  if (value !== undefined && value !== null) {
    return value;
  }
  if (t === 'integer') {
    return 0;
  }
  if (t === 'boolean') {
    return 'false';
  }
  return 0;
}

function resolveSvGenericType(vhdlType: string): string {
  const t = vhdlType.toLowerCase().trim();
  if (t === 'integer') {
    return 'int';
  }
  if (t === 'boolean') {
    return 'bit';
  }
  if (t === 'string') {
    return '';
  }
  return 'int';
}

function resolveSvGenericDefault(
  value: number | string | undefined,
  type: string
): number | string | null {
  const t = type.toLowerCase().trim();
  if (t === 'string') {
    const raw = value !== undefined && value !== null ? String(value) : '';
    const inner =
      raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    return `"${inner}"`;
  }
  if (value !== undefined && value !== null) {
    if (t === 'boolean') {
      const v = String(value).toLowerCase().trim();
      return v === 'true' || v === '1' ? "1'b1" : "1'b0";
    }
    return value;
  }
  if (t === 'integer') {
    return 0;
  }
  if (t === 'boolean') {
    return "1'b0";
  }
  return 0;
}

export function buildGenerics(ipCore: ResolverInput['ipCore']): Array<Record<string, unknown>> {
  const params = ipCore?.parameters ?? [];
  return params.map((param) => {
    const type = String(param.dataType ?? '');
    return {
      name: param.name,
      type,
      sv_type: resolveSvGenericType(type),
      default_value: resolveGenericDefault(param.value, type),
      sv_default: resolveSvGenericDefault(param.value, type),
      description: param.description ? String(param.description) : '',
      min: param.min !== undefined ? param.min : null,
      max: param.max !== undefined ? param.max : null,
      allowed_values: param.allowedValues ?? null,
      ui_page: param.uiPage ?? '',
      ui_group: param.uiGroup ?? '',
    };
  });
}

export function buildXguiPages(generics: Array<Record<string, unknown>>): Array<{
  name: string;
  tcl_var: string;
  groups: Array<{ name: string; tcl_var: string; params: XguiParam[] }>;
  ungrouped_params: XguiParam[];
}> {
  const toTclVar = (s: string) => s.replace(/[\s\-.]/g, '_');

  const pageOrder: string[] = [];
  const groupOrder: Map<string, string[]> = new Map();
  const groupParams: Map<string, Map<string, XguiParam[]>> = new Map();
  const ungroupedParams: Map<string, XguiParam[]> = new Map();

  for (const g of generics) {
    const page = g.ui_page ? String(g.ui_page) : 'Page 0';
    const group = g.ui_group ? String(g.ui_group) : '';
    const param: XguiParam = {
      name: String(g.name ?? ''),
      tooltip: toTclBraceText(g.description ? String(g.description) : ''),
    };

    if (!pageOrder.includes(page)) {
      pageOrder.push(page);
      groupOrder.set(page, []);
      groupParams.set(page, new Map());
      ungroupedParams.set(page, []);
    }

    if (group) {
      const groups = groupOrder.get(page)!;
      if (!groups.includes(group)) {
        groups.push(group);
        groupParams.get(page)!.set(group, []);
      }
      groupParams.get(page)!.get(group)!.push(param);
    } else {
      ungroupedParams.get(page)!.push(param);
    }
  }

  return pageOrder.map((page) => ({
    name: page,
    tcl_var: `Page_${toTclVar(page)}`,
    groups: (groupOrder.get(page) ?? []).map((group) => ({
      name: group,
      tcl_var: `Group_${toTclVar(page)}_${toTclVar(group)}`,
      params: groupParams.get(page)!.get(group) ?? [],
    })),
    ungrouped_params: ungroupedParams.get(page) ?? [],
  }));
}

export const genericsResolver: ContextResolver = {
  name: 'generics',

  resolve({ ipCore }: ResolverInput): Record<string, unknown> {
    const generics = buildGenerics(ipCore);
    return {
      generics,
      xgui_pages: buildXguiPages(generics),
    };
  },
};
