import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // E2E pipeline tests require network and run only via vitest.e2e.config.ts.
    exclude: ['node_modules', 'out', 'dist', 'tests/e2e/**', 'tests/gui/**']
  }
})
