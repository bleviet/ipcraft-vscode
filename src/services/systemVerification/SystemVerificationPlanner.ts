import type {
  DiscoveredBoundaryInterface,
  DiscoveredBoundaryPort,
  DiscoveredBoundarySignal,
  DiscoveredAxiRoute,
  DiscoveredSystem,
  SystemVerificationConfig,
  SystemVerificationPlan,
  SystemVerificationTarget,
  SystemVerificationTransaction,
  VerificationVector,
} from '../../domain/systemVerification.types';
import type {
  NormalizedAddressBlock,
  NormalizedField,
  NormalizedMemoryMap,
  NormalizedRegister,
} from '../../domain/internal.types';

type SkipCategory = 'read-only' | 'write-one-to-clear' | 'side-effect' | 'volatile' | 'write-only';

interface PlannedRegister {
  readonly addressOffset: number;
  readonly name: string;
  readonly register: NormalizedRegister;
}

const safeReadbackAccess = new Set(['read-write', 'rw']);
const readableAccess = new Set([
  'read-write',
  'rw',
  'read-only',
  'ro',
  'read-write-1-to-clear',
  'read-write-self-clearing',
]);

export function buildSystemVerificationPlan(
  config: SystemVerificationConfig,
  discovered: DiscoveredSystem,
  memoryMap: NormalizedMemoryMap
): SystemVerificationPlan {
  validateDesignName(config, discovered);
  const route = resolveUniqueAxi4LiteRoute(config.target, discovered);
  if (discovered.wrapperLanguage.toLowerCase() !== 'vhdl') {
    throw new Error(
      `discovered wrapper language ${discovered.wrapperLanguage} is unsupported; VHDL is required`
    );
  }
  const boundaryInterface = validateBoundaryInterface(config, route, discovered);
  const clockPort = resolveTypedBoundaryPort(config.clockPath, 'clockPath', 'clock', discovered);
  const resetPort = resolveTypedBoundaryPort(config.resetPath, 'resetPath', 'reset', discovered);
  const memoryMapRange = memoryMapRangeBytes(memoryMap);
  if (route.addressRange < memoryMapRange) {
    throw new Error(
      `target route addressRange ${route.addressRange} is smaller than memory map range ${memoryMapRange}`
    );
  }

  const transactions = plannedRegisters(memoryMap)
    .map((planned) => buildTransaction(planned, route))
    .sort(
      (left, right) =>
        left.address - right.address || left.registerName.localeCompare(right.registerName)
    );
  const vectorCount = transactions.reduce(
    (count, transaction) => count + transaction.vectors.length,
    0
  );
  if (vectorCount === 0) {
    throw new Error('memory map produces no executable verification vectors');
  }

  return {
    route,
    boundaryInterface,
    clockPort,
    resetPort,
    wrapperLanguage: 'VHDL',
    transactions,
  };
}

export function buildDeterministicVectors(
  register: NormalizedRegister,
  busBytes: number
): VerificationVector[] {
  const busWidth = busWidthBits(busBytes);
  const busMask = widthMask(busWidth);
  const fields = effectiveFields(register, busWidth);
  const resetValue = composeResetValue(register, fields, busMask);
  const readableMask = fields.reduce(
    (mask, field) => (field.readable ? (mask | field.mask) >>> 0 : mask),
    0
  );
  const writableMask = fields.reduce(
    (mask, field) => (field.safeForReadback ? (mask | field.mask) >>> 0 : mask),
    0
  );
  const skippedReason = skipReason(fields);
  const expectedResetValue = (resetValue & readableMask) >>> 0;

  if (readableMask === 0) {
    return [];
  }

  const resetRead = vector(
    'resetRead',
    register,
    expectedResetValue,
    readableMask,
    undefined,
    skippedReason
  );
  if (writableMask === 0) {
    return [resetRead];
  }

  const writes = [0, writableMask, ...walkingOneValues(writableMask)].map((writeValue) =>
    vector('writeReadback', register, writeValue, writableMask, writeValue, skippedReason)
  );

  return [resetRead, ...writes];
}

function validateDesignName(config: SystemVerificationConfig, discovered: DiscoveredSystem): void {
  if (config.designName !== discovered.designName) {
    throw new Error(
      `designName ${config.designName} does not match discovered design ${discovered.designName}`
    );
  }
}

