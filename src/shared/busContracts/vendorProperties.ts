import { dataLaneKind } from './dataLanes';
import type { BusDefinitionContract } from './types';

export interface VendorContractMetadata {
  interfaceProperties?: Record<string, number | string | boolean>;
  endianness?: 'little' | 'big';
}

function parseVendorBoolean(raw: string, property: string, location: string): boolean {
  if (/^(?:1|true)$/i.test(raw)) {
    return true;
  }
  if (/^(?:0|false)$/i.test(raw)) {
    return false;
  }
  throw new Error(`${location} has invalid boolean value '${raw}' for ${property}.`);
}

function parseVendorInteger(raw: string, property: string, location: string): number {
  const numeric = raw.trim() === '' ? Number.NaN : Number(raw);
  if (Number.isSafeInteger(numeric)) {
    return numeric;
  }
  throw new Error(`${location} has invalid integer value '${raw}' for ${property}.`);
}

export function importVendorContractMetadata(input: {
  contract: Pick<BusDefinitionContract, 'interfaceProperties'>;
  rawProperties: ReadonlyMap<string, string>;
  mirroredProperties?: ReadonlyMap<string, string>;
  dataWidth?: number | string;
  location: string;
}): VendorContractMetadata {
  const { contract, rawProperties, mirroredProperties, dataWidth, location } = input;
  const isSymbolLane = dataLaneKind(contract) === 'symbol';
  const currentSymbolWidthRaw = isSymbolLane ? rawProperties.get('dataBitsPerSymbol') : undefined;
  const legacySymbolWidthRaw = isSymbolLane ? rawProperties.get('bitsPerSymbol') : undefined;
  const currentSymbolWidth =
    currentSymbolWidthRaw === undefined
      ? undefined
      : parseVendorInteger(
          currentSymbolWidthRaw,
          'dataBitsPerSymbol',
          `${location}.parameters.dataBitsPerSymbol`
        );
  const legacySymbolWidth =
    legacySymbolWidthRaw === undefined
      ? undefined
      : parseVendorInteger(
          legacySymbolWidthRaw,
          'bitsPerSymbol',
          `${location}.parameters.bitsPerSymbol`
        );
  if (
    currentSymbolWidth !== undefined &&
    legacySymbolWidth !== undefined &&
    currentSymbolWidth !== legacySymbolWidth
  ) {
    throw new Error(
      `${location} declares conflicting dataBitsPerSymbol ` +
        `('${currentSymbolWidthRaw}') and bitsPerSymbol ('${legacySymbolWidthRaw}').`
    );
  }

  for (const name of mirroredProperties?.keys() ?? []) {
    if (name !== 'endianness' && !contract.interfaceProperties[name]) {
      throw new Error(`${location}.mirror.${name} is not declared by the bus contract.`);
    }
  }

  const parseProperty = (
    raw: string,
    name: string,
    valueLocation: string
  ): number | string | boolean => {
    const declaration = contract.interfaceProperties[name];
    if (declaration.type === 'integer') {
      return parseVendorInteger(raw, name, valueLocation);
    }
    if (declaration.type === 'boolean') {
      return parseVendorBoolean(raw, name, valueLocation);
    }
    return raw;
  };

  const standardProperties: Record<string, number | string | boolean> = {};
  for (const name of Object.keys(contract.interfaceProperties)) {
    const raw =
      name === 'dataBitsPerSymbol'
        ? (currentSymbolWidthRaw ?? legacySymbolWidthRaw)
        : rawProperties.get(name);
    if (raw === undefined) {
      continue;
    }
    const standardLocation = `${location}.parameters.${name}`;
    standardProperties[name] = parseProperty(raw, name, standardLocation);
    const mirroredRaw = mirroredProperties?.get(name);
    if (mirroredRaw !== undefined) {
      const mirrored = parseProperty(mirroredRaw, name, `${location}.mirror.${name}`);
      if (standardProperties[name] !== mirrored) {
        throw new Error(
          `${location}.${name}: standard value '${raw}' conflicts with IPCraft mirror '${mirroredRaw}'`
        );
      }
    }
  }

  const interfaceProperties: Record<string, number | string | boolean> = {};
  if (mirroredProperties) {
    for (const name of Object.keys(contract.interfaceProperties)) {
      const raw = mirroredProperties.get(name);
      if (raw !== undefined) {
        interfaceProperties[name] = parseProperty(raw, name, `${location}.mirror.${name}`);
      }
    }
  } else {
    Object.assign(interfaceProperties, standardProperties);
  }

  if (
    !mirroredProperties &&
    isSymbolLane &&
    interfaceProperties.symbolsPerBeat === undefined &&
    typeof interfaceProperties.dataBitsPerSymbol === 'number' &&
    typeof dataWidth === 'number' &&
    dataWidth % interfaceProperties.dataBitsPerSymbol === 0
  ) {
    interfaceProperties.symbolsPerBeat = dataWidth / interfaceProperties.dataBitsPerSymbol;
  }

  const ordering = isSymbolLane ? rawProperties.get('firstSymbolInHighOrderBits') : undefined;
  const standardEndianness =
    ordering === undefined
      ? undefined
      : parseVendorBoolean(
            ordering,
            'firstSymbolInHighOrderBits',
            `${location}.parameters.firstSymbolInHighOrderBits`
          )
        ? 'big'
        : 'little';
  const mirroredEndianness = mirroredProperties?.get('endianness');
  if (
    mirroredEndianness !== undefined &&
    mirroredEndianness !== 'big' &&
    mirroredEndianness !== 'little'
  ) {
    throw new Error(
      `${location}.mirror.endianness has invalid value '${mirroredEndianness}'; expected 'big' or 'little'.`
    );
  }
  if (
    standardEndianness !== undefined &&
    mirroredEndianness !== undefined &&
    standardEndianness !== mirroredEndianness
  ) {
    throw new Error(
      `${location}.endianness: standard value '${standardEndianness}' conflicts with IPCraft mirror '${mirroredEndianness}'`
    );
  }
  const endianness = mirroredProperties ? mirroredEndianness : standardEndianness;
  return {
    ...(Object.keys(interfaceProperties).length > 0 ? { interfaceProperties } : {}),
    ...(endianness !== undefined ? { endianness } : {}),
  };
}
