/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/webview/**/*.{ts,tsx}'],
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
