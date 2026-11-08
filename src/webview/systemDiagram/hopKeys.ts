/** Keyboard mapping of the isolated view's hop stepper. */

interface KeyModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * `+` and `=` (the unshifted plus on US layouts) step the radius up, `-` steps
 * it down; any Ctrl, Meta or Alt chord is left to the browser and VS Code.
 */
export function hopStepOfKey(key: string, modifiers: KeyModifiers): 1 | -1 | undefined {
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) {
    return undefined;
  }
  if (key === '+' || key === '=') {
    return 1;
  }
  return key === '-' ? -1 : undefined;
}
