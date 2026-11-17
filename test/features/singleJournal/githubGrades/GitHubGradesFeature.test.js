import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import GitHubGradesFeature, { fixClassroom50Pair } from '../../../../src/features/singleJournal/githubGrades/GitHubGradesFeature.js'
import { setGitHubTransport } from '../../../../src/lib/githubGrades.js'

const JID = '77'
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// Journal 77: one lesson where Mari has no grade yet and Juhan already has 2
const entries = [
  {
    id: 1,
    nameEt: 'Linux alused',
    entryType: 'SISSEKANNE_P',
    entryDate: '2026-09-09T00:00:00Z',
    journalEntryStudents: [{ id: 900, journalStudent: 102, grade: { code: 'KUTSEHINDAMINE_2' } }]
  }
]
const students = [
  { id: 101, fullname: 'Mets Mari', studentGroup: 'IT-24' },
  { id: 102, firstname: 'Juhan', lastname: 'Võsa', studentGroup: 'IT-24' }
]
const csv = 'Ülesanne,Õpilane,Punktid,Max\nlinux-alused,Mari Mets,9,10\nlinux-alused,Juhan Võsa,8,10\n'

let storage
let github
let api
let originalChrome
let originalSetTimeout

function installChrome() {
  const pick = keys => {
    if (keys == null) return { ...storage }
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys)
    return Object.fromEntries(list.filter(k => k in storage).map(k => [k, storage[k]]))
  }
  global.chrome = {
    runtime: { sendMessage: () => {}, lastError: null },
    storage: {
      local: {
        get: (keys, cb) => { const r = pick(keys); if (cb) cb(r); return Promise.resolve(r) },
        set: (obj, cb) => { Object.assign(storage, JSON.parse(JSON.stringify(obj))); if (cb) cb(); return Promise.resolve() },
        remove: (key, cb) => { delete storage[key]; if (cb) cb(); return Promise.resolve() }
      }
    }
  }
}

/** Fake Tahvel API: records writes, answers reads from the fixtures above */
function createApi() {
  const calls = { get: [], put: [], post: [] }
  return {
    calls,
    tahvel: {
      get: async path => {
        calls.get.push(path)
        if (path === `/journals/${JID}/journalEntriesByDate`) return structuredClone(entries)
        if (path === `/journals/${JID}/journalStudents`) return structuredClone(students)
        if (path === `/journals/${JID}`) return { nameEt: 'Automatiseerimine', journalTeachers: [{ id: 5 }] }
        const m = path.match(/journalEntry\/(\d+)$/)
        if (m) return structuredClone(entries.find(e => String(e.id) === m[1]))
        return null
      },
      put: async(path, body) => { calls.put.push({ path, body }) },
      post: async(path, body) => { calls.post.push({ path, body }) }
    }
  }
}

function createFeature(source = 'github') {
  storage.OA_gradeSource = source
  const feature = new GitHubGradesFeature()
  feature.api = api
  return feature
}

const panelText = feature => feature.panel?.textContent || ''
const statusText = feature => feature.panel?.querySelector('[data-gh-status]')?.textContent || ''
const buttonByText = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(text))

beforeEach(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: `https://tahvel.edu.ee/#/journal/${JID}/edit` })
  global.window = dom.window
  global.document = dom.window.document
  originalChrome = global.chrome
  storage = {}
  installChrome()
  api = createApi()
  // GitHub files by URL; anything else is 404
  github = {}
  setGitHubTransport(async url => {
    const hit = Object.entries(github).find(([part]) => url.includes(part))
    return hit ? { ok: true, status: 200, text: hit[1] } : { ok: false, status: 404, text: '' }
  })
  // apply() reloads the page after 1.2 s; jsdom cannot reload, so that one timer is dropped
  originalSetTimeout = global.setTimeout
  global.setTimeout = (fn, ms, ...rest) => (ms === 1200 ? 0 : originalSetTimeout(fn, ms, ...rest))
})

afterEach(() => {
  global.setTimeout = originalSetTimeout
  global.chrome = originalChrome
})

describe('fixClassroom50Pair', () => {
  test('org + classroom name become the classroom50 repo and its scores.json', () => {
    expect(fixClassroom50Pair('hkhk-automation', 'it24-automatiseerimine/')).toEqual({
      repo: 'hkhk-automation/classroom50',
      file: 'it24-automatiseerimine/scores.json'
    })
  })

  test('a full repo and file path stay as they are', () => {
    expect(fixClassroom50Pair(' minu-org/hinded ', 'it24/hinded.csv')).toEqual({ repo: 'minu-org/hinded', file: 'it24/hinded.csv' })
    expect(fixClassroom50Pair('minu-org', 'hinded.csv')).toEqual({ repo: 'minu-org', file: 'hinded.csv' })
    expect(fixClassroom50Pair('', '')).toEqual({ repo: '', file: '' })
  })
})

