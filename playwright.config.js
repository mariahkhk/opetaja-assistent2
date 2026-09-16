import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.js$/,
  fullyParallel: true,
  // Each worker runs a persistent extension browser and hundreds of fixture requests.
  // Eight concurrent browsers starve sync tests on Windows, especially after bun test.
  // Keep all tests/assertions; limit contention rather than extending their timeouts.
  workers: process.env.OA_E2E_WORKERS ? Number(process.env.OA_E2E_WORKERS) : 4,
  retries: 1,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.js',
  use: {
    trace: 'retain-on-failure'
  }
})
