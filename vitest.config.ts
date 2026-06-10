import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Print a summary in the terminal, plus machine-readable reports for CI.
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // public API re-exports, no logic
        'src/cli/**', // CLI entrypoint, exercised end-to-end via cli.test.ts
        'src/types.ts', // type-only declarations
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
