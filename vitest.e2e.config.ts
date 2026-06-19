import { defineConfig } from 'vitest/config'

// Network-dependent end-to-end pipeline tests (real CNTV API + decrypt + merge).
// Run with: npm run test:e2e
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000
  }
})
