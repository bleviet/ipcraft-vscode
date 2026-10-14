/**
 * Display text for `$version` references in the Memory Map editor: the resolved-value hint shown
 * under a token, and the user-facing messages for rejected token input. Pure.
 */
import {
  resolveVersionRefInContext,
  type VersionContext,
} from '../../../shared/versioning/versionContext';
import { schemeComponents, type VersionRef } from '../../../shared/versioning/versionScheme';

export const VERSION_REF_IN_DEBUG_MODE_ERROR = 'Version references cannot be set in Debug Mode';

const GENERIC_UNKNOWN_REF_ERROR =
  'Unknown version reference. Use $version, $version.<component>, $version.crc8 or $version.crc16';

/** `0x` hex of `value`, zero-padded to the digits `bitWidth` bits need (8 bit -> `0x01`). */
export function formatResolvedHex(value: number, bitWidth: number): string {
  const digits = Math.max(1, Math.ceil(bitWidth / 4));
  return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
}

/**
 * The error for text starting with `$` that is not a valid reference. With a resolved scheme it
 * lists that scheme's references (a `free` version only has the CRC references), otherwise it
 * names the general form.
 */
export function unknownVersionRefError(ctx: VersionContext): string {
  if (ctx.status !== 'resolved' || ctx.versionScheme === undefined) {
    return GENERIC_UNKNOWN_REF_ERROR;
  }
  const components = schemeComponents(ctx.versionScheme);
  const refs = [
    ...(components.length > 0 ? ['$version', ...components.map((name) => `$version.${name}`)] : []),
    '$version.crc8',
    '$version.crc16',
  ];
  const last = refs[refs.length - 1];
  return `Use ${refs.slice(0, -1).join(', ')} or ${last}`;
}

/**
 * The muted hint under a token: its resolved value, or why there is none. Null when the context
 * is resolved but the reference does not exist in the scheme (the diagnostics say why).
 */
export function versionRefHint(
  ctx: VersionContext,
  ref: VersionRef,
  bitWidth: number
): string | null {
  if (ctx.status === 'none') {
    return 'version unresolved';
  }
  if (ctx.status === 'ambiguous') {
    return 'several IP cores import this map';
  }
  const value = resolveVersionRefInContext(ctx, ref);
  return value === null ? null : `= ${formatResolvedHex(value, bitWidth)}`;
}
