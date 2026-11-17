import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { initializeGitHubSettings, initializeGradeSource, tokenOwners } from '../../src/popup/GitHubSettings.js'

const template = readFileSync(new URL('../../src/assets/templates/popup.html', import.meta.url), 'utf8')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let doc
let storage
let original

function installChrome() {
  const pick = keys => {
    if (keys == null) return { ...storage }
    const list = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(list.filter(k => k in storage).map(k => [k, storage[k]]))
  }
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(pick(keys)),
        set: (obj, cb) => { Object.assign(storage, obj); cb() },
        remove: (key, cb) => { delete storage[key]; cb() }
      }
    }
  }
}

/** Fake GitHub /user/repos: pages of { name, owner } plus an optional expiry header */
function githubFetch(pages, { status = 200, expiry = null } = {}) {
  const urls = []
  const fn = async url => {
    urls.push(url)
    const page = Number(new URL(url).searchParams.get('page'))
    return {
      status,
      ok: status === 200,
      json: async() => pages[page - 1] || [],
      headers: { get: name => (name === 'github-authentication-token-expiration' ? expiry : null) }
    }
  }
  fn.urls = urls
  return fn
}
const repo = (owner, name = 'x') => ({ name, owner: { login: owner } })
const shown = el => el.style.display !== 'none'

beforeEach(() => {
  doc = new JSDOM(template).window.document
  original = { chrome: global.chrome, fetch: global.fetch }
  storage = {}
  installChrome()
})

afterEach(() => {
  global.chrome = original.chrome
  global.fetch = original.fetch
})

describe('tokenOwners', () => {
  test('prefers owners that have a classroom50 repo and reads the expiry date', async() => {
    const fetchFn = githubFetch([[repo('maria'), repo('hkhk-automation', 'classroom50'), repo('hkhk-monitoring', 'classroom50')]], {
      expiry: '2026-12-31 10:00:00 UTC'
    })
    const r = await tokenOwners('tok', fetchFn)
    expect(r.owners).toEqual(['hkhk-automation', 'hkhk-monitoring'])
    expect(r.noClassroom50).toBe(false)
    expect(r.expires).toBe('2026-12-31T10:00:00.000Z')
  })

  test('without classroom50 all owners are returned and flagged', async() => {
    const r = await tokenOwners('tok', githubFetch([[repo('b'), repo('a'), repo('a')]]))
    expect(r).toMatchObject({ owners: ['a', 'b'], noClassroom50: true, expires: null })
  })

  test('reads every page until a short one', async() => {
    const full = Array.from({ length: 100 }, () => repo('maria'))
    const fetchFn = githubFetch([full, [repo('hkhk-automation', 'classroom50')]])
    const r = await tokenOwners('tok', fetchFn)
    expect(fetchFn.urls).toHaveLength(2)
    expect(r.owners).toEqual(['hkhk-automation'])
  })

  test('a wrong or expired token gives a readable error', async() => {
    expect(await tokenOwners('tok', githubFetch([], { status: 401 }))).toEqual({ error: 'Token ei kehti (vale või aegunud).', owners: [] })
    expect((await tokenOwners('tok', githubFetch([], { status: 500 }))).error).toBe('GitHub vastas 500.')
  })
})

describe('Hinnete allikas selector', () => {
  const kriitGroup = () => doc.getElementById('kriit-group')
  const githubGroup = () => doc.getElementById('github-group')
  const select = () => doc.getElementById('grade-source')
  const choose = async value => {
    select().value = value
    select().dispatchEvent(new doc.defaultView.Event('change'))
    await flush()
  }

  test('a new install starts with GitHub and hides Kriit', async() => {
    await initializeGradeSource(doc)
    expect(select().value).toBe('github')
    expect(shown(kriitGroup())).toBe(false)
    expect(shown(githubGroup())).toBe(true)
  })

  test('an existing Kriit user keeps Kriit after the update', async() => {
    storage.OA_kriitEnabled = true
    await initializeGradeSource(doc)
    expect(select().value).toBe('kriit')
    expect(shown(kriitGroup())).toBe(true)
    expect(shown(doc.getElementById('kriit-settings-container'))).toBe(true)
    expect(shown(githubGroup())).toBe(false)
  })

  test('the old on/off switches are hidden; the selector replaces them', async() => {
    await initializeGradeSource(doc)
    expect(shown(kriitGroup().querySelector('.toggle-container'))).toBe(false)
    expect(shown(githubGroup().querySelector('.toggle-container'))).toBe(false)
  })

  test('choosing Kriit switches GitHub off in storage, and back', async() => {
    await initializeGradeSource(doc)
    await choose('kriit')
    expect(storage).toMatchObject({ OA_gradeSource: 'kriit', OA_kriitEnabled: true, OA_ghEnabled: false })
    expect(shown(kriitGroup())).toBe(true)
    expect(doc.getElementById('github-save-status').textContent).toBe('Värskenda Tahvli lehte.')

    await choose('github')
    expect(storage).toMatchObject({ OA_gradeSource: 'github', OA_kriitEnabled: false, OA_ghEnabled: true })
    expect(shown(kriitGroup())).toBe(false)
  })

  test('Classroom 50 uses the GitHub section with its own title and help text', async() => {
    await initializeGradeSource(doc)
    await choose('classroom50')
    expect(storage).toMatchObject({ OA_gradeSource: 'classroom50', OA_ghEnabled: true, OA_kriitEnabled: false })
    expect(doc.getElementById('github-group-title').textContent).toBe('Classroom 50 integratsioon')
    expect(doc.getElementById('github-group-help').textContent).toContain('"Classroom 50"')
  })

  test('Kriit-only e-mail hints are hidden for GitHub users', async() => {
    await initializeGradeSource(doc)
    const notes = [...doc.querySelectorAll('.lesson-email-note')]
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every(n => !shown(n))).toBe(true)
    await choose('kriit')
    expect(notes.every(shown)).toBe(true)
  })

  test('the add-on version is added next to the version only once', async() => {
    await initializeGradeSource(doc)
    await initializeGradeSource(doc)
    expect(doc.querySelector('.version').textContent.match(/GitHub lisa/g)).toHaveLength(1)
  })
})

