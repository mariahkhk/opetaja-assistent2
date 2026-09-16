import { chromium, test as base } from '@playwright/test'
import os from 'os'
import path from 'path'
import fs from 'fs'

const EXTENSION_PATH = path.resolve('dist')

// One persistent Chrome+extension instance per Playwright worker.
// Reusing the same userDataDir across tests in a worker means:
//   - Chrome boot cost (~3-5s on WSL2) is paid once per worker, not per test
//   - Extension service worker stays warm (no MV3 cold-boot per test)
//   - Content script registration is already done
// Tests get an isolated `page` (closed in afterEach) but share the underlying
// browser. Chrome storage is cleared per-test by the caller (cleanState helper).
const sharedContexts = new Map() // workerIndex → { context, extensionId, serviceWorker }

/** Own shared persistent browsers explicitly so Playwright can finish worker teardown. */
export const test = base.extend({
  extensionLifetime: [async({}, use) => {
    try { await use() } finally {
      for (const info of sharedContexts.values()) {
        await info.dispose()
        fs.rmSync(info.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
      sharedContexts.clear()
    }
  }, { scope: 'worker', auto: true }]
})

function getWorkerIndex() {
  // Playwright sets TEST_PARALLEL_INDEX (workers run in separate processes).
  return Number(process.env.TEST_PARALLEL_INDEX || 0)
}

async function createContext() {
  // Per-worker temp dir under OS temp. Reused as long as the worker process
  // lives. Playwright cleans up worker processes between runs; if a stale
  // dir lingers, Chrome handles it via its own lock.
  const userDataDir = path.join(os.tmpdir(), `oa2-e2e-worker-${getWorkerIndex()}-${process.pid}`)
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  })

  let [serviceWorker] = context.serviceWorkers()
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')
  const extensionId = serviceWorker.url().split('/')[2]

  // Page routes mock Tahvel in the existing suites, but do not cover worker fetches.
  // Never let incidental scheduler refreshes hit real Tahvel or outlive a test.
  await context.route('https://*.ee/hois_back/**', async route => {
    if (route.request().serviceWorker()) await route.fulfill({ json: {} })
    else await route.fallback()
  })
  return { context, extensionId, serviceWorker, userDataDir, dispose: context.close.bind(context) }
}

/**
 * Get the shared per-worker browser context with the extension loaded.
 * `context.close()` is monkey-patched to close pages + clear storage but
 * NOT actually tear down the browser, so tests can continue to call it
 * exactly as before — but the underlying Chrome instance is reused across
 * tests in this worker.
 *
 * @returns {Promise<{ context, extensionId, serviceWorker }>}
 */
export async function launchWithExtension() {
  const idx = getWorkerIndex()
  if (sharedContexts.has(idx)) {
    // Reuse existing context — clear state to provide test isolation.
    const info = sharedContexts.get(idx)
    await closeAllPagesExcept(info.context, null)
    await clearExtensionStorage(info.serviceWorker)
    return info
  }
  const info = await createContext()
  // Monkey-patch close to be no-op-with-cleanup. Tests use
  // `await context.close()` in afterEach; that pattern keeps working but
  // doesn't pay the chromium boot cost again.
  info.context.close = async() => {
    await closeAllPagesExcept(info.context, null)
    await clearExtensionStorage(info.serviceWorker)
  }
  sharedContexts.set(idx, info)
  return info
}

/**
 * Close every page in the shared context except the about:blank one Chrome
 * keeps open. Call this in test.afterEach to release page resources without
 * tearing down the whole browser.
 */
export async function closeAllPagesExcept(context, keepPage = null) {
  const pages = context.pages()
  await Promise.all(
    pages
      .filter(p => p !== keepPage && !p.isClosed())
      .map(p => p.close().catch(() => { /* ignore */ }))
  )
}

/**
 * Wipe extension chrome.storage.local between tests so settings from one test
 * (e.g. enableKriit) don't leak into another. Runs in the extension's
 * service worker context where chrome.storage is available.
 */
export async function clearExtensionStorage(serviceWorker) {
  await serviceWorker.evaluate(async() => {
    for (const alarm of await chrome.alarms.getAll()) {
      if (alarm.name.startsWith('oa2-lesson:') || alarm.name.startsWith('oa2-lesson-email:')) await chrome.alarms.clear(alarm.name)
    }
    await chrome.storage.session.clear()
    await new Promise(resolve => chrome.storage.local.clear(resolve))
    // Match a fresh install: unrelated feature tests must not be covered by
    // the update modal just because their settings were reset between tests.
    await chrome.storage.local.set({ OA_updateBannerDismissed: chrome.runtime.getManifest().version })
  })
}
