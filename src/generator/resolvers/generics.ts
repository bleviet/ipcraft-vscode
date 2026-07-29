import { titleCaseIdentifier } from '../../utils/titleCase';
import { buildDisplayItems } from './displayItems';
import { buildParameterLayout, type LayoutPage } from './parameterLayout';
import { toTclBracedListQuotedString, toTclQuotedString } from './tclString';
import type { ContextResolver, ResolverInput } from './types';

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

function resolveTclGenericDefault(
  value: number | string | undefined,
  type: string
): number | string | null {
  const resolved = resolveGenericDefault(value, type);
  if (type.toLowerCase().trim() !== 'string' || typeof resolved !== 'string') {
    return resolved;
  }
  const inner =
    resolved.length >= 2 && resolved.startsWith('"') && resolved.endsWith('"')
      ? resolved.slice(1, -1)
      : resolved;
  return `"${toTclQuotedString(inner)}"`;
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

/**
 * Renders `allowedValues` as a Tcl list literal for `ALLOWED_RANGES`, quoting
 * each element for string parameters (Platform Designer choice lists) and
 * leaving numeric elements bare. `null` when there is nothing to render, so
 * the template can key off it directly instead of re-deriving the branch.
 */
function buildAllowedRangesTcl(
  type: string,
  allowedValues: (number | string)[] | null
): string | null {
  if (!allowedValues || allowedValues.length === 0) {
    return null;
  }
  const isString = type.toLowerCase().trim() === 'string';
  const items = allowedValues.map((v) =>
    isString ? `"${toTclBracedListQuotedString(String(v))}"` : String(v)
  );
  return `{ ${items.join(' ')} }`;
}

export function buildGenerics(ipCore: ResolverInput['ipCore']): Array<Record<string, unknown>> {
  const params = ipCore?.parameters ?? [];
  return params.map((param) => {
    const type = String(param.dataType ?? '');
    const name = String(param.name ?? '');
    const description = param.description ? String(param.description) : '';
    const displayName = param.displayName ? String(param.displayName) : titleCaseIdentifier(name);
    const allowedValues = param.allowedValues ?? null;
    return {
      name: param.name,
      display_name: displayName,
      // Tcl-double-quote-escaped copy for `set_parameter_property ... DISPLAY_NAME "..."`;
      // display_name itself stays raw since nothing else consumes it.
      display_name_tcl: toTclQuotedString(displayName),
      type,
      sv_type: resolveSvGenericType(type),
      default_value: resolveGenericDefault(param.value, type),
      default_value_tcl: resolveTclGenericDefault(param.value, type),
      sv_default: resolveSvGenericDefault(param.value, type),
      description,
      // Tcl-double-quote-escaped copy for `set_parameter_property ... DESCRIPTION "..."`;
      // description itself stays raw for reuse by the xGUI tooltip (brace-quoted) and the
      // Markdown datasheet template, which must not see Tcl escape sequences.
      description_tcl: toTclQuotedString(description),
      min: param.min !== undefined ? param.min : null,
      max: param.max !== undefined ? param.max : null,
      allowed_values: allowedValues,
      allowed_values_tcl: buildAllowedRangesTcl(type, allowedValues),
      ui_page: param.uiPage ?? '',
      ui_group: param.uiGroup ?? '',
    };
  });
}

/**
 * The Vivado xGUI view of the shared parameter layout. `isDefault` is an
 * internal marker for per-target flattening and is not part of the template
 * contract, so it is dropped here.
 */
function toXguiPage(page: LayoutPage) {
  return {
    name: page.name,
    tcl_var: page.tcl_var,
    groups: page.groups,
    ungrouped_params: page.ungrouped_params,
  };
}

export const genericsResolver: ContextResolver = {
  name: 'generics',

  resolve({ ipCore }: ResolverInput): Record<string, unknown> {
    const generics = buildGenerics(ipCore);
    const layout = buildParameterLayout(generics);
    return {
      generics,
      xgui_pages: layout.map(toXguiPage),
      display_items: buildDisplayItems(layout),
    };
  },
};