function resolveUniqueAxi4LiteRoute(
  target: SystemVerificationTarget,
  discovered: DiscoveredSystem
): DiscoveredAxiRoute {
  if (!discovered.boundaryInterfaces.some(({ path }) => path === target.driveInterfacePath)) {
    throw new Error(
      `target.driveInterfacePath ${target.driveInterfacePath} is not a discovered boundary interface`
    );
  }
  if (!discovered.instancePaths.includes(target.instancePath)) {
    throw new Error(`target.instancePath ${target.instancePath} is not a discovered instance`);
  }

  const targetRoutes = discovered.axiRoutes.filter(
    (route) =>
      route.driveInterfacePath === target.driveInterfacePath &&
      route.instancePath === target.instancePath
  );
  const compatibleRoutes = targetRoutes.filter((route) => isAxi4Lite(route.protocol));

  if (compatibleRoutes.length === 0) {
    if (targetRoutes.length > 0) {
      throw new Error(
        `target route ${target.driveInterfacePath} to ${target.instancePath} is not AXI4-Lite`
      );
    }
    throw new Error(
      `target ${target.driveInterfacePath} to ${target.instancePath} has no discovered route`
    );
  }
  if (compatibleRoutes.length > 1) {
    throw new Error(
      `target ${target.driveInterfacePath} to ${target.instancePath} has more than one AXI4-Lite route`
    );
  }

  const [route] = compatibleRoutes;
  if (!Number.isInteger(route.baseAddress) || route.baseAddress < 0) {
    throw new Error(`target route baseAddress ${route.baseAddress} must be a non-negative integer`);
  }
  if (!Number.isInteger(route.addressRange) || route.addressRange <= 0) {
    throw new Error(`target route addressRange ${route.addressRange} must be a positive integer`);
  }
  busWidthBits(route.busBytes);
  if (route.addressWidth !== 32) {
    throw new Error(
      `target route address width ${route.addressWidth} is unsupported; V1 requires 32 bits`
    );
  }
  if (!route.addressSegmentPath.startsWith(`${target.instancePath}/`)) {
    throw new Error(
      `target route address segment ${route.addressSegmentPath} is not owned by ${target.instancePath}`
    );
  }
  return route;
}

const expectedAxi4LiteSignals: ReadonlyArray<DiscoveredBoundarySignal> = [
  { name: 'araddr', direction: 'in', width: 32 },
  { name: 'arprot', direction: 'in', width: 3 },
  { name: 'arready', direction: 'out', width: 1 },
  { name: 'arvalid', direction: 'in', width: 1 },
  { name: 'awaddr', direction: 'in', width: 32 },
  { name: 'awprot', direction: 'in', width: 3 },
  { name: 'awready', direction: 'out', width: 1 },
  { name: 'awvalid', direction: 'in', width: 1 },
  { name: 'bready', direction: 'in', width: 1 },
  { name: 'bresp', direction: 'out', width: 2 },
  { name: 'bvalid', direction: 'out', width: 1 },
  { name: 'rdata', direction: 'out', width: 32 },
  { name: 'rready', direction: 'in', width: 1 },
  { name: 'rresp', direction: 'out', width: 2 },
  { name: 'rvalid', direction: 'out', width: 1 },
  { name: 'wdata', direction: 'in', width: 32 },
  { name: 'wready', direction: 'out', width: 1 },
  { name: 'wstrb', direction: 'in', width: 4 },
  { name: 'wvalid', direction: 'in', width: 1 },
];

function validateBoundaryInterface(
  config: SystemVerificationConfig,
  route: DiscoveredAxiRoute,
  discovered: DiscoveredSystem
): DiscoveredBoundaryInterface {
  const boundary = discovered.boundaryInterfaces.find(
    ({ path }) => path === config.target.driveInterfacePath
  );
  if (!boundary) {
    throw new Error(
      `target.driveInterfacePath ${config.target.driveInterfacePath} is not a discovered boundary interface`
    );
  }
  if (boundary.mode.toLowerCase() !== 'slave' || !isAxi4Lite(boundary.protocol)) {
    throw new Error(
      `target.driveInterfacePath ${boundary.path} must be a slave AXI4-Lite boundary interface`
    );
  }
  if (boundary.addressWidth !== 32 || boundary.dataWidth !== 32) {
    throw new Error(
      `target.driveInterfacePath ${boundary.path} has unsupported ${boundary.addressWidth}-bit address and ${boundary.dataWidth}-bit data widths; V1 requires 32-bit address and data`
    );
  }
  if (route.addressWidth !== boundary.addressWidth || route.busBytes * 8 !== boundary.dataWidth) {
    throw new Error(`target route widths do not match boundary interface ${boundary.path}`);
  }

  const actualSignals = [...boundary.signals].sort(compareSignals);
  const expectedSignals = [...expectedAxi4LiteSignals].sort(compareSignals);
  const actualShape = actualSignals.map(formatSignal).join(', ');
  const expectedShape = expectedSignals.map(formatSignal).join(', ');
  if (actualShape !== expectedShape) {
    throw new Error(
      `target.driveInterfacePath ${boundary.path} has unsupported physical AXI4-Lite shape: ${actualShape}; expected ${expectedShape}`
    );
  }
  return boundary;
}

