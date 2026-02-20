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
    // Coverage thresholds
    coverageThreshold: {
        global: {
            branches: 8,
            functions: 11,
            lines: 14,
            statements: 14,
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
