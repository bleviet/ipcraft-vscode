import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { DOMParser } from '@xmldom/xmldom';
import { lookupBusDef } from '../webview/ipcore/data/busDefinitions';
import { BUS_VLNV } from '../shared/busVlnv';

// IP-XACT 1685-2009 namespace
const SPIRIT_NS = 'http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009';

// Canonical IPCraft VLNV bus type identifiers — match what the canvas drag-and-drop writes.
const AXIMM_BUS_FULL = BUS_VLNV.AXI4_FULL;
const AXIMM_BUS_LITE = BUS_VLNV.AXI4_LITE;
const AXIS_BUS = BUS_VLNV.AXI_STREAM;

export interface ComponentXmlParseOptions {
  library?: string;
}

export interface ComponentXmlParseResult {
  componentName: string;
  ipYamlText: string;
  mmYamlText?: string;
  mmFileName?: string;
}

// ---------------------------------------------------------------------------
// DOM helpers — all work on Element, not Document
// ---------------------------------------------------------------------------

function els(parent: Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(SPIRIT_NS, localName));
}

function el(parent: Element, localName: string): Element | undefined {
  return els(parent, localName)[0];
}

function childEl(parent: Element, localName: string): Element | undefined {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i] as Element;
    if (node.localName === localName && node.namespaceURI === SPIRIT_NS) {
      return node;
    }
  }
  return undefined;
}

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

function text(parent: Element, localName: string): string {
  const e = el(parent, localName);
  return e?.textContent?.trim() ?? '';
}

function attr(element: Element, ns: string, attrName: string): string {
  return element.getAttributeNS(ns, attrName) ?? element.getAttribute(attrName) ?? '';
}

// ---------------------------------------------------------------------------
// Helpers for bus interface analysis
// ---------------------------------------------------------------------------

/** Extract logical port names used in portMaps for a bus interface. */
function logicalPortNames(busIfEl: Element): Set<string> {
  const names = new Set<string>();
  for (const portMap of childEls(childEl(busIfEl, 'portMaps') ?? busIfEl, 'portMap')) {
    const logPort = childEl(portMap, 'logicalPort');
    if (logPort) {
      const n = text(logPort, 'name');
      if (n) {
        names.add(n.toUpperCase());
      }
    }
  }
  return names;
}

/** Extract all physical port names from portMaps. */
function physicalPortNames(busIfEl: Element): string[] {
  const names: string[] = [];
  const portMapsEl = childEl(busIfEl, 'portMaps');
  if (!portMapsEl) {
    return names;
  }
  for (const portMap of childEls(portMapsEl, 'portMap')) {
    const physPort = childEl(portMap, 'physicalPort');
    if (physPort) {
      const n = text(physPort, 'name');
      if (n) {
        names.push(n);
      }
    }
  }
  return names;
}

/** Derive the best common physical prefix for a bus interface. */
function extractPhysicalPrefix(portNames: string[]): string | undefined {
  if (portNames.length === 0) {
    return undefined;
  }
  if (portNames.length === 1) {
    // strip trailing signal name (last segment separated by _)
    const parts = portNames[0].split('_');
    return parts.length > 1 ? parts.slice(0, -1).join('_') + '_' : undefined;
  }
  // longest common prefix
  let prefix = portNames[0];
  for (const name of portNames.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
  }
  // trim to last underscore
  const lastUnderscore = prefix.lastIndexOf('_');
  if (lastUnderscore > 0) {
    return prefix.slice(0, lastUnderscore + 1);
  }
  return prefix.length > 0 ? prefix : undefined;
}

