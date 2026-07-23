import { isConduitType } from '../../../../data/busDefinitions';

export function conduitTypeName(busType: string): string {
  if (isConduitType(busType)) {
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