describe('GitHub tokens in the popup', () => {
  const status = () => doc.getElementById('github-save-status')
  const save = async() => {
    doc.getElementById('save-github-settings').click()
    for (let i = 0; i < 10; i++) await flush()
  }

  test('without a saved token the form is open and the add button hidden', async() => {
    global.fetch = githubFetch([])
    await initializeGitHubSettings(doc)
    expect(shown(doc.getElementById('github-token-form'))).toBe(true)
    expect(shown(doc.getElementById('github-add-token'))).toBe(false)
  })

  test('an empty token is not saved', async() => {
    global.fetch = githubFetch([])
    await initializeGitHubSettings(doc)
    await save()
    expect(status().textContent).toBe('Kleebi token.')
    expect(Object.keys(storage).filter(k => k.startsWith('OA_ghToken_'))).toHaveLength(0)
  })

  test('a valid token is saved once per org it can see, and the form closes', async() => {
    global.fetch = githubFetch([[repo('hkhk-automation', 'classroom50'), repo('hkhk-monitoring', 'classroom50')]], { expiry: '2027-01-15 00:00:00 UTC' })
    await initializeGitHubSettings(doc)
    doc.getElementById('github-token').value = '  github_pat_abc  '
    await save()
    expect(storage['OA_ghToken_hkhk-automation']).toBe('github_pat_abc')
    expect(storage['OA_ghToken_hkhk-monitoring']).toBe('github_pat_abc')
    expect(storage['OA_ghTokenExp_hkhk-automation']).toBe('2027-01-15T00:00:00.000Z')
    expect(status().textContent).toBe('Salvestatud: hkhk-automation, hkhk-monitoring')
    expect(doc.getElementById('github-token').value).toBe('')
    expect(doc.getElementById('github-token-list').textContent).toContain('✓ hkhk-automation')
    expect(shown(doc.getElementById('github-token-form'))).toBe(false)
  })

  test('a rejected token shows GitHub\'s answer and saves nothing', async() => {
    global.fetch = githubFetch([], { status: 401 })
    await initializeGitHubSettings(doc)
    doc.getElementById('github-token').value = 'vale'
    await save()
    expect(status().textContent).toBe('Token ei kehti (vale või aegunud).')
    expect(Object.keys(storage).filter(k => k.startsWith('OA_ghToken_'))).toHaveLength(0)
  })

  test('saved tokens are re-checked on open: no classroom50 access is flagged', async() => {
    storage['OA_ghToken_hkhk-automation'] = 'tok'
    storage['OA_ghTokenExp_hkhk-automation'] = 'never'
    global.fetch = githubFetch([[repo('hkhk-automation', 'muu')]])
    await initializeGitHubSettings(doc)
    for (let i = 0; i < 10; i++) await flush()
    expect(storage['OA_ghTokenExp_hkhk-automation']).toBe('norepo')
    expect(doc.getElementById('github-token-list').textContent).toContain('token ei näe repot classroom50')
  })

  test('a token expiring within two weeks is marked', async() => {
    storage['OA_ghToken_hkhk-automation'] = 'tok'
    storage['OA_ghTokenExp_hkhk-automation'] = new Date(Date.now() + 3 * 864e5).toISOString()
    global.fetch = async() => { throw new Error('offline') } // offline: the stored date stays
    await initializeGitHubSettings(doc)
    expect(doc.getElementById('github-token-list').textContent).toContain('aegub varsti')
  })

  test('deleting a token removes it and its expiry', async() => {
    storage['OA_ghToken_hkhk-automation'] = 'tok'
    storage['OA_ghTokenExp_hkhk-automation'] = 'never'
    global.fetch = async() => { throw new Error('offline') }
    await initializeGitHubSettings(doc)
    ;[...doc.querySelectorAll('#github-token-list button')].find(b => b.textContent === 'Kustuta').click()
    for (let i = 0; i < 5; i++) await flush()
    expect(storage).toEqual({})
    expect(doc.getElementById('github-token-list').textContent).toBe('')
  })
})
