import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.js$/,
  fullyParallel: true,
  workers: 8,
  retries: 1,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.js',
  use: {
    trace: 'retain-on-failure'
  }
})
