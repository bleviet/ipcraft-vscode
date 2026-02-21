export const ROOT_ID = 'root';

export type ParsedOutlineId =
  | { kind: 'root' }
  | { kind: 'block'; blockIndex: number }
  | { kind: 'register'; blockIndex: number; registerIndex: number }
  | { kind: 'registerArray'; blockIndex: number; arrayIndex: number }
  | { kind: 'arrayRegister'; blockIndex: number; registerIndex: number }
  | { kind: 'arrayElement'; blockIndex: number; registerIndex: number; elementIndex: number }
  | {
      kind: 'arrayElementRegister';
      blockIndex: number;
      registerIndex: number;
      elementIndex: number;
      childIndex: number;
    }
  | { kind: 'unknown' };

export const blockId = (blockIndex: number): string => `block-${blockIndex}`;
export const registerId = (blockIndex: number, registerIndex: number): string =>
  `block-${blockIndex}-reg-${registerIndex}`;
export const registerArrayId = (blockIndex: number, arrayIndex: number): string =>
  `block-${blockIndex}-arr-${arrayIndex}`;
export const arrayRegisterId = (blockIndex: number, registerIndex: number): string =>
  `block-${blockIndex}-arrreg-${registerIndex}`;
export const arrayElementId = (
  blockIndex: number,
  registerIndex: number,
  elementIndex: number
): string => `block-${blockIndex}-arrreg-${registerIndex}-el-${elementIndex}`;
export const arrayElementRegisterId = (
  blockIndex: number,
  registerIndex: number,
  elementIndex: number,
  childIndex: number
): string => `${arrayElementId(blockIndex, registerIndex, elementIndex)}-reg-${childIndex}`;

export function parseOutlineId(id: string): ParsedOutlineId {
  if (id === ROOT_ID) {
    return { kind: 'root' };
  }

  let match = id.match(/^block-(\d+)-arrreg-(\d+)-el-(\d+)-reg-(\d+)$/);
  if (match) {
    return {
      kind: 'arrayElementRegister',
      blockIndex: Number.parseInt(match[1], 10),
      registerIndex: Number.parseInt(match[2], 10),
      elementIndex: Number.parseInt(match[3], 10),
      childIndex: Number.parseInt(match[4], 10),
    };
  }

  match = id.match(/^block-(\d+)-arrreg-(\d+)-el-(\d+)$/);
  if (match) {
    return {
      kind: 'arrayElement',
      blockIndex: Number.parseInt(match[1], 10),
      registerIndex: Number.parseInt(match[2], 10),
      elementIndex: Number.parseInt(match[3], 10),
    };
  }

  match = id.match(/^block-(\d+)-arrreg-(\d+)$/);
  if (match) {
    return {
      kind: 'arrayRegister',
      blockIndex: Number.parseInt(match[1], 10),
      registerIndex: Number.parseInt(match[2], 10),
    };
  }

  match = id.match(/^block-(\d+)-arr-(\d+)$/);
  if (match) {
    return {
      kind: 'registerArray',
      blockIndex: Number.parseInt(match[1], 10),
      arrayIndex: Number.parseInt(match[2], 10),
    };
  }

  match = id.match(/^block-(\d+)-reg-(\d+)$/);
  if (match) {
    return {
      kind: 'register',
      blockIndex: Number.parseInt(match[1], 10),
      registerIndex: Number.parseInt(match[2], 10),
    };
  }

  match = id.match(/^block-(\d+)$/);
  if (match) {
    return { kind: 'block', blockIndex: Number.parseInt(match[1], 10) };
  }

  return { kind: 'unknown' };
}
