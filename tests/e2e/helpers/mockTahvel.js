import fs from 'fs'
import path from 'path'

const FIXTURES_API = path.resolve('tests/fixtures/tahvel/api')
const FIXTURES_PAGES = path.resolve('tests/fixtures/tahvel/pages')

// Preload ALL fixtures into memory at module init. Each E2E test causes
// hundreds of API mock lookups (extension fetches ~150 journals × ~3
// endpoints = ~450 requests per test). Per-request disk I/O was the
// dominant cost (~10ms × 450 = ~4-5s of pure overhead per slow test).
// One-time disk read at startup eliminates that.
const apiFixtures = new Map() // filename → body string
const pageFixtures = new Map()
if (fs.existsSync(FIXTURES_API)) {
  for (const f of fs.readdirSync(FIXTURES_API)) {
    apiFixtures.set(f, fs.readFileSync(path.join(FIXTURES_API, f), 'utf8'))
  }
}
if (fs.existsSync(FIXTURES_PAGES)) {
  for (const f of fs.readdirSync(FIXTURES_PAGES)) {
    pageFixtures.set(f, fs.readFileSync(path.join(FIXTURES_PAGES, f), 'utf8'))
  }
}

// Mirrors the safeName used by the capture script (now in git history).
function safeName(s) {
  return s.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'root'
}

function apiUrlToFixtureName(url) {
  const endpoint = url.pathname + url.search // e.g. /hois_back/journals?...
  const stripped = endpoint.replace(/^\/hois_back\//, '')
  return `${safeName(stripped)}.json`
}

// Try to find a fixture by:
//   1. exact safeName match (already tried by caller)
//   2. same path with query params sorted alphabetically
//   3. fixture whose filename starts with the same path prefix and contains
//      all the same query keys (order-independent)
function findFixtureFlexibly(url) {
  const stripped = (url.pathname + url.search).replace(/^\/hois_back\//, '')
  const [pathPart, queryPart] = stripped.split('?')
  const pathSafe = safeName(pathPart)

  if (!queryPart) return null

  // 2. Sorted query
  const params = [...new URLSearchParams(queryPart).entries()].sort(([a], [b]) => a.localeCompare(b))
  const sortedQuery = params.map(([k, v]) => `${k}=${v}`).join('&')
  const sortedName = `${safeName(`${pathPart}?${sortedQuery}`)}.json`
  if (apiFixtures.has(sortedName)) return sortedName

  // 3. Prefix + all-keys match
  const wantKeys = params.map(([k]) => k)
  for (const name of apiFixtures.keys()) {
    if (!(name.startsWith(pathSafe + '_') || name === pathSafe + '.json')) continue
    if (wantKeys.every(k => name.includes(`_${k}_`) || name.includes(`?${k}=`))) return name
  }
  return null
}

function routeToPageFixtureName(route) {
  return `${safeName(route)}.html`
}

/**
 * Install fixture-backed mocks on a Playwright page so extension content
 * scripts run against captured Tahvel responses with no live network.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pageRoute - SPA route the test loads (e.g. '/#/journals')
 *   Used to pick the HTML fixture.
 * @param {object} [opts]
 * @param {boolean} [opts.warnOnMissing=true] - log unmocked /hois_back hits
 * @returns {{ unmockedApi: string[] }} side-channel for assertions
 */
export async function mockTahvel(page, pageRoute, opts = {}) {
  const { warnOnMissing = false } = opts
  const pageFixtureName = routeToPageFixtureName(pageRoute)
  const html = pageFixtures.get(pageFixtureName)
  if (!html) throw new Error(`No HTML fixture for ${pageRoute}: ${pageFixtureName}`)
  const unmockedApi = []

  await page.route(/(tahvel\.edu\.ee|test\.tahvel\.eenet\.ee)/, async route => {
    const url = new URL(route.request().url())

    if (url.pathname.startsWith('/hois_back/')) {
      const exact = apiUrlToFixtureName(url)
      let body = apiFixtures.get(exact)
      if (!body) {
        const flex = findFixtureFlexibly(url)
        if (flex) body = apiFixtures.get(flex)
      }
      if (body) {
        return route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      unmockedApi.push(url.pathname + url.search)
      if (warnOnMissing) console.warn(`[mockTahvel] no fixture: ${url.pathname}${url.search}`)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }

    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  })

  return { unmockedApi }
}