/** Get a parameter value by name from a busInterface's spirit:parameters. */
function getBusIfParam(busIfEl: Element, paramName: string): string | undefined {
  const params = childEl(busIfEl, 'parameters');
  if (!params) {
    return undefined;
  }
  for (const param of childEls(params, 'parameter')) {
    const n = text(param, 'name');
    if (n === paramName) {
      return text(param, 'value') || undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseComponentXmlFile(
  filePath: string,
  options: ComponentXmlParseOptions = {}
): Promise<ComponentXmlParseResult> {
  const xmlText = await fs.readFile(filePath, 'utf-8');
  return parseComponentXmlText(xmlText, options);
}

export function parseComponentXmlText(
  xmlText: string,
  options: ComponentXmlParseOptions = {}
): ComponentXmlParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const root = doc.documentElement as unknown as Element;

  // ---- VLNV ---------------------------------------------------------------
  const vendor = text(root, 'vendor') || 'xilinx.com';
  const library = options.library ?? (text(root, 'library') || 'ip');
  const componentName = text(root, 'name') || 'unnamed';
  const version = text(root, 'version') || '1.0';
  const description = text(root, 'description') || undefined;

  // ---- Collect all bus interfaces -----------------------------------------
  const busInterfaceEls = els(root, 'busInterface');

  // Maps: clock/reset bus interface name → physical port name
  const clockPortMap = new Map<string, string>(); // busIfName → physPortName
  const resetPortMap = new Map<string, { port: string; polarity: 'activeLow' | 'activeHigh' }>();

  // First pass: collect clock and reset signal busInterfaces
  for (const busIf of busInterfaceEls) {
    const busTypeEl = busIf.getElementsByTagNameNS(SPIRIT_NS, 'busType')[0] as Element | undefined;
    if (!busTypeEl) {
      continue;
    }
    const btName = attr(busTypeEl, SPIRIT_NS, 'name');

    if (btName === 'clock') {
      const phyPorts = physicalPortNames(busIf);
      if (phyPorts[0]) {
        clockPortMap.set(text(busIf, 'name'), phyPorts[0]);
      }
    } else if (btName === 'reset') {
      const phyPorts = physicalPortNames(busIf);
      const polStr = getBusIfParam(busIf, 'POLARITY') ?? '';
      const polarity: 'activeLow' | 'activeHigh' =
        polStr === 'ACTIVE_LOW' ? 'activeLow' : 'activeHigh';
      if (phyPorts[0]) {
        resetPortMap.set(text(busIf, 'name'), { port: phyPorts[0], polarity });
      }
    }
  }

  // ---- Build associated-clock map: busIfName → clockPortName ----
  // by examining ASSOCIATED_BUSIF params on clock busIfs
  const clkAssoc = new Map<string, string>(); // dataBusIfName → clockPortName

  for (const busIf of busInterfaceEls) {
    const busTypeEl = busIf.getElementsByTagNameNS(SPIRIT_NS, 'busType')[0] as Element | undefined;
    if (!busTypeEl) {
      continue;
    }
    const btName = attr(busTypeEl, SPIRIT_NS, 'name');
    const ifName = text(busIf, 'name');

    if (btName === 'clock') {
      const assocBusIf = getBusIfParam(busIf, 'ASSOCIATED_BUSIF') ?? '';
      const clockPort = clockPortMap.get(ifName);
      if (clockPort) {
        for (const assocName of assocBusIf
          .split(':')
          .map((s) => s.trim())
          .filter(Boolean)) {
          clkAssoc.set(assocName, clockPort);
        }
      }
    }
  }

  // ---- Collect unique clocks and resets -----------------------------------
  const clockSet = new Map<string, boolean>(); // portName → true
  const resetSet = new Map<string, 'activeLow' | 'activeHigh'>(); // portName → polarity

  for (const [, portName] of clockPortMap) {
    clockSet.set(portName, true);
  }
  for (const [, r] of resetPortMap) {
    resetSet.set(r.port, r.polarity);
  }

  const clocks = Array.from(clockSet.keys()).map((name) => ({ name, direction: 'in' as const }));
  const resets = Array.from(resetSet.entries()).map(([name, polarity]) => ({
    name,
    direction: 'in' as const,
    polarity,
  }));

  // ---- Second pass: data bus interfaces -----------------------------------
  interface BusIfEntry {
    name: string;
    type: string;
    mode: string;
    physicalPrefix?: string;
    associatedClock?: string;
    associatedReset?: string;
    memoryMapRef?: string;
    useOptionalPorts?: string[];
  }
  const busInterfaces: BusIfEntry[] = [];

  for (const busIf of busInterfaceEls) {
    const busTypeEl = busIf.getElementsByTagNameNS(SPIRIT_NS, 'busType')[0] as Element | undefined;
    if (!busTypeEl) {
      continue;
    }
    const btName = attr(busTypeEl, SPIRIT_NS, 'name');
    // skip clock/reset; interrupt is handled separately below
    if (btName === 'clock' || btName === 'reset' || btName === 'interrupt') {
      continue;
    }

    const ifName = text(busIf, 'name');
    const isSlave = !!busIf.getElementsByTagNameNS(SPIRIT_NS, 'slave')[0];
    const mode = isSlave ? 'slave' : 'master';

    // Bus type determination
    let busType: string;
    if (btName === 'aximm') {
      const logPorts = logicalPortNames(busIf);
      // AXI4-Full has ARLEN (burst length); AXI4-Lite does not
      busType = logPorts.has('ARLEN') || logPorts.has('AWLEN') ? AXIMM_BUS_FULL : AXIMM_BUS_LITE;
    } else if (btName === 'axis') {
      busType = AXIS_BUS;
    } else {
      // Unknown bus type — parse full VLNV from the XML attributes
      const btVendor = attr(busTypeEl, SPIRIT_NS, 'vendor') || 'user.org';
      const btLibrary = attr(busTypeEl, SPIRIT_NS, 'library') || 'user';
      const btVersion = attr(busTypeEl, SPIRIT_NS, 'version') || '1.0';
      busType = `${btVendor}.${btLibrary}.${btName}.${btVersion}`;
    }

    // Physical prefix
    const phyPorts = physicalPortNames(busIf);
    const physicalPrefix = extractPhysicalPrefix(phyPorts);

    // Memory map reference
    const memMapRefEl = busIf.getElementsByTagNameNS(SPIRIT_NS, 'memoryMapRef')[0] as
      | Element
      | undefined;
    const memoryMapRef = memMapRefEl
      ? attr(memMapRefEl, SPIRIT_NS, 'memoryMapRef') || memMapRefEl.textContent?.trim()
      : undefined;

    // Associated clock: look up in clkAssoc map
    const associatedClock = clkAssoc.get(ifName);

    // Associated reset: find a reset busIf that is associated with this interface
    // (Xilinx associates resets via clock busIf ASSOCIATED_RESET parameter referencing port names)
    // Do a simple heuristic: if there's only one reset, associate it.
    const associatedReset = resetSet.size === 1 ? Array.from(resetSet.keys())[0] : undefined;

    const entry: BusIfEntry = {
      name: ifName,
      type: busType,
      mode,
    };
    if (physicalPrefix) {
      entry.physicalPrefix = physicalPrefix;
    }
    if (associatedClock) {
      entry.associatedClock = associatedClock;
    }
    if (associatedReset) {
      entry.associatedReset = associatedReset;
    }
    if (memoryMapRef) {
      entry.memoryMapRef = memoryMapRef;
    }

    // Optional ports detection
    const busDef = lookupBusDef(busType);
    if (busDef) {
      const logPorts = logicalPortNames(busIf);
      const useOptionalPorts = busDef
        .filter((def) => def.presence === 'optional' && logPorts.has(def.name.toUpperCase()))
        .map((def) => def.name.toLowerCase());
      if (useOptionalPorts.length > 0) {
        entry.useOptionalPorts = useOptionalPorts;
      }
    }

    busInterfaces.push(entry);
  }

  // ---- Interrupt bus interfaces -------------------------------------------
  interface InterruptEntry {
    name: string;
    direction: 'out' | 'in';
    sensitivity?: string;
  }
  const interrupts: InterruptEntry[] = [];

  for (const busIf of busInterfaceEls) {
    const busTypeEl = busIf.getElementsByTagNameNS(SPIRIT_NS, 'busType')[0] as Element | undefined;
    if (!busTypeEl) {
      continue;
    }
    const btName = attr(busTypeEl, SPIRIT_NS, 'name');
    if (btName !== 'interrupt') {
      continue;
    }

    const phyPorts = physicalPortNames(busIf);
    if (phyPorts.length === 0) {
      continue;
    }

    // master = sender (output interrupt), slave = receiver (input interrupt)
    const isSlave = !!busIf.getElementsByTagNameNS(SPIRIT_NS, 'slave')[0];
    const direction: 'out' | 'in' = isSlave ? 'in' : 'out';

    const sensitivity = getBusIfParam(busIf, 'SENSITIVITY');

    for (const portName of phyPorts) {
      const entry: InterruptEntry = { name: portName, direction };
      if (sensitivity) {
        entry.sensitivity = sensitivity;
      }
      interrupts.push(entry);
    }
  }

  // ---- Parameters ---------------------------------------------------------
  // Vivado injects these as IP-XACT parameters for its own tooling; they are
  // not HDL generics and must not appear in the generated .ip.yml.
  const VIVADO_INTERNAL_PARAMS = new Set(['Component_Name']);

  // Build choices map: choiceName → allowed values (for spirit:choiceRef lookup)
  const choicesMap = new Map<string, (string | number)[]>();
  const choicesEl = el(root, 'choices');
  if (choicesEl) {
    for (const choiceEl of childEls(choicesEl, 'choice')) {
      const choiceName = text(choiceEl, 'name');
      if (!choiceName) {
        continue;
      }
      const enumerationsEl = childEl(choiceEl, 'enumerations');
      const enumEls = enumerationsEl
        ? childEls(enumerationsEl, 'enumeration')
        : childEls(choiceEl, 'enumeration');
      const values: (string | number)[] = enumEls
        .map((e) => e.textContent?.trim() ?? '')
        .filter(Boolean);
      if (values.length > 0) {
        choicesMap.set(choiceName, values);
      }
    }
  }

  interface Param {
    name: string;
    value: string | number | boolean;
    dataType: string;
    min?: number;
    max?: number;
    allowedValues?: (string | number)[];
  }
  const parameters: Param[] = [];

  const topParamsEl = childEl(root, 'parameters');
  if (topParamsEl) {
    for (const param of childEls(topParamsEl, 'parameter')) {
      const pName = text(param, 'name');
      if (!pName || VIVADO_INTERNAL_PARAMS.has(pName)) {
        continue;
      }

      const valueEl = childEl(param, 'value');
      const rawValue = valueEl?.textContent?.trim() ?? '';
      const format = valueEl ? attr(valueEl, SPIRIT_NS, 'format') : '';

      let value: string | number | boolean = rawValue;
      let dataType = 'string';

      if (format === 'long' || format === 'bitString') {
        const n = parseInt(rawValue, 10);
        if (!isNaN(n)) {
          value = n;
          dataType = 'integer';
        }
      } else if (format === 'bool') {
        value = rawValue === 'true';
        dataType = 'boolean';
      }

      const entry: Param = { name: pName, value, dataType };

      const minStr = valueEl ? attr(valueEl, SPIRIT_NS, 'minimum') : '';
      const maxStr = valueEl ? attr(valueEl, SPIRIT_NS, 'maximum') : '';
      const choiceRef = valueEl ? attr(valueEl, SPIRIT_NS, 'choiceRef') : '';

      if (minStr !== '') {
        const minVal = parseInt(minStr, 10);
        if (!isNaN(minVal)) {
          entry.min = minVal;
        }
      }
      if (maxStr !== '') {
        const maxVal = parseInt(maxStr, 10);
        if (!isNaN(maxVal)) {
          entry.max = maxVal;
        }
      }
      if (choiceRef) {
        const choices = choicesMap.get(choiceRef);
        if (choices && choices.length > 0) {
          entry.allowedValues = choices;
        }
      }

      parameters.push(entry);
    }
  }

  // ---- Standalone User Ports ----------------------------------------------
  interface UserPort {
    name: string;
    direction: 'in' | 'out';
    width: number;
  }
  const userPorts: UserPort[] = [];

  const assignedPorts = new Set<string>();
  for (const [, port] of clockPortMap) {
    assignedPorts.add(port);
  }
  for (const [, r] of resetPortMap) {
    assignedPorts.add(r.port);
  }
  for (const intr of interrupts) {
    assignedPorts.add(intr.name);
  }
  for (const busIf of busInterfaceEls) {
    for (const p of physicalPortNames(busIf)) {
      assignedPorts.add(p);
    }
  }

  const modelEl = childEl(root, 'model');
  const portsEl = modelEl ? childEl(modelEl, 'ports') : undefined;
  if (portsEl) {
    for (const portEl of childEls(portsEl, 'port')) {
      const pName = text(portEl, 'name');
      if (!pName || assignedPorts.has(pName)) {
        continue;
      }
      const wireEl = childEl(portEl, 'wire');
      if (!wireEl) {
        continue;
      }
      const direction = text(wireEl, 'direction') === 'out' ? 'out' : 'in';
      const vectorEl = childEl(wireEl, 'vector');
      let width = 1;
      if (vectorEl) {
        const left = parseHexOrDec(text(vectorEl, 'left'));
        const right = parseHexOrDec(text(vectorEl, 'right'));
        width = Math.abs(left - right) + 1;
      }
      userPorts.push({ name: pName, direction, width });
    }
  }

  // ---- Memory maps (for .mm.yml) -----------------------------------------
  interface FieldDef {
    name: string;
    description?: string;
    bitOffset: number;
    bitWidth: number;
    access: string;
    reset?: number;
  }
  interface RegisterDef {
    name: string;
    description?: string;
    addressOffset: number;
    size: number;
    access: string;
    fields: FieldDef[];
  }
  interface AddressBlockDef {
    name: string;
    baseAddress: number;
    range: number;
    width: number;
    registers: RegisterDef[];
  }
  interface MemoryMapDef {
    name: string;
    addressBlocks: AddressBlockDef[];
  }

  const memMaps: MemoryMapDef[] = [];
  const memMapsEl = el(root, 'memoryMaps');
  if (memMapsEl) {
    for (const mmEl of childEls(memMapsEl, 'memoryMap')) {
      const mmName = text(mmEl, 'name');
      const addrBlocks: AddressBlockDef[] = [];

      for (const abEl of childEls(mmEl, 'addressBlock')) {
        const abName = text(abEl, 'name');
        const baseAddrStr = text(abEl, 'baseAddress');
        const rangeStr = text(abEl, 'range');
        const widthStr = text(abEl, 'width');
        const baseAddress = parseHexOrDec(baseAddrStr);
        const range = parseHexOrDec(rangeStr);
        const width = parseHexOrDec(widthStr) || 32;

        const registers: RegisterDef[] = [];
        for (const regEl of childEls(abEl, 'register')) {
          const regName = text(regEl, 'name');
          const regDesc = text(regEl, 'description') || undefined;
          const addrOffsetStr = text(regEl, 'addressOffset');
          const sizeStr = text(regEl, 'size');
          const regAccess = text(regEl, 'access') || 'read-write';

          const fields: FieldDef[] = [];
          // IP-XACT allows fields as direct children of register OR inside a
          // <spirit:fields> wrapper. Vivado omits the wrapper element.
          const fieldsEl = childEl(regEl, 'fields');
          const fieldEls = fieldsEl ? childEls(fieldsEl, 'field') : childEls(regEl, 'field');
          for (const fieldEl of fieldEls) {
            const fieldName = text(fieldEl, 'name');
            const fieldDesc = text(fieldEl, 'description') || undefined;
            const bitOffsetStr = text(fieldEl, 'bitOffset');
            const bitWidthStr = text(fieldEl, 'bitWidth');
            const fieldAccess = text(fieldEl, 'access') || regAccess;
            // IP-XACT 2009: <spirit:reset>0x0</spirit:reset> (plain text)
            // Vivado extension: <spirit:reset><spirit:value>0x0</spirit:value></spirit:reset>
            const resetEl = childEl(fieldEl, 'reset');
            const resetStr = resetEl
              ? text(resetEl, 'value') || resetEl.textContent?.trim() || ''
              : text(fieldEl, 'resetValue');
            fields.push({
              name: fieldName,
              description: fieldDesc,
              bitOffset: parseHexOrDec(bitOffsetStr),
              bitWidth: parseHexOrDec(bitWidthStr) || 1,
              access: normalizeAccess(fieldAccess),
              reset: resetStr ? parseHexOrDec(resetStr) : undefined,
            });
          }

          registers.push({
            name: regName,
            description: regDesc,
            addressOffset: parseHexOrDec(addrOffsetStr),
            size: parseHexOrDec(sizeStr) || 32,
            access: normalizeAccess(regAccess),
            fields,
          });
        }

        addrBlocks.push({ name: abName, baseAddress, range, width, registers });
      }
      memMaps.push({ name: mmName, addressBlocks: addrBlocks });
    }
  }

  // ---- Build .ip.yml object -----------------------------------------------
  const hasMemMaps = memMaps.some((mm) => mm.addressBlocks.some((ab) => ab.registers.length > 0));
  const mmFileName = hasMemMaps ? `${componentName}.mm.yml` : undefined;

  // Build memoryMaps section
  let ipMemoryMaps: Record<string, unknown> | undefined;
  if (mmFileName) {
    ipMemoryMaps = { import: mmFileName };
  }

  const ipObj: Record<string, unknown> = {
    apiVersion: '1.0',
    vlnv: { vendor, library, name: componentName, version },
  };
  if (description) {
    ipObj.description = description;
  }
  if (clocks.length > 0) {
    ipObj.clocks = clocks;
  }
  if (resets.length > 0) {
    ipObj.resets = resets;
  }
  if (interrupts.length > 0) {
    ipObj.interrupts = interrupts;
  }
  if (busInterfaces.length > 0) {
    ipObj.busInterfaces = busInterfaces;
  }
  if (ipMemoryMaps) {
    ipObj.memoryMaps = ipMemoryMaps;
  }
  if (userPorts.length > 0) {
    ipObj.ports = userPorts;
  }
  if (parameters.length > 0) {
    ipObj.parameters = parameters;
  }

  // ---- Parse xilinx:subCoreRef from fileSets (new format) and coreExtensions (legacy) ---
  const XILINX_NS = 'http://www.xilinx.com';
  const fileSetsEl = childEl(root, 'fileSets');
  {
    const seen = new Set<string>();
    const subcores: string[] = [];

    function extractVlnvFromSubCoreRef(scRef: Element): void {
      // New format: <xilinx:componentRef xilinx:vendor="..." ...>
      const compRefEls = scRef.getElementsByTagNameNS(XILINX_NS, 'componentRef');
      const compRefEl = compRefEls[0] as Element | undefined;
      if (compRefEl) {
        const vendor = compRefEl.getAttributeNS(XILINX_NS, 'vendor') ?? '';
        const library = compRefEl.getAttributeNS(XILINX_NS, 'library') ?? '';
        const name = compRefEl.getAttributeNS(XILINX_NS, 'name') ?? '';
        const version = compRefEl.getAttributeNS(XILINX_NS, 'version') ?? '';
        if (vendor && library && name && version) {
          const vlnv = `${vendor}:${library}:${name}:${version}`;
          if (!seen.has(vlnv)) {
            seen.add(vlnv);
            subcores.push(vlnv);
          }
        }
        return;
      }
      // Legacy format: <xilinx:vlnv xilinx:vendor="..." .../>
      const vlnvEls = scRef.getElementsByTagNameNS(XILINX_NS, 'vlnv');
      const vlnvEl = vlnvEls[0] as Element | undefined;
      if (vlnvEl) {
        const vendor = vlnvEl.getAttributeNS(XILINX_NS, 'vendor') ?? '';
        const library = vlnvEl.getAttributeNS(XILINX_NS, 'library') ?? '';
        const name = vlnvEl.getAttributeNS(XILINX_NS, 'name') ?? '';
        const version = vlnvEl.getAttributeNS(XILINX_NS, 'version') ?? '';
        if (vendor && library && name && version) {
          const vlnv = `${vendor}:${library}:${name}:${version}`;
          if (!seen.has(vlnv)) {
            seen.add(vlnv);
            subcores.push(vlnv);
          }
        }
      }
    }

    // Search fileSets for subCoreRef (new fileset-based structure)
    if (fileSetsEl) {
      const subCoreRefEls = fileSetsEl.getElementsByTagNameNS(XILINX_NS, 'subCoreRef');
      for (let i = 0; i < subCoreRefEls.length; i++) {
        extractVlnvFromSubCoreRef(subCoreRefEls[i]);
      }
    }

    // Also search coreExtensions for legacy subCoreRef
    const vendorExtEl = childEl(root, 'vendorExtensions');
    if (vendorExtEl) {
      const coreExtEls = vendorExtEl.getElementsByTagNameNS(XILINX_NS, 'coreExtensions');
      const coreExtEl = coreExtEls[0] as Element | undefined;
      if (coreExtEl) {
        const subCoreRefEls = coreExtEl.getElementsByTagNameNS(XILINX_NS, 'subCoreRef');
        for (let i = 0; i < subCoreRefEls.length; i++) {
          extractVlnvFromSubCoreRef(subCoreRefEls[i]);
        }
      }
    }

    if (subcores.length > 0) {
      ipObj.subcores = subcores;
    }
  }

  // ---- Build fileSets from spirit:fileSets --------------------------------
  if (fileSetsEl) {
    interface FileEntry {
      path: string;
      type: string;
      managed: boolean;
      logicalName?: string;
      isIncludeFile?: boolean;
    }
    interface Bucket {
      description: string;
      files: FileEntry[];
      seenPaths: Set<string>;
    }

    // Accumulate into canonical buckets (Map preserves insertion order)
    const buckets = new Map<string, Bucket>();

    for (const fsEl of childEls(fileSetsEl, 'fileSet')) {
      const fsName = text(fsEl, 'name');
      if (!fsName) {
        continue;
      }

      const canonical = vivadoFilesetCanonicalName(fsName);
      if (!canonical) {
        continue; // explicitly skipped category
      }

      const fileEls = childEls(fsEl, 'file');
      if (fileEls.length === 0) {
        continue;
      }

      if (!buckets.has(canonical.name)) {
        buckets.set(canonical.name, {
          description: canonical.description,
          files: [],
          seenPaths: new Set(),
        });
      }
      const bucket = buckets.get(canonical.name)!;

      for (const fileEl of fileEls) {
        const filePath = text(fileEl, 'name');
        if (!filePath || filePath.startsWith('http://') || filePath.startsWith('https://')) {
          continue;
        }
        if (bucket.seenPaths.has(filePath)) {
          continue; // deduplicate across merged filesets
        }
        bucket.seenPaths.add(filePath);

        const entry: FileEntry = {
          path: filePath,
          type: mapFileType(text(fileEl, 'fileType')),
          managed: false,
        };

        const logicalName = text(fileEl, 'logicalName');
        if (logicalName) {
          entry.logicalName = logicalName;
        }
        if (text(fileEl, 'isIncludeFile') === 'true') {
          entry.isIncludeFile = true;
        }

        bucket.files.push(entry);
      }
    }

    const fileSetList: Array<{ name: string; description?: string; files: FileEntry[] }> = [];
    for (const [name, { description, files }] of buckets) {
      if (files.length > 0) {
        const entry: { name: string; description?: string; files: FileEntry[] } = { name, files };
        if (description) {
          entry.description = description;
        }
        fileSetList.push(entry);
      }
    }

    if (fileSetList.length > 0) {
      ipObj.fileSets = fileSetList;
    }
  }

  const ipYamlText = yaml.dump(ipObj, { lineWidth: 120, noRefs: true });

  // ---- Build .mm.yml object -----------------------------------------------
  let mmYamlText: string | undefined;
  if (hasMemMaps) {
    const mmObj: Record<string, unknown> = {
      apiVersion: '1.0',
      vlnv: { vendor, library, name: componentName, version },
    };
    const mmSections: Record<string, unknown>[] = [];
    for (const mm of memMaps) {
      for (const ab of mm.addressBlocks) {
        if (ab.registers.length === 0) {
          continue;
        }
        const regsOut: Record<string, unknown>[] = [];
        for (const reg of ab.registers) {
          const regOut: Record<string, unknown> = {
            name: reg.name,
            addressOffset: `0x${reg.addressOffset.toString(16).toUpperCase().padStart(2, '0')}`,
            size: reg.size,
            access: reg.access,
          };
          if (reg.description) {
            regOut.description = reg.description;
          }
          if (reg.fields.length > 0) {
            regOut.fields = reg.fields.map((f) => {
              const fOut: Record<string, unknown> = {
                name: f.name,
                bitOffset: f.bitOffset,
                bitWidth: f.bitWidth,
                access: f.access,
              };
              if (f.description) {
                fOut.description = f.description;
              }
              if (f.reset !== undefined) {
                fOut.reset = f.reset;
              }
              return fOut;
            });
          }
          regsOut.push(regOut);
        }
        mmSections.push({
          name: ab.name,
          memoryMapRef: mm.name,
          baseAddress: `0x${ab.baseAddress.toString(16).toUpperCase().padStart(8, '0')}`,
          range: ab.range,
          width: ab.width,
          registers: regsOut,
        });
      }
    }
    mmObj.addressBlocks = mmSections;
    mmYamlText = yaml.dump(mmObj, { lineWidth: 120, noRefs: true });
  }

  return { componentName, ipYamlText, mmYamlText, mmFileName };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseHexOrDec(s: string): number {
  if (!s) {
    return 0;
  }
  const trimmed = s.trim();
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return parseInt(trimmed, 16);
  }
  return parseInt(trimmed, 10) || 0;
}

/**
 * Maps a spirit:fileSet name to an ipcraft canonical fileset name + description.
 * Returns null for filesets that should be skipped entirely (subcores, examples, etc.).
 * Non-Vivado names are passed through unchanged.
 */
function vivadoFilesetCanonicalName(name: string): { name: string; description: string } | null {
  // Subcore reference filesets — source files are owned by the subcore
  if (name.endsWith('_ref_view_fileset')) {
    return null;
  }
  // Example designs, product guides, upgrade scripts, version info
  if (
    /^xilinx_(examples|examplesscriptext|examplessimulation|examplessynthesis|productguide|upgradescripts|versioninformation)/.test(
      name
    )
  ) {
    return null;
  }
  // Synthesis (VHDL, Verilog, SV, …) → RTL_Sources
  if (/synthesis/i.test(name)) {
    return { name: 'RTL_Sources', description: 'RTL Sources' };
  }
  // Behavioral / functional simulation → Simulation_Resources
  if (/simulation/i.test(name)) {
    return { name: 'Simulation_Resources', description: 'Simulation Files' };
  }
  // XGUI, block diagram, implementation constraints → Integration
  if (/^xilinx_(xpgui|blockdiagram|implementation)_/.test(name)) {
    return { name: 'Integration', description: 'Integration Files' };
  }
  // Non-Vivado or unrecognised: keep original name without a description
  return { name, description: '' };
}

function mapFileType(fileTypeStr: string): string {
  switch (fileTypeStr) {
    case 'vhdlSource':
      return 'vhdl';
    case 'verilogSource':
      return 'verilog';
    case 'systemVerilogSource':
      return 'systemverilog';
    case 'xdcSource':
      return 'xdc';
    case 'sdcSource':
      return 'sdc';
    case 'ucfSource':
      return 'ucf';
    case 'tclSource':
      return 'tcl';
    case 'cSource':
      return 'cSource';
    case 'cppSource':
      return 'cppSource';
    case 'python':
    case 'pythonSource':
      return 'python';
    case 'pdf':
      return 'pdf';
    case 'markdown':
      return 'markdown';
    case 'text':
    case 'textSource':
      return 'text';
    default:
      return 'unknown';
  }
}

function normalizeAccess(access: string): string {
  switch (access.toLowerCase()) {
    case 'read-write':
    case 'read_write':
      return 'read-write';
    case 'read-only':
    case 'read_only':
      return 'read-only';
    case 'write-only':
    case 'write_only':
      return 'write-only';
    case 'writeonce':
    case 'write-once':
      return 'write-once';
    default:
      return access;
  }
}
