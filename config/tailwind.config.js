const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [path.resolve(__dirname, '../src/webview/**/*.{ts,tsx}')],
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--vscode-font-family)', 'sans-serif'],
                mono: ['var(--vscode-editor-font-family)', 'monospace'],
            },
        },
    },
    plugins: [],
};