function resolveTypedBoundaryPort(
  configuredPath: string,
  field: 'clockPath' | 'resetPath',
  type: 'clock' | 'reset',
  discovered: DiscoveredSystem
): DiscoveredBoundaryPort {
  const port = discovered.boundaryPorts.find(({ path }) => path === configuredPath);
  if (port?.type !== type || port.direction !== 'in' || port.width !== 1) {
    throw new Error(
      `${field} ${configuredPath} must identify a discovered scalar input ${type} port`
    );
  }
  return port;
}

function compareSignals(left: DiscoveredBoundarySignal, right: DiscoveredBoundarySignal): number {
  return left.name.localeCompare(right.name);
}

function formatSignal(signal: DiscoveredBoundarySignal): string {
  return `${signal.name}:${signal.direction}:${signal.width}`;
}

function isAxi4Lite(protocol: string): boolean {
  const normalized = protocol.toLowerCase().replace(/[-_]/g, '');
  return normalized === 'axi4lite';
}

function buildTransaction(
  planned: PlannedRegister,
  route: DiscoveredAxiRoute
): SystemVerificationTransaction {
  const address = route.baseAddress + planned.addressOffset;
  const vectors = buildDeterministicVectors(planned.register, route.busBytes).map((vectorItem) => ({
    ...vectorItem,
    address,
    registerName: planned.name,
  }));

  return { registerName: planned.name, address, vectors };
}

function plannedRegisters(memoryMap: NormalizedMemoryMap): PlannedRegister[] {
  const registers: PlannedRegister[] = [];
  for (const block of memoryMap.addressBlocks) {
    if (block.usage !== 'register') {
      continue;
    }
    for (const register of block.registers) {
      expandRegister(register, block.baseAddress, '', registers);
    }
  }
  return registers;
}

function expandRegister(
  register: NormalizedRegister,
  baseOffset: number,
  prefix: string,
  out: PlannedRegister[]
): void {
  const registerOffset = baseOffset + register.offset;
  const count = register.count ?? 1;
  const stride = register.stride ?? registerElementFootprintBytes(register);

  if (register.registers && register.registers.length > 0) {
    for (let index = 0; index < count; index += 1) {
      const childPrefix =
        count > 1 ? `${prefix}${register.name}_${index}_` : `${prefix}${register.name}_`;
      for (const child of register.registers) {
        expandRegister(child, registerOffset + index * stride, childPrefix, out);
      }
    }
    return;
  }

  for (let index = 0; index < count; index += 1) {
    out.push({
      addressOffset: registerOffset + index * stride,
      name: count > 1 ? `${prefix}${register.name}_${index}` : `${prefix}${register.name}`,
      register,
    });
  }
}

function memoryMapRangeBytes(memoryMap: NormalizedMemoryMap): number {
  return memoryMap.addressBlocks.reduce(
    (range, block) => Math.max(range, block.baseAddress + blockRangeBytes(block)),
    0
  );
}

function blockRangeBytes(block: NormalizedAddressBlock): number {
  const registerExtent = block.registers.reduce(
    (extent, register) => Math.max(extent, register.offset + registerFootprintBytes(register)),
    0
  );
  return Math.max(registerExtent, explicitRangeBytes(block));
}

function explicitRangeBytes(block: NormalizedAddressBlock): number {
  if (block.range === null || block.range === undefined) {
    return 0;
  }
  if (typeof block.range === 'number' && Number.isInteger(block.range) && block.range >= 0) {
    return block.range;
  }
  if (typeof block.range === 'string') {
    const match = block.range.trim().match(/^(\d+)\s*([kKmMgG])?$/);
    if (match) {
      const multiplier =
        match[2]?.toLowerCase() === 'k'
          ? 1024
          : match[2]?.toLowerCase() === 'm'
            ? 1024 * 1024
            : match[2]?.toLowerCase() === 'g'
              ? 1024 * 1024 * 1024
              : 1;
      return Number(match[1]) * multiplier;
    }
  }
  throw new Error(`memory map address block ${block.name} has an invalid range`);
}

function registerFootprintBytes(register: NormalizedRegister): number {
  const elementFootprint = registerElementFootprintBytes(register);
  const count = register.count ?? 1;
  const stride = register.stride ?? elementFootprint;
  return (count - 1) * stride + elementFootprint;
}

function registerElementFootprintBytes(register: NormalizedRegister): number {
  const nestedFootprint = (register.registers ?? []).reduce(
    (extent, child) => Math.max(extent, child.offset + registerFootprintBytes(child)),
    0
  );
  return Math.max(registerBytes(register), nestedFootprint);
}

function registerBytes(register: NormalizedRegister): number {
  return Math.max(1, Math.ceil(register.size / 8));
}

