import fs from 'fs'
import path from 'path'

const FIXTURES = path.resolve('tests/fixtures/kriit')

const fileScenario = (name, status = 200) => () => ({
  status,
  body: fs.readFileSync(path.join(FIXTURES, name), 'utf8'),
  contentType: 'application/json'
})

const SCENARIOS = {
  empty: fileScenario('getDifferences-empty.json'),
  diffs: fileScenario('getDifferences-with-diffs.json'),
  newAssignments: fileScenario('getDifferences-with-new-assignments.json'),
  diffsAndNew: fileScenario('getDifferences-with-diffs-and-new.json'),
  xss: fileScenario('getDifferences-with-xss.json'),
  gradeXss: fileScenario('getDifferences-grade-xss.json'),
  bareArray: () => ({ status: 200, body: '[]', contentType: 'application/json' }),
  ok: () => ({ status: 200, body: '{"success":true}', contentType: 'application/json' }),
  500: () => ({ status: 500, body: '{"error":"server"}', contentType: 'application/json' }),
  'invalid-json': () => ({ status: 200, body: '<html>not json</html>', contentType: 'text/html' })
}

const DEFAULT_PER_ENDPOINT = {
  '/api/subjects/getDifferences': 'empty',
  '/api/assignments/setAssignmentExternalId': 'ok',
  '/api/outcomes/sync': 'ok'
}

/**
 * Start a local HTTP server that mocks Kriit endpoints. The extension proxies
 * Kriit requests through its background SW (ApiService.js:412 →
 * background.js:160), and page.route() does NOT intercept SW fetches.
 *
 * @returns {Promise<{
 *   origin: string,
 *   setResponse: (scenario: string) => void,         // sets default for ALL endpoints
 *   setEndpointResponse: (endpoint: string, scenario: string) => void,
 *   requestLog: Array<{method: string, path: string, body: string}>,
 *   stop: () => void
 * }>}
 */
export async function startKriitServer() {
  const perEndpoint = { ...DEFAULT_PER_ENDPOINT }
  let defaultScenario = 'empty'
  const requestLog = []

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
    'Access-Control-Max-Age': '86400'
  }

  const server = Bun.serve({
    port: 0,
    fetch: async req => {
      const url = new URL(req.url)

      // CORS preflight — must succeed before browser sends actual request
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      let body = ''
      try {
        body = req.method !== 'GET' ? await req.text() : ''
      } catch { /* ignore */ }
      requestLog.push({ method: req.method, path: url.pathname, body })

      const scenarioName = perEndpoint[url.pathname] || defaultScenario
      const scenario = SCENARIOS[scenarioName]
      if (!scenario) return new Response('unknown scenario', { status: 500 })
      const r = scenario()
      return new Response(r.body, {
        status: r.status,
        headers: { 'Content-Type': r.contentType, ...corsHeaders }
      })
    }
  })

  return {
    // 'localhost' (not 127.0.0.1) so ApiService.js:405 routes through the
    // background SW (`urlString.includes('localhost')` gate). Without this,
    // content script does direct fetch and Chrome blocks mixed-content/cross-origin.
    origin: `http://localhost:${server.port}`,
    setResponse(scenario) {
      if (!SCENARIOS[scenario]) throw new Error(`unknown scenario: ${scenario}`)
      defaultScenario = scenario
      // Reset any per-endpoint overrides so default applies everywhere
      for (const k of Object.keys(perEndpoint)) perEndpoint[k] = scenario
    },
    setEndpointResponse(endpoint, scenario) {
      if (!SCENARIOS[scenario]) throw new Error(`unknown scenario: ${scenario}`)
      perEndpoint[endpoint] = scenario
    },
    requestLog,
    stop() {
      server.stop(true)
    }
  }
}