describe('button on the journal page', () => {
  test('activates only on journal pages', () => {
    const feature = createFeature()
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/77/edit')).toBe(true)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
  })

  test('shows "GitHub" by default and "Classroom 50" when that source is chosen', async() => {
    const gh = createFeature('github')
    await gh.onActivate()
    expect(document.body.querySelector('button').textContent).toBe('GitHub')
    gh.onDeactivate()

    const c50 = createFeature('classroom50')
    await c50.onActivate()
    expect(document.body.querySelector('button').textContent).toBe('Classroom 50')
    c50.onDeactivate()
  })

  test('activating twice adds only one button', async() => {
    const feature = createFeature()
    await feature.onActivate()
    await feature.onActivate()
    expect(document.querySelectorAll('button')).toHaveLength(1)
    feature.onDeactivate()
  })

  test('leaving the page removes the button and the open panel', async() => {
    const feature = createFeature()
    await feature.onActivate()
    await feature.togglePanel()
    expect(feature.panel).not.toBeNull()
    feature.onDeactivate()
    expect(document.body.children).toHaveLength(0)
    expect(feature.button).toBeNull()
    expect(feature.panel).toBeNull()
  })

  test('switching off while the setting is still being read adds no button', async() => {
    const feature = createFeature()
    const pending = feature.onActivate()
    feature.onDeactivate()
    await pending
    expect(document.querySelector('button')).toBeNull()
  })

  test('clicking the button again closes the panel', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    expect(document.body.contains(feature.panel)).toBe(true)
    await feature.togglePanel()
    expect(feature.panel).toBeNull()
  })
})

describe('settings form', () => {
  test('without a saved repo the panel opens the settings and says why nothing was found', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    expect(panelText(feature)).toContain('GitHub → Tahvel hinded')
    expect(panelText(feature)).toContain('popupis pole tokenit')
    expect(feature.panel.querySelector('input[type="password"]')).not.toBeNull()
  })

  test('saving stores repo and file for this journal and the token for the repo owner', async() => {
    const feature = createFeature()
    github['minu-org/hinded/HEAD/it24/hinded.csv'] = csv
    github['/repos/minu-org/hinded/contents/it24/hinded.csv'] = csv
    await feature.togglePanel()
    const [repo, file, token, thresholds] = feature.panel.querySelectorAll('input')
    repo.value = 'minu-org/hinded'
    file.value = 'it24/hinded.csv'
    token.value = 'github_pat_test'
    thresholds.value = '95,80,60,30'
    buttonByText(feature.panel, 'Salvesta ja lae hinded')?.click()
    for (let i = 0; i < 20 && !feature.panel.querySelector('table'); i++) await flush()

    expect(storage[`OA_ghJournal_${JID}`]).toMatchObject({ repo: 'minu-org/hinded', file: 'it24/hinded.csv' })
    expect(storage['OA_ghToken_minu-org']).toBe('github_pat_test')
    expect(storage.OA_ghSettings.thresholds).toEqual({ 5: 95, 4: 80, 3: 60, 2: 30 })
    expect(feature.panel.querySelector('table')).not.toBeNull()
  })

  test('Classroom 50 settings ask for org and classroom instead of repo and file', async() => {
    storage['OA_ghToken_hkhk-automation'] = 'tok'
    const feature = createFeature('classroom50')
    await feature.onActivate() // reads the grade source, as on the real page before the button is clicked
    await feature.togglePanel()
    for (let i = 0; i < 20 && !feature.panel.querySelector('select'); i++) await flush()
    expect(panelText(feature)).toContain('Classroom 50 → Tahvel hinded')
    expect(panelText(feature)).toContain('Org')
    expect(panelText(feature)).toContain('Classroom')
    const org = feature.panel.querySelector('select')
    expect([...org.options].map(o => o.value)).toEqual(['', 'hkhk-automation'])
    // Classroom 50 has no token field in the panel: tokens are added in the popup
    expect(feature.panel.querySelector('input[type="password"]')).toBeNull()
  })
})

