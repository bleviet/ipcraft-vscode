// node-diff3 ships types only through its package.json "exports" map, which the
// project's node10 module resolution (module: commonjs) does not read. Declare the
// one function used here; the runtime resolves to the package's CJS build.
// Delete this file if moduleResolution moves to node16/bundler, otherwise it shadows
// the real package types.
declare module 'node-diff3' {
  export interface MergeResult {
    conflict: boolean;
    result: string[];
  }
  export function merge(
    a: string[],
    o: string[],
    b: string[],
    options?: { excludeFalseConflicts?: boolean }
  ): MergeResult;
}
