import type { SystemGraph } from '../../domain/systemGraph';
import { readBdTcl } from '../../parser/system/BdTclReader';
import { readQsys } from '../../parser/system/QsysReader';
import { isSystemDesignScript } from './systemDesignDetection';

/** Reads a recognized system design file into a graph; undefined when it is not one. */
export function readSystemDesign(
  filePath: string,
  displayName: string,
  text: string
): SystemGraph | undefined {
  if (!isSystemDesignScript(filePath, text)) {
    return undefined;
  }
  return filePath.endsWith('.qsys') ? readQsys(text, displayName) : readBdTcl(text, displayName);
}