describe('grades preview', () => {
  beforeEach(() => {
    storage[`OA_ghJournal_${JID}`] = { repo: 'minu-org/hinded', file: 'it24/hinded.csv' }
    github['minu-org/hinded/HEAD/it24/hinded.csv'] = csv
  })

  test('a saved repo opens straight into the preview with one row per student', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    const rows = [...feature.panel.querySelectorAll('table tr')].slice(1)
    expect(rows).toHaveLength(2)
    expect(panelText(feature)).toContain('GitHub: minu-org/hinded → it24/hinded.csv')
    expect(rows.map(r => r.cells[2].textContent)).toEqual(expect.arrayContaining(['Mets Mari', 'Juhan Võsa']))
  })

  test('only new grades are ticked; existing grades stay unticked until overwrite is chosen', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    const rows = [...feature.panel.querySelectorAll('table tr')].slice(1)
    const box = name => rows.find(r => r.cells[2].textContent.includes(name)).querySelector('input')
    expect(box('Mari').checked).toBe(true)
    expect(box('Juhan').checked).toBe(false)

    const overwrite = [...feature.panel.querySelectorAll('label')].find(l => l.textContent.includes('Kirjuta üle')).querySelector('input')
    overwrite.checked = true
    overwrite.dispatchEvent(new window.Event('change'))
    expect(box('Juhan').checked).toBe(true)
  })

  test('writing sends one PUT per entry with only the ticked students', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    buttonByText(feature.panel, 'Kirjuta valitud hinded Tahvlisse').click()
    for (let i = 0; i < 20 && !api.calls.put.length; i++) await flush()
    await flush()

    expect(api.calls.put).toHaveLength(1)
    const { path, body } = api.calls.put[0]
    expect(path).toBe(`/journals/${JID}/journalEntry/1`)
    expect(body.journalEntryStudents).toHaveLength(1)
    expect(body.journalEntryStudents[0]).toMatchObject({ journalStudent: 101, removeStudentHistory: true })
    expect(body.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_5')
    expect(statusText(feature)).toContain('Valmis: 1 hinnet kirjutatud')
  })

  test('overwriting an existing grade keeps that row\'s id', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    const juhan = [...feature.panel.querySelectorAll('table tr')].find(r => r.textContent.includes('Juhan'))
    juhan.querySelector('input').checked = true
    buttonByText(feature.panel, 'Kirjuta valitud hinded Tahvlisse').click()
    for (let i = 0; i < 20 && !api.calls.put.length; i++) await flush()

    const written = api.calls.put[0].body.journalEntryStudents
    expect(written.find(s => String(s.journalStudent) === '102')).toMatchObject({ id: 900 })
    expect(written.find(s => String(s.journalStudent) === '102').grade.code).toBe('KUTSEHINDAMINE_4')
  })

  test('nothing ticked → nothing is written and the teacher is told', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    await feature.apply([])
    expect(api.calls.put).toHaveLength(0)
    expect(statusText(feature)).toBe('Midagi pole valitud.')
  })

  test('a Tahvel error is shown in the panel, not thrown', async() => {
    const feature = createFeature()
    await feature.togglePanel()
    api.tahvel.put = async() => { throw new Error('412 Precondition Failed') }
    buttonByText(feature.panel, 'Kirjuta valitud hinded Tahvlisse').click()
    for (let i = 0; i < 20 && !statusText(feature).includes('Viga'); i++) await flush()
    expect(statusText(feature)).toBe('Viga pärast 0 hinnet: 412 Precondition Failed')
  })

  test('a missing grades file opens the settings with an error', async() => {
    delete github['minu-org/hinded/HEAD/it24/hinded.csv']
    const feature = createFeature()
    await feature.togglePanel()
    expect(panelText(feature)).toContain('Hinnete fail repos')
    expect(statusText(feature)).toContain('Faili ei leitud')
  })

  test('an empty grades file says which columns are needed', async() => {
    github['minu-org/hinded/HEAD/it24/hinded.csv'] = 'midagi muud\n'
    const feature = createFeature()
    await feature.togglePanel()
    expect(statusText(feature)).toContain('Vajalikud tulbad')
  })

  test('a student who is not in Tahvel gets a dropdown, and the choice is remembered', async() => {
    github['minu-org/hinded/HEAD/it24/hinded.csv'] = 'Ülesanne,GitHub,Punktid,Max\nlinux-alused,tundmatu,9,10\n'
    const feature = createFeature()
    await feature.togglePanel()
    expect(panelText(feature)).toContain('Õpilased, keda Tahvlis ei leitud')
    const select = [...feature.panel.querySelectorAll('div')].find(d => d.querySelector('code')?.textContent === 'tundmatu').querySelector('select')
    select.value = 'Mets Mari'
    select.dispatchEvent(new window.Event('change'))
    for (let i = 0; i < 20 && !storage.OA_ghUserMap; i++) await flush()
    expect(storage.OA_ghUserMap).toEqual({ tundmatu: 'Mets Mari' })
  })
})

describe('Classroom 50 auto-detect', () => {
  test('finds the classroom folder by group code and remembers it for the journal', async() => {
    storage['OA_ghToken_hkhk-automation'] = 'tok'
    github['/repos/hkhk-automation/classroom50/contents/'] = JSON.stringify([
      { type: 'dir', name: 'its25-devops' },
      { type: 'dir', name: 'it24-automatiseerimine' },
      { type: 'dir', name: '.github' }
    ])
    const feature = createFeature('classroom50')
    const found = await feature.autoDetect(JID)
    expect(found).toEqual({ repo: 'hkhk-automation/classroom50', file: 'it24-automatiseerimine/scores.json' })
    expect(storage[`OA_ghJournal_${JID}`]).toMatchObject(found)
  })

  test('without any token nothing is detected', async() => {
    const feature = createFeature('classroom50')
    expect(await feature.autoDetect(JID)).toBeNull()
  })

  test('explains which folders it saw when no classroom matches', async() => {
    storage['OA_ghToken_hkhk-automation'] = 'tok'
    github['/repos/hkhk-automation/classroom50/contents/'] = JSON.stringify([{ type: 'dir', name: 'its25-devops' }])
    const feature = createFeature('classroom50')
    expect(await feature.autoDetect(JID)).toBeNull()
    expect(feature._autoWhy).toContain('its25-devops')
  })
})
