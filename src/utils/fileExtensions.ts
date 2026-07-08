export const FILE_EXT_IP_YML = '.ip.yml';
export const FILE_EXT_IP_YAML = '.ip.yaml';
export const FILE_EXT_MM_YML = '.mm.yml';

export function isIpCoreFile(fsPath: string): boolean {
  return fsPath.endsWith(FILE_EXT_IP_YML) || fsPath.endsWith(FILE_EXT_IP_YAML);
}

export function isMmFile(fsPath: string): boolean {
  return fsPath.endsWith(FILE_EXT_MM_YML);
}
