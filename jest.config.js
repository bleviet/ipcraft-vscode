/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/src'],
    testMatch: [
        '**/__tests__/**/*.ts?(x)',
        '**/?(*.)+(spec|test).ts?(x)'
    ],
    moduleNameMapper: {
        // Mock CSS imports
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
        '^vscode$': '<rootDir>/__mocks__/vscode.ts',
        // Path aliases
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@webview/(.*)$': '<rootDir>/src/webview/$1',
        '^@services/(.*)$': '<rootDir>/src/services/$1',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    },
    // Collect coverage from all TypeScript files
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/test/**',
        '!src/**/__tests__/**',
    ],
    // Coverage thresholds — set to measured post-implementation baselines minus 2% margin
    // Measured: statements 27.64%, branches 20.25%, functions 21.98%, lines 27.83%
    coverageThreshold: {
        global: {
            branches: 18,
            functions: 19,
            lines: 25,
            statements: 25,
        },
    },
    // Setup files
    setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
    // Transform settings
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                jsx: 'react',
                esModuleInterop: true,
            },
        }],
    },
    // Coverage output
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/out/',
        // e2e and browser tests are run by @vscode/test-electron and Playwright respectively
        '/src/test/e2e/',
        '/src/test/browser/',
    ],
    // Module file extensions
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    // Verbose output
    verbose: true,
    // Clear mocks between tests
    clearMocks: true,
    // Reset mocks between tests
    resetMocks: true,
};
