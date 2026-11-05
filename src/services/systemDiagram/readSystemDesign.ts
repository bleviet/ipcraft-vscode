import type { SystemGraph } from '../../domain/systemGraph';
import { readBdTcl } from '../../parser/system/BdTclReader';
import { readQsys } from '../../parser/system/QsysReader';
import { readQsysTcl } from '../../parser/system/QsysTclReader';
import { BD_TCL_PATTERN, isSystemDesignScript } from './systemDesignDetection';

/** Reads a recognized system design file into a graph; undefined when it is not one. */
export function readSystemDesign(
  filePath: string,
  displayName: string,
  text: string
): SystemGraph | undefined {
  if (!isSystemDesignScript(filePath, text)) {
    return undefined;
  }
  if (filePath.endsWith('.qsys')) {
    return readQsys(text, displayName);
  }
  return BD_TCL_PATTERN.test(text) ? readBdTcl(text, displayName) : readQsysTcl(text, displayName);
}
