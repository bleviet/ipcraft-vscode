import { DOMParser } from '@xmldom/xmldom';

// IP-XACT 1685-2009 namespace — same as ComponentXmlParser.ts.
const SPIRIT_NS = 'http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009';

export interface VivadoBusPortDef {
  name: string;
  width?: number;
  direction?: 'in' | 'out';
  presence?: 'required' | 'optional';
}

export interface VivadoBusType {
  vendor: string;
  library: string;
  name: string;
  version: string;
}

export interface VivadoInterfaceDef {
  busType: VivadoBusType;
  description?: string;
  ports: VivadoBusPortDef[];
}

// ---------------------------------------------------------------------------
// DOM helpers (mirrors ComponentXmlParser.ts's pattern; kept local rather than
// shared, to avoid touching that file's structure for a handful of small utils).
// ---------------------------------------------------------------------------

function childEls(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i] as Element;
    if (node.localName === localName && node.namespaceURI === SPIRIT_NS) {
      result.push(node);
    }
  }
  return result;
}

function childEl(parent: Element, localName: string): Element | undefined {
  return childEls(parent, localName)[0];
}

function text(parent: Element, localName: string): string {
  return childEl(parent, localName)?.textContent?.trim() ?? '';
}

function attr(element: Element, attrName: string): string {
  return element.getAttributeNS(SPIRIT_NS, attrName) ?? element.getAttribute(attrName) ?? '';
}

function vlnvKey(v: VivadoBusType): string {
  return `${v.vendor}:${v.library}:${v.name}:${v.version}`;
}

// ---------------------------------------------------------------------------
// Per-file parsing
// ---------------------------------------------------------------------------

interface ParsedBusDefinition {
  busType: VivadoBusType;
  description?: string;
}

interface ParsedAbstractionDefinition {
  busTypeKey: string;
  ports: VivadoBusPortDef[];
}

function parseBusDefinition(root: Element): ParsedBusDefinition | undefined {
  const vendor = text(root, 'vendor');
  const library = text(root, 'library');
  const name = text(root, 'name');
  const version = text(root, 'version');
  if (!vendor || !library || !name || !version) {
    return undefined;
  }
  const description = text(root, 'description');
  return {
    busType: { vendor, library, name, version },
    description: description || undefined,
  };
}

/**
 * Extracts the wire-level (RTL) port list from an abstractionDefinition.
 * Ports defined with <spirit:transactional> instead of <spirit:wire> (TLM/socket-level
 * abstractions, e.g. aximm_tlm.xml) are skipped — IPCraft only generates RTL component.xml.
 */
function parseAbstractionDefinition(root: Element): ParsedAbstractionDefinition | undefined {
  const busTypeEl = childEl(root, 'busType');
  if (!busTypeEl) {
    return undefined;
  }
  const busType: VivadoBusType = {
    vendor: attr(busTypeEl, 'vendor'),
    library: attr(busTypeEl, 'library'),
    name: attr(busTypeEl, 'name'),
    version: attr(busTypeEl, 'version'),
  };
  if (!busType.vendor || !busType.library || !busType.name || !busType.version) {
    return undefined;
  }

  const portsEl = childEl(root, 'ports');
  if (!portsEl) {
    return undefined;
  }

  const ports: VivadoBusPortDef[] = [];
  for (const portEl of childEls(portsEl, 'port')) {
    const logicalName = text(portEl, 'logicalName');
    const wireEl = childEl(portEl, 'wire');
    if (!logicalName || !wireEl) {
      // No <spirit:wire> — a transactional (TLM) port. Not an RTL signal; skip.
      continue;
    }
    const onMaster = childEl(wireEl, 'onMaster');
    if (!onMaster) {
      continue;
    }
    const presenceText = text(onMaster, 'presence');
    const widthText = text(onMaster, 'width');
    const directionText = text(onMaster, 'direction');

    const port: VivadoBusPortDef = { name: logicalName };
    if (widthText) {
      const width = Number(widthText);
      if (Number.isFinite(width)) {
        port.width = width;
      }
    }
    if (directionText === 'in' || directionText === 'out') {
      port.direction = directionText;
    }
    if (presenceText === 'required' || presenceText === 'optional') {
      port.presence = presenceText;
    }
    ports.push(port);
  }

  if (ports.length === 0) {
    // Every port was transactional-only — this is a TLM abstraction, not RTL. Skip the
    // whole file (e.g. aximm_tlm.xml never contributes ports for aximm).
    return undefined;
  }

  return { busTypeKey: vlnvKey(busType), ports };
}

/**
 * Parses a single Vivado interface XML file's raw text content.
 * Returns undefined for anything that isn't a standard IP-XACT 1685-2009
 * busDefinition or abstractionDefinition (e.g. Xilinx's proprietary
 * parameterAbstractionDefinition files for CHI/CPI/CXS/CXL — no wire ports at all).
 */
function parseSingleFile(
  xmlText: string
):
  | { kind: 'busDefinition'; value: ParsedBusDefinition }
  | { kind: 'abstractionDefinition'; value: ParsedAbstractionDefinition }
  | undefined {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return undefined;
  }
  const root = doc?.documentElement as unknown as Element | undefined;
  if (root?.namespaceURI !== SPIRIT_NS) {
    return undefined;
  }

  if (root.localName === 'busDefinition') {
    const parsed = parseBusDefinition(root);
    return parsed ? { kind: 'busDefinition', value: parsed } : undefined;
  }
  if (root.localName === 'abstractionDefinition') {
    const parsed = parseAbstractionDefinition(root);
    return parsed ? { kind: 'abstractionDefinition', value: parsed } : undefined;
  }
  return undefined;
}

/**
 * Parses a set of Vivado interface XML file contents (busDefinition +
 * abstractionDefinition pairs, in any order, possibly spanning many files per
 * directory — e.g. fifo_v1_0/ contains both fifo_read and fifo_write) into the
 * resolved interface list IPCraft can write out as bus-definition YAML.
 *
 * Files are classified by root element, not filename, since Vivado doesn't use
 * a consistent abstraction-definition suffix (fifo_write_rtl.xml vs aximm_tlm.xml).
 */
export function parseVivadoInterfaceFiles(fileContents: string[]): VivadoInterfaceDef[] {
  const busDefsByKey = new Map<string, ParsedBusDefinition>();
  const abstractions: ParsedAbstractionDefinition[] = [];

  for (const content of fileContents) {
    const parsed = parseSingleFile(content);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === 'busDefinition') {
      busDefsByKey.set(vlnvKey(parsed.value.busType), parsed.value);
    } else {
      abstractions.push(parsed.value);
    }
  }

  const results: VivadoInterfaceDef[] = [];
  const seenKeys = new Set<string>();
  for (const abstraction of abstractions) {
    if (seenKeys.has(abstraction.busTypeKey)) {
      // Two RTL abstraction defs for the same bus type shouldn't normally occur;
      // keep the first and ignore the rest rather than overwriting silently.
      continue;
    }
    const busDef = busDefsByKey.get(abstraction.busTypeKey);
    if (!busDef) {
      // Abstraction references a busDefinition we never found a file for.
      continue;
    }
    seenKeys.add(abstraction.busTypeKey);
    results.push({
      busType: busDef.busType,
      description: busDef.description,
      ports: abstraction.ports,
    });
  }

  return results;
}
