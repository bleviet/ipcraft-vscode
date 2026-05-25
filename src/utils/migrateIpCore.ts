import * as YAML from 'yaml';

/** Map the legacy `vendor:` enum value to the new `targets: string[]` shape. */
export function legacyVendorToTargets(vendor: string | undefined): string[] {
  switch (vendor) {
    case 'altera':
      return ['quartus'];
    case 'xilinx':
      return ['vivado'];
    case 'both':
      return ['vivado', 'quartus'];
    default:
      return [];
  }
}

/**
 * Rewrite legacy `vendor: 'altera'|'xilinx'|'both'|'none'` to `targets: [...]`
 * in an IP core YAML string.
 *
 * Returns `{ changed, text, notes }`. When `changed` is false the source text
 * was already up-to-date and `text` is returned unmodified.
 */
export function migrate(ipCoreYamlText: string): {
  changed: boolean;
  text: string;
  notes: string[];
} {
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(ipCoreYamlText);
  } catch {
    return { changed: false, text: ipCoreYamlText, notes: ['parse error — skipped'] };
  }

  const root = doc.contents;
  if (!root || !YAML.isMap(root)) {
    return { changed: false, text: ipCoreYamlText, notes: [] };
  }

  const vendorNode = root.get('vendor', true);
  if (!vendorNode) {
    return { changed: false, text: ipCoreYamlText, notes: [] };
  }

  const vendorValue = String(YAML.isScalar(vendorNode) ? vendorNode.value : '');
  const targets = legacyVendorToTargets(vendorValue);

  // Remove the old vendor key and add targets
  root.delete('vendor');
  root.set('targets', targets);

  const notes = [
    `vendor: '${vendorValue}' → targets: [${targets.map((t) => `'${t}'`).join(', ')}]`,
  ];

  return { changed: true, text: doc.toString(), notes };
}