interface EffectiveField {
  readonly access: string;
  readonly mask: number;
  readonly readable: boolean;
  readonly resetValue: number;
  readonly safeForReadback: boolean;
  readonly skipCategory?: SkipCategory;
}

function effectiveFields(register: NormalizedRegister, busWidth: number): EffectiveField[] {
  const fields =
    register.fields.length > 0 ? register.fields : [wholeRegisterField(register, busWidth)];
  return fields.map((field) => effectiveField(field, register, busWidth));
}

function wholeRegisterField(register: NormalizedRegister, busWidth: number): NormalizedField {
  const width = Math.min(register.size, busWidth);
  return {
    rowId: register.rowId,
    name: register.name,
    bits: `[${width - 1}:0]`,
    offset: 0,
    width,
    access: register.access,
    resetValue: register.resetValue,
    description: register.description,
  };
}

function effectiveField(
  field: NormalizedField,
  register: NormalizedRegister,
  busWidth: number
): EffectiveField {
  const access = normalizeAccess(field.access ?? register.access);
  const category = fieldSkipCategory(access);
  return {
    access,
    mask: fieldMask(field, busWidth),
    readable: readableAccess.has(access),
    resetValue: field.resetValue,
    safeForReadback: safeReadbackAccess.has(access),
    ...(category ? { skipCategory: category } : {}),
  };
}

function normalizeAccess(access: string | undefined): string {
  return (access ?? 'read-write').toLowerCase().replace(/_/g, '-');
}

function fieldSkipCategory(access: string): SkipCategory | undefined {
  if (access === 'read-only' || access === 'ro') {
    return 'read-only';
  }
  if (access === 'write-1-to-clear' || access === 'read-write-1-to-clear') {
    return 'write-one-to-clear';
  }
  if (access.includes('self-clearing') || access.includes('side-effect')) {
    return 'side-effect';
  }
  if (access.includes('volatile')) {
    return 'volatile';
  }
  if (access === 'write-only' || access === 'wo') {
    return 'write-only';
  }
  return undefined;
}

function fieldMask(field: NormalizedField, busWidth: number): number {
  const width = Math.max(0, Math.min(field.width, busWidth - field.offset));
  if (width === 0 || field.offset < 0) {
    return 0;
  }
  return (widthMask(width) << field.offset) >>> 0;
}

function composeResetValue(
  register: NormalizedRegister,
  fields: ReadonlyArray<EffectiveField>,
  busMask: number
): number {
  if (register.resetValue !== 0 || register.fields.length === 0) {
    return (register.resetValue & busMask) >>> 0;
  }
  return fields.reduce(
    (value, field) =>
      ((value & ~field.mask) | ((field.resetValue << trailingBit(field.mask)) & field.mask)) >>> 0,
    0
  );
}

function trailingBit(mask: number): number {
  if (mask === 0) {
    return 0;
  }
  return 31 - Math.clz32(mask & -mask);
}

function skipReason(fields: ReadonlyArray<EffectiveField>): string | undefined {
  const categories: SkipCategory[] = [
    'read-only',
    'write-one-to-clear',
    'side-effect',
    'volatile',
    'write-only',
  ];
  const skipped = categories.filter((category) =>
    fields.some((field) => field.skipCategory === category && field.mask !== 0)
  );
  if (skipped.length === 0) {
    return undefined;
  }
  const description =
    skipped.length === 1
      ? skipped[0]
      : `${skipped.slice(0, -1).join(', ')}, and ${skipped[skipped.length - 1]}`;
  return `write/readback excludes ${description} fields`;
}

function vector(
  kind: VerificationVector['kind'],
  register: NormalizedRegister,
  expectedValue: number,
  compareMask: number,
  writeValue: number | undefined,
  skippedReason: string | undefined
): VerificationVector {
  return {
    kind,
    address: register.offset,
    expectedValue,
    compareMask,
    ...(writeValue === undefined ? {} : { writeValue }),
    registerName: register.name,
    ...(skippedReason ? { skippedReason } : {}),
  };
}

function walkingOneValues(mask: number): number[] {
  const values: number[] = [];
  for (let bit = 0; bit < 32; bit += 1) {
    const value = 2 ** bit;
    if ((mask & value) !== 0) {
      values.push(value >>> 0);
    }
  }
  return values;
}

function busWidthBits(busBytes: number): number {
  if (!Number.isInteger(busBytes) || busBytes <= 0 || busBytes > 4) {
    throw new Error(`AXI4-Lite busBytes ${busBytes} must be an integer from 1 through 4`);
  }
  return busBytes * 8;
}

function widthMask(width: number): number {
  if (width >= 32) {
    return 0xffffffff;
  }
  return 2 ** width - 1;
}
