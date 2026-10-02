import type { NormalizedBusLibrary } from '../../../../../../shared/busContracts';
import { isConduitType } from '../../../../utils/busLibrary';

export function conduitTypeName(
  busType: string,
  busLibrary: NormalizedBusLibrary | undefined
): string {
  if (isConduitType(busType, busLibrary)) {
    return '';
  }
  if (!busType.startsWith('user:busif:')) {
    return busType;
  }
  const parts = busType.split(':');
  return parts.length >= 3 ? parts[2] : '';
}

export function buildConduitType(name: string): string {
  const safe =
    name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '') || 'custom';
  return `user:busif:${safe}:1.0`;
}
