import { ADDON_VERSION } from '../lib/githubGrades.js'
/**
 * Popup section "GitHub integratsioon" — grades from a GitHub repo → Tahvel.
 * Stores: OA_ghEnabled (default on), OA_ghToken_<owner>, OA_ghTokenExp_<owner> (one fine-grained token per GitHub user/org).
 */
const ENABLED_KEY = 'OA_ghEnabled'
const TOKEN_PREFIX = 'OA_ghToken_'
const EXP_PREFIX = 'OA_ghTokenExp_'

const get = keys => new Promise(resolve => chrome.storage.local.get(keys, r => resolve(r || {})))
const set = obj => new Promise(resolve => chrome.storage.local.set(obj, () => resolve()))
const remove = key => new Promise(resolve => chrome.storage.local.remove(key, () => resolve()))

/**
 * Which org/user a token belongs to — asked from GitHub, never typed in.
 * Prefers owners that have a "classroom50" repo; also returns the token's expiry date if GitHub sends it.
 */
export async function tokenOwners(token, fetchFn = fetch) {
  let res
  const repos = []
  // All pages: a teacher can see hundreds of repos, the classroom50 one may be anywhere
  for (let page = 1; page <= 20; page++) {
    res = await fetchFn(`https://api.github.com/user/repos?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }
    })
    if (res.status === 401) return { error: 'Token ei kehti (vale või aegunud).', owners: [] }
    if (!res.ok) return { error: `GitHub vastas ${res.status}.`, owners: [] }
    const batch = await res.json()
    repos.push(...(batch || []))
    if (!Array.isArray(batch) || batch.length < 100) break
  }
  const owners = list => [...new Set(list.map(r => r.owner && r.owner.login).filter(Boolean))].sort()
  const c50 = owners((repos || []).filter(r => r.name === 'classroom50'))
  const expRaw = res.headers && res.headers.get && res.headers.get('github-authentication-token-expiration')
  const expires = expRaw ? new Date(expRaw.replace(' UTC', 'Z').replace(' ', 'T').replace(' ', '')).toISOString() : null
  return { owners: c50.length ? c50 : owners(repos || []), expires, noClassroom50: !c50.length }
}

export async function initializeGitHubSettings(doc = document) {
  const enabled = doc.getElementById('github-enabled')
  const container = doc.getElementById('github-settings-container')
  const addBtn = doc.getElementById('github-add-token')
  const form = doc.getElementById('github-token-form')
  const tokenInput = doc.getElementById('github-token')
  const saveBtn = doc.getElementById('save-github-settings')
  const list = doc.getElementById('github-token-list')
  const status = doc.getElementById('github-save-status')
  if (!enabled || !container) return

  const all = await get(null)
  enabled.checked = all[ENABLED_KEY] !== false
  container.style.display = enabled.checked ? 'block' : 'none'

  const renderTokens = async() => {
    const items = await get(null)
    const orgs = Object.keys(items).filter(k => k.startsWith(TOKEN_PREFIX)).map(k => k.slice(TOKEN_PREFIX.length)).sort()
    list.replaceChildren(...(orgs.length ? orgs.map(org => {
      const row = doc.createElement('div')
      row.className = 'api-key-status'
      row.style.display = 'flex'
      const label = doc.createElement('span')
      const exp = items[EXP_PREFIX + org]
      if (exp === 'norepo') {
        label.textContent = `⚠ ${org} — token ei näe repot classroom50, tee uus token (Repository access: classroom50)`
        label.style.color = '#b54708'
      } else if (exp === 'invalid') {
        label.textContent = `✗ ${org} — token ei kehti, lisa uus`
        label.style.color = '#b42318'
      } else {
        const days = exp && exp !== 'never' ? Math.floor((new Date(exp) - Date.now()) / 864e5) : null
        label.textContent = `✓ ${org}` + (days != null ? ` · kehtib kuni ${new Date(exp).toLocaleDateString('et-EE')}` : exp === 'never' ? ' · kehtib' : '')
        if (days != null && days < 14) { label.style.color = '#b42318'; label.textContent += days < 0 ? ' — AEGUNUD, lisa uus' : ' — aegub varsti' }
      }
      const del = doc.createElement('button')
      del.type = 'button'
      del.className = 'btn secondary-btn'
      del.textContent = 'Kustuta'
      del.addEventListener('click', async() => { await remove(TOKEN_PREFIX + org); await remove(EXP_PREFIX + org); renderTokens() })
      row.append(label, del)
      return row
    }) : []))
    // Saved and valid → nothing to fill in; the form only opens via "+ Lisa token" or when none is saved
    if (addBtn && form) {
      addBtn.style.display = orgs.length ? '' : 'none'
      form.style.display = orgs.length ? 'none' : ''
    }
  }
  if (addBtn) addBtn.addEventListener('click', () => { form.style.display = ''; addBtn.style.display = 'none'; tokenInput.focus() })
  await renderTokens()

  // Check every saved token against GitHub when the popup opens: still valid? until when?
  void (async() => {
    const items = await get(null)
    const byToken = new Map()
    for (const k of Object.keys(items).filter(k => k.startsWith(TOKEN_PREFIX))) {
      const t = items[k]
      if (!byToken.has(t)) byToken.set(t, [])
      byToken.get(t).push(k.slice(TOKEN_PREFIX.length))
    }
    const upd = {}
    for (const [t, orgs] of byToken) {
      let r
      try { r = await tokenOwners(t) } catch { continue } // offline → leave as is
      for (const o of orgs) upd[EXP_PREFIX + o] = r.error ? 'invalid' : (!r.owners.includes(o) || r.noClassroom50) ? 'norepo' : (r.expires || 'never')
    }
    if (Object.keys(upd).length) { await set(upd); renderTokens() }
  })()

  enabled.addEventListener('change', async() => {
    await set({ [ENABLED_KEY]: enabled.checked })
    container.style.display = enabled.checked ? 'block' : 'none'
    status.textContent = 'Värskenda Tahvli lehte.'
  })

  saveBtn.addEventListener('click', async() => {
    const toSet = {}
    const token = tokenInput.value.trim()
    let saved = []
    if (!token) { status.style.color = '#b42318'; status.textContent = 'Kleebi token.'; return }
    {
      status.style.color = '#555'
      status.textContent = 'Kontrollin tokenit…'
      let found
      try { found = await tokenOwners(token) } catch (e) { found = { error: e.message } }
      if (found.error || !found.owners.length) {
        status.style.color = '#b42318'
        status.textContent = found.error || 'Token ei näe ühtegi repot. Vali tokenit tehes Repository access: classroom50.'
        return
      }
      for (const o of found.owners) {
        toSet[TOKEN_PREFIX + o] = token
        toSet[EXP_PREFIX + o] = found.expires || 'never'
      }
      saved = found.owners
    }
    await set(toSet)
    tokenInput.value = ''
    status.style.color = 'green'
    status.textContent = saved.length ? `Salvestatud: ${saved.join(', ')}` : 'Salvestatud'
    setTimeout(() => { status.textContent = '' }, 2000)
    renderTokens()
  })
}

const SOURCE_KEY = 'OA_gradeSource' // 'github' | 'classroom50' | 'kriit' | 'none'
const KRIIT_ENABLED_KEY = 'OA_kriitEnabled'

const SOURCE_TEXT = {
  github: ['GitHub integratsioon', 'Päeviku lehel nupp "GitHub".'],
  classroom50: ['Classroom 50 integratsioon', 'Päeviku lehel nupp "Classroom 50".']
}

/**
 * "Hinnete allikas" selector: shows only the chosen source's settings and switches the others off.
 * Kriit keeps its own settings UI (popup.js); this only toggles OA_kriitEnabled.
 */
export async function initializeGradeSource(doc = document) {
  const sel = doc.getElementById('grade-source')
  const kriitGroup = doc.getElementById('kriit-group')
  const githubGroup = doc.getElementById('github-group')
  if (!sel || !kriitGroup || !githubGroup) return
  const title = doc.getElementById('github-group-title')
  const help = doc.getElementById('github-group-help')

  // The selector replaces the on/off switches of these two sections
  for (const g of [kriitGroup, githubGroup]) {
    const toggle = g.querySelector('.toggle-container')
    if (toggle) toggle.style.display = 'none'
  }
  const hideWithDivider = (group, hidden) => {
    group.style.display = hidden ? 'none' : ''
    const next = group.nextElementSibling
    if (next && next.classList.contains('divider')) next.style.display = hidden ? 'none' : ''
  }

  const show = source => {
    hideWithDivider(kriitGroup, source !== 'kriit')
    hideWithDivider(githubGroup, !SOURCE_TEXT[source])
    if (SOURCE_TEXT[source]) {
      title.textContent = SOURCE_TEXT[source][0]
      help.textContent = SOURCE_TEXT[source][1]
      const container = doc.getElementById('github-settings-container')
      if (container) container.style.display = 'block'
    }
    // Kriit-only hints elsewhere in the popup
    for (const n of doc.querySelectorAll('.lesson-email-note')) n.style.display = source === 'kriit' ? '' : 'none'
    if (source === 'kriit') {
      const kriitSettings = doc.getElementById('kriit-settings-container')
      if (kriitSettings) kriitSettings.style.display = 'block'
    }
  }

  // Show which GitHub/Classroom 50 add-on build is installed, next to the extension version
  const versionEl = doc.getElementById('version')
  if (versionEl && !versionEl.dataset.addon) {
    versionEl.dataset.addon = '1'
    versionEl.after(doc.createTextNode(` · GitHub lisa ${ADDON_VERSION}`))
  }

  const stored = await get([SOURCE_KEY, KRIIT_ENABLED_KEY])
  const source = stored[SOURCE_KEY] || (stored[KRIIT_ENABLED_KEY] === true ? 'kriit' : 'github')
  sel.value = source
  show(source)

  sel.addEventListener('change', async() => {
    const s = sel.value
    await set({
      [SOURCE_KEY]: s,
      [KRIIT_ENABLED_KEY]: s === 'kriit',
      [ENABLED_KEY]: s === 'github' || s === 'classroom50'
    })
    const kriitBox = doc.getElementById('kriit-enabled')
    const ghBox = doc.getElementById('github-enabled')
    if (kriitBox) kriitBox.checked = s === 'kriit'
    if (ghBox) ghBox.checked = s === 'github' || s === 'classroom50'
    show(s)
    const status = doc.getElementById('github-save-status')
    if (status) status.textContent = 'Värskenda Tahvli lehte.'
  })
}
