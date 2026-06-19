import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  retries: 0,
  // Each spec launches its own Electron instance. Serialize so only one app
  // window is open at a time (avoids two windows + resource contention).
  workers: 1,
  fullyParallel: false,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
})
