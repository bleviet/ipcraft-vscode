// Run in the devtools console of a live IPCraft webview (open a .mm.yml or
// .ip.yml file in the Extension Development Host, then Help > Toggle
// Developer Tools with focus in the webview) to produce a pixel-exact
// replacement for dark.css / light.css.
//
// VS Code injects every --vscode-* value as inline style on
// document.documentElement, so reading it back is a literal dump, not a
// reconstruction.
//
// Usage: paste into the console, press enter, then paste into the target
// .css file (it copies the result to the clipboard).
copy(
  ':root {\n' +
    Array.from(document.documentElement.style)
      .filter((name) => name.startsWith('--vscode-'))
      .map((name) => `  ${name}: ${document.documentElement.style.getPropertyValue(name)};`)
      .join('\n') +
    '\n}\n'
);
