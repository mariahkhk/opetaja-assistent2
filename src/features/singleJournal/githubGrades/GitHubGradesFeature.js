/**
 * GitHub → Tahvel grades
 *
 * On a single journal page: reads a grades file from a GitHub repo (CSV / Markdown table, or Classroom 50
 * scores.json), matches assignments to journal entries and students by name, shows a preview, and writes
 * only the rows the teacher ticks — through the teacher's own Tahvel session.
 *
 * Which repo/file a journal uses comes from (1) the teacher's own choice in the panel, or
 * (2) the shared school table (Markdown) set in the popup.
 */
import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import {
  ADDON_VERSION,
  DEFAULT_THRESHOLDS,
  assignmentMeta,
  buildEntryTextUpdates,
  findSharedEntries,
  buildPreview,
  fetchRepoFile,
  findJournalConfig,
  listRepoDirs,
  matchEntryForAssignment,
  pickClassroom,
  gitHubRequest,
  setGitHubTransport,
  normalizeMode,
  parseCsv,
  parseGradesFile,
  parseJournalTable,
  splitRepo,
  tahvelGrade,
  tahvelStudentName,
  toRawUrl,
  triggerCollectScores
} from '../../../lib/githubGrades.js'

// Route GitHub requests through the background service worker (avoids page CORS/CSP limits)
if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
  setGitHubTransport((url, init = {}) => new Promise((resolve, reject) => {
    const { cache: _cache, ...rest } = init
    chrome.runtime.sendMessage({ action: 'githubFetch', url, init: rest }, res => {
      if (chrome.runtime.lastError) { reject(new Error(`Laiendusega ei saanud ühendust (${chrome.runtime.lastError.message}) — vajuta Tahvlis F5`)); return }
      if (!res || res.status === 0) { reject(new Error(`GitHubiga ei saanud ühendust${res?.error ? ` (${res.error})` : ''}`)); return }
      resolve(res)
    })
  }))
}

/**
 * Org + classroom typed into the GitHub (repo/file) fields — e.g. repo "my-org", file "it24-automatiseerimine" —
 * is a Classroom 50 pair: turn it into "<org>/classroom50" + "<classroom>/scores.json".
 */
export function fixClassroom50Pair(repo, file) {
  const r = String(repo || '').trim()
  const f = String(file || '').trim()
  if (r && !r.includes('/') && f && !/\.[a-z0-9]+$/i.test(f)) return { repo: `${r}/classroom50`, file: `${f.replace(/\/+$/, '')}/scores.json` }
  return { repo: r, file: f }
}

const K_SETTINGS = 'OA_ghSettings' // { configUrl, thresholds }
const K_TOKEN = owner => `OA_ghToken_${owner}` // one fine-grained token per GitHub owner (user or org)
const K_JOURNAL = id => `OA_ghJournal_${id}` // { repo, file, mode, assignmentMap }
const K_USERS = 'OA_ghUserMap' // { githubUsername or file name: 'Tahvel full name' }
const K_SOURCE = 'OA_gradeSource' // 'github' | 'classroom50' (popup "Hinnete allikas")

const storageGet = keys => new Promise(resolve => chrome.storage.local.get(keys, r => resolve(r || {})))
const storageSet = obj => new Promise(resolve => chrome.storage.local.set(obj, () => resolve()))

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') Object.assign(node.style, v)
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (k === 'text') node.textContent = v
    else node[k] = v
  }
  for (const c of [].concat(children)) if (c != null) node.append(c)
  return node
}

export default class GitHubGradesFeature extends BaseFeature {
  constructor() {
    super('githubGrades', /#\/journal\/\d+/)
    this.button = null
    this.panel = null
  }

  journalId() {
    const m = window.location.hash.match(/#\/journal\/(\d+)/)
    return m ? m[1] : null
  }

  async onActivate() {
    if (this.button) return
    this._active = true
    this.source = (await storageGet([K_SOURCE]))[K_SOURCE] === 'classroom50' ? 'classroom50' : 'github'
    if (this.button || !this._active) return // switched off while reading the setting
    this.button = el('button', {
      text: this.source === 'classroom50' ? 'Classroom 50' : 'GitHub',
      title: `Too hinded GitHubist Tahvlisse · lisa ${ADDON_VERSION}`,
      onclick: () => this.togglePanel(),
      style: {
        position: 'fixed',
right: '16px',
bottom: '16px',
zIndex: 9999,
padding: '8px 14px',
        background: '#24292f',
color: '#fff',
border: 'none',
borderRadius: '6px',
cursor: 'pointer',
        font: '600 13px system-ui, sans-serif',
boxShadow: '0 2px 8px rgba(0,0,0,.25)'
      }
    })
    document.body.append(this.button)
  }

  onDeactivate() {
    super.onDeactivate()
    this._active = false
    this.button?.remove()
    this.panel?.remove()
    this.button = null
    this.panel = null
  }

  onJournalDataChanged() {
    this.panel?.remove()
    this.panel = null
  }

  async togglePanel() {
    if (this.panel) { this.panel.remove(); this.panel = null; return }
    this.panel = el('div', {
      style: {
        position: 'fixed',
right: '16px',
bottom: '60px',
width: 'min(760px, calc(100vw - 32px))',
maxHeight: '75vh',
        overflow: 'auto',
zIndex: 9999,
background: '#fff',
color: '#111',
border: '1px solid #d0d7de',
borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,.2)',
padding: '14px',
font: '13px system-ui, sans-serif'
      }
    })
    document.body.append(this.panel)
    this.status('Otsin selle päeviku hindeid…')
    const panel = this.panel
    const { repo, file } = await this.resolveConfig(this.journalId())
    if (this.panel !== panel) return // closed or replaced while loading
    // Everything known → go straight to the grades preview; otherwise show settings
    if (repo && file) await this.loadPreview()
    else await this.renderSettings()
  }

  status(text, isError = false) {
    let s = this.panel?.querySelector('[data-gh-status]')
    if (!s && this.panel) {
      s = el('div', { style: { margin: '8px 0', fontWeight: 600 } })
      s.dataset.ghStatus = '1'
      this.panel.append(s)
    }
    if (s) { s.textContent = text; s.style.color = isError ? '#b42318' : '#1a7f37' }
  }

  /** Effective settings. Priority: teacher's own per-journal choice > shared table > defaults. */
  async resolveConfig(jid) {
    const st = await storageGet([K_SETTINGS, K_JOURNAL(jid)])
    const settings = st[K_SETTINGS] || {}
    const journal = st[K_JOURNAL(jid)] || {}
    // Optional school table only when a URL was set; otherwise everything comes from auto-detect
    const shared = settings.configUrl ? await this.loadSharedRow(jid, settings.configUrl) : null
    const auto = journal.repo || shared?.repo ? null : await this.autoDetect(jid, journal.file)
    return {
      settings,
journal,
shared,
auto,
      ...fixClassroom50Pair(journal.repo || shared?.repo || auto?.repo || '', journal.file || shared?.file || auto?.file || ''),
      mode: journal.mode || (shared?.mode ? normalizeMode(shared.mode) : '')
    }
  }

  /**
   * Classroom 50 auto-detect: for every GitHub owner with a saved token, list <owner>/classroom50 folders
   * and pick the one whose name starts with this journal's group code (IT-24 → it24-…).
   */
  async autoDetect(jid, knownFile = '') {
    if (this._auto && this._auto.jid === jid) return this._auto.result
    let result = null
    try {
      const all = await storageGet(null)
      const owners = Object.keys(all).filter(k => k.startsWith('OA_ghToken_')).map(k => k.slice('OA_ghToken_'.length))
      if (owners.length) {
        const [students, info] = await Promise.all([
          this.api.tahvel.get(`/journals/${jid}/journalStudents`, { allStudents: true }, { cache: true, cacheExpiration: 36e5 }).catch(() => []),
          this.api.tahvel.get(`/journals/${jid}`, {}, { cache: true, cacheExpiration: 36e5 }).catch(() => ({}))
        ])
        const groups = [...new Set((Array.isArray(students) ? students : []).map(s => s.studentGroup || s.student?.studentGroup).filter(Boolean))]
        const journalName = info?.nameEt || info?.name || ''
        const why = []
        const known = /\/scores\.json$/i.test(knownFile || '') ? knownFile : ''
        for (const owner of owners) {
          const repo = `${owner}/classroom50`
          const token = all[`OA_ghToken_${owner}`]
          try {
            // Classroom already known for this journal (saved earlier): just check which org has it
            if (known && await fetchRepoFile({ repo, path: known, token }).catch(() => null) != null) { result = { repo, file: known }; break }
            const dirs = await listRepoDirs({ repo, token })
            const dir = pickClassroom(dirs, groups, journalName)
            if (dir) { result = { repo, file: `${dir}/scores.json` }; break }
            why.push(`${owner}: ${dirs.error || `classroomi ${groups.join('/') || '?'} jaoks ei leitud (${dirs.join(', ') || 'kaustu pole'})`}`)
          } catch (e) {
            why.push(`${owner}: ${e.message}`)
          }
        }
        // Remember the found org/classroom for this journal, so it never has to be detected (or typed) again
        if (result) {
          const cur = (await storageGet([K_JOURNAL(jid)]))[K_JOURNAL(jid)] || {}
          await new Promise(resolve => chrome.storage.local.set({ [K_JOURNAL(jid)]: { ...cur, repo: result.repo, file: result.file } }, resolve))
        }
        this._autoWhy = result ? '' : why.join(' · ')
      }
    } catch (e) {
      Logger.warning(`[githubGrades] auto-detect failed: ${e.message}`)
    }
    if (result) this._auto = { jid, result }
    return result
  }

  async loadSharedRow(jid, url) {
    if (!url) return null
    try {
      if (!this._sharedRows || this._sharedUrl !== url) {
        const res = await gitHubRequest(toRawUrl(url), {})
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        this._sharedRows = parseJournalTable(res.text)
        this._sharedUrl = url
      }
      let info = {}
      try { info = await this.api.tahvel.get(`/journals/${jid}`, {}, { cache: true, cacheExpiration: 36e5 }) || {} } catch { /* id match still works */ }
      return findJournalConfig(this._sharedRows, {
        id: jid,
        name: info.nameEt || info.name || '',
        groupsText: JSON.stringify(info.studentGroups || info.groups || info.studentGroupCodes || '')
      })
    } catch (e) {
      Logger.warning(`[githubGrades] shared table not loaded: ${e.message}`)
      return null
    }
  }

  async renderSettings() {
    if (!this.panel) return
    const jid = this.journalId()
    const { settings, journal, shared, auto, repo: repo0, file: file0, mode: mode0 } = await this.resolveConfig(jid)
    const owner0 = splitRepo(repo0).owner
    const hasToken = owner0 ? !!(await storageGet([K_TOKEN(owner0)]))[K_TOKEN(owner0)] : false

    const input = (label, value, opts = {}) => {
      const i = el('input', { value: value || '', ...opts, style: { width: '100%', padding: '4px 6px', boxSizing: 'border-box' } })
      return [i, el('label', { style: { display: 'block', marginBottom: '6px' } }, [el('div', { text: label, style: { fontWeight: 600 } }), i])]
    }
    const sharedNote = el('div', {
      style: { color: '#555', marginBottom: '8px' },
      text: shared ? `Ühisest tabelist: ${shared.repo} → ${shared.file}` : auto ? `Leitud automaatselt: ${auto.repo} → ${auto.file}` : `Automaatselt ei leitud${this._autoWhy ? ` — ${this._autoWhy}` : ' — popupis pole tokenit'}`
    })
    // Classroom 50 mode shows Org + Classroom; stored the same way as repo "<org>/classroom50" + file "<classroom>/scores.json"
    const c50 = this.source === 'classroom50'
    const tokenOwners = Object.keys(await storageGet(null)).filter(k => k.startsWith('OA_ghToken_')).map(k => k.slice('OA_ghToken_'.length)).sort()
    let repoI, repoL
    if (c50) {
      repoI = el('select', { style: { width: '100%', padding: '4px 6px' } }, [
        el('option', { value: '', text: tokenOwners.length ? '— vali —' : 'lisa token popupis' }),
        ...tokenOwners.map(o => el('option', { value: o, text: o }))
      ])
      repoI.value = owner0 && tokenOwners.includes(owner0) ? owner0 : ''
      repoL = el('label', { style: { display: 'block', marginBottom: '6px' } }, [el('div', { text: 'Org', style: { fontWeight: 600 } }), repoI])
    } else {
      [repoI, repoL] = input('Repo (omanik/repo)', repo0, { placeholder: 'nt minu-org/hinded' })
    }
    const [fileI, fileL] = c50
      ? input('Classroom', file0.replace(/\/scores\.json$/i, ''), { placeholder: 'nt it24-automatiseerimine' })
      : input('Hinnete fail repos', file0, { placeholder: 'nt it24/hinded.csv' })
    const repoValue = () => c50 ? (repoI.value.trim() ? `${repoI.value.trim()}/classroom50` : '') : repoI.value.trim()
    const fileValue = () => c50 ? (fileI.value.trim() ? `${fileI.value.trim()}/scores.json` : '') : fileI.value.trim()
    const [tokI, tokL] = input(
      hasToken ? `Token (${owner0}: salvestatud — tühi = jäta alles)` : 'Token (ainult privaatse repo jaoks)', '',
      { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' }
    )
    const modeS = el('select', {}, [
      el('option', { value: '', text: 'Automaatne (nagu sissekandes juba on, muidu 1–5)' }),
      el('option', { value: '5', text: 'Eristav 1–5' }),
      el('option', { value: 'AMA', text: 'Mitteeristav A / MA' })
    ])
    modeS.value = mode0
    const th = { ...DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) }
    const [thI, thL] = input('Piirid % punktidest (5,4,3,2) — A/MA puhul kehtib "3" piir', `${th[5]},${th[4]},${th[3]},${th[2]}`)
    const missS = el('select', {}, [
      el('option', { value: '', text: 'Ei pane hinnet' }),
      el('option', { value: '2', text: '2 (A/MA puhul MA)' }),
      el('option', { value: '1', text: '1 (A/MA puhul MA)' })
    ])
    missS.value = settings.missingGrade || ''
    const missL = el('label', { style: { display: 'block', marginBottom: '6px' } }, [
      el('div', { text: 'Esitamata töö, kui tähtaeg on möödas', style: { fontWeight: 600 } }), missS
    ])

    const save = async() => {
      const [t5, t4, t3, t2] = thI.value.split(',').map(n => Number(n.trim()))
      const thresholds = [t5, t4, t3, t2].every(Number.isFinite) ? { 5: t5, 4: t4, 3: t3, 2: t2 } : DEFAULT_THRESHOLDS
      const repo = repoValue()
      const file = fileValue()
      const toSet = {
        [K_SETTINGS]: { ...settings, thresholds, missingGrade: missS.value },
        // store only what differs from the shared table, so later table edits still reach this teacher
        [K_JOURNAL(jid)]: {
          ...journal,
          repo: repo !== (shared?.repo || '') ? repo : undefined,
          file: file !== (shared?.file || '') ? file : undefined,
          mode: modeS.value && modeS.value !== (shared?.mode ? normalizeMode(shared.mode) : '') ? modeS.value : undefined
        }
      }
      const owner = splitRepo(repo).owner
      if (tokI.value.trim() && owner) toSet[K_TOKEN(owner)] = tokI.value.trim()
      await storageSet(toSet)
    }

    const isClassroom50 = c50 || /scores\.json$/i.test(file0)
    this.panel.replaceChildren(
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
        el('strong', { text: `${c50 ? 'Classroom 50' : 'GitHub'} → Tahvel hinded`, style: { fontSize: '15px' } }, [
          el('span', { text: `  ${ADDON_VERSION}`, style: { fontWeight: 400, fontSize: '11px', color: '#888' } })
        ]),
        el('button', { text: '✕', onclick: () => this.togglePanel() })
      ]),
      sharedNote, repoL, fileL, ...(c50 ? [] : [tokL]),
      el('label', { style: { display: 'block', marginBottom: '6px' } }, [el('div', { text: 'Hindamine', style: { fontWeight: 600 } }), modeS]),
      thL, missL,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        el('button', { text: 'Salvesta ja lae hinded', onclick: async() => { await save(); await this.loadPreview() } }),
        isClassroom50 ? el('button', {
          text: 'Uuenda scores.json (Classroom 50)',
          title: 'Käivitab collect-scores töövoo (token vajab Actions: write). Oota 1–2 min ja lae siis hinded.',
          onclick: async() => {
            await save()
            try {
              const repo = repoValue()
              const token = (await storageGet([K_TOKEN(splitRepo(repo).owner)]))[K_TOKEN(splitRepo(repo).owner)]
              await triggerCollectScores({ repo, token, classroom: fileValue().split('/')[0] })
              this.status('collect-scores käivitatud. Oota 1–2 minutit ja vajuta "Salvesta ja lae hinded".')
            } catch (e) { this.status(e.message, true) }
          }
        }) : null
      ])
    )
  }

  async loadPreview() {
    const jid = this.journalId()
    const { settings, journal, repo, file, mode } = await this.resolveConfig(jid)
    if (!repo || !file) { this.status(this.source === 'classroom50' ? 'Täida org ja classroom.' : 'Täida repo ja hinnete fail.', true); return }
    const owner = splitRepo(repo).owner
    const st = await storageGet([K_USERS, K_TOKEN(owner)])
    const token = st[K_TOKEN(owner)]

    this.status('Laen GitHubist ja Tahvlist…')
    try {
      const isClassroom50 = /scores\.json$/i.test(file)
      const rosterPath = isClassroom50 ? file.replace(/scores\.json$/i, 'roster.csv') : null
      const assignmentsPath = isClassroom50 ? file.replace(/scores\.json$/i, 'assignments.json') : null
      const [gradesText, rosterText, assignmentsText, entriesRaw, students] = await Promise.all([
        fetchRepoFile({ repo, path: file, token }),
        rosterPath ? fetchRepoFile({ repo, path: rosterPath, token }).catch(() => null) : null,
        assignmentsPath ? fetchRepoFile({ repo, path: assignmentsPath, token }).catch(() => null) : null,
        this.api.tahvel.get(`/journals/${jid}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
        this.api.tahvel.get(`/journals/${jid}/journalStudents`, { allStudents: true }, { cache: false })
      ])
      if (gradesText == null) {
        this.status(token ? `Faili ${file} ei leitud repos ${repo}.` : `Faili ei leitud. Kui repo on privaatne, lisa token.`, true)
        return
      }

      const entries = (Array.isArray(entriesRaw) ? entriesRaw : entriesRaw?.content || []).map(e => {
        if (Array.isArray(e.journalEntryStudents) || !e.journalStudentResults) return e
        return {
          ...e,
          journalEntryStudents: Object.entries(e.journalStudentResults).flatMap(([journalStudent, results]) =>
            Array.isArray(results) ? results.slice(0, 1).map(r => ({ ...r, journalStudent })) : [])
        }
      })

      this.ctx = {
        jid,
repo,
file,
entries,
students: Array.isArray(students) ? students : [],
        records: parseGradesFile(gradesText, file),
        roster: rosterText ? parseCsv(rosterText) : [],
        meta: (() => { try { return assignmentMeta(JSON.parse(assignmentsText || '{}')) } catch { return new Map() } })(),
        journal,
userMap: st[K_USERS] || {},
settings: { ...settings, mode }
      }
      if (!this.ctx.records.length && !this.ctx.meta.size) {
        this.status('Failist ei leitud ühtegi rida. Vajalikud tulbad: Ülesanne, Õpilane või GitHub, Hinne või Punktid + Max.', true)
        return
      }
      await this.loadEntryTexts()
      if (!this.panel) return
      this.renderPreview()
    } catch (e) {
      Logger.error('[githubGrades] load failed', e)
      this.status(`Viga: ${e.message}`, true)
    }
  }

  renderPreview() {
    if (!this.panel || !this.ctx) return // panel closed while loading
    const { entries, students, records, roster, journal, userMap, settings } = this.ctx
    const preview = buildPreview({
      records,
roster,
entries,
students,
meta: this.ctx.meta,
missingGrade: settings.missingGrade || '',
      assignmentMap: journal.assignmentMap || {},
      userMap,
      mode: settings.mode || '',
      thresholds: { ...DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) }
    })
    const overwrite = el('input', { type: 'checkbox' })

    const table = el('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: '8px' } })
    const th = t => el('th', { text: t, style: { textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' } })
    const td = (t, style = {}) => el('td', { text: t ?? '', style: { borderBottom: '1px solid #eee', padding: '4px', ...style } })
    table.append(el('tr', {}, [th(''), th('Sissekanne'), th('Õpilane'), th('Punktid'), th('Praegu'), th('Uus')]))
    const boxes = []
    for (const r of preview.rows) {
      const cb = el('input', { type: 'checkbox', checked: r.changed && !r.currentGrade && !r.uncertain, disabled: !r.changed })
      cb.dataset.hasCurrent = r.currentGrade ? '1' : ''
      boxes.push([cb, r])
      const points = r.missing ? 'esitamata (tähtaeg möödas)' : r.score != null && r.max != null ? `${r.score}/${r.max} (${r.percent ?? '–'}%)` : '–'
      table.append(el('tr', { style: r.conflict ? { background: '#fff4e5' } : {} }, [
        el('td', { style: { padding: '4px' } }, cb),
        td(r.conflict ? `${r.entryName} ⚠ ${r.assignment}: mitu ülesannet samal sissekandel` : r.entryName),
        td(r.studentName),
        td(`${points}${r.late ? ' ⏰ hilinenud' : ''}${r.warning ? ' ⚠' : ''}`),
        td(r.currentGrade || '–'),
        td(r.newGrade || '–', { fontWeight: r.changed ? 700 : 400, color: r.changed ? '#0969da' : '#666' })
      ]))
    }
    overwrite.addEventListener('change', () => {
      for (const [cb, r] of boxes) if (r.changed && cb.dataset.hasCurrent) cb.checked = overwrite.checked
    })

    const apply = el('button', {
      text: 'Kirjuta valitud hinded Tahvlisse',
      style: { marginTop: '10px', padding: '6px 12px', fontWeight: 600 },
      onclick: () => this.apply(boxes.filter(([cb]) => cb.checked).map(([, r]) => r))
    })

    this.panel.replaceChildren(
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
        el('strong', {
          text: this.source === 'classroom50'
            ? `Classroom 50: ${this.ctx.file.replace(/\/scores\.json$/i, '')}`
            : `GitHub: ${this.ctx.repo} → ${this.ctx.file}`,
          style: { fontSize: '15px' }
        }),
        el('span', {}, [
          el('button', {
            text: 'Lähtesta seosed',
            title: 'Unusta käsitsi valitud ülesanne → sissekanne seosed; laiendus seob uuesti automaatselt',
            onclick: async() => {
              const key = K_JOURNAL(this.ctx.jid)
              const stored = (await storageGet([key]))[key] || {}
              delete stored.assignmentMap
              await storageSet({ [key]: stored })
              this.ctx.journal = { ...this.ctx.journal, assignmentMap: {} }
              this.renderPreview()
            }
          }),
' ',
          el('button', { text: 'Seaded', onclick: () => this.renderSettings() }),
' ',
          el('button', { text: '✕', onclick: () => this.togglePanel() })
        ])
      ]),
      el('div', {
        style: { color: '#555', marginTop: '4px' },
        text: 'Linnukesega read kirjutatakse. Olemasolevaid hindeid üle ei kirjutata, kui sa seda ise ei vali.'
      }),
      el('label', { style: { display: 'block', marginTop: '6px' } }, [overwrite, ' Kirjuta üle ka olemasolevad hinded']),
      preview.rows.length ? table : el('div', { text: 'Ühtegi vastet ei leitud — vaata allpool seoseid.', style: { marginTop: '8px' } }),
      this.renderFixes(preview),
      apply,
      ...(this.ctx.meta.size ? [this.renderSharedSection() || this.renderTextSection()] : [])
    )
  }

  /** Dropdowns for unmatched assignments (→ journal entry) and students (→ Tahvel student). Remembered. */
  renderFixes(preview) {
    const { entries, students, jid } = this.ctx
    const box = el('div', { style: { marginTop: '12px' } })
    // Every assignment gets a dropdown (preselected), so a wrong choice can always be changed
    const assignments = [...new Set((this.ctx.records || []).map(r => r.assignment))].sort()
    if (assignments.length) {
      box.append(el('div', { text: 'Ülesanne → Tahvli sissekanne (vihje: "gh:<ülesanne>" sissekande nimes seob automaatselt)', style: { fontWeight: 600 } }))
      for (const assignment of assignments) {
        const current = (this.ctx.journal.assignmentMap || {})[assignment] ?? matchEntryForAssignment(assignment, entries, this.ctx.meta.get(assignment), this.ctx.meta)?.id ?? ''
        const sel = el('select', {}, [el('option', { value: '', text: '— ei kirjuta —' }),
          ...entries.map(e => el('option', { value: String(e.id), text: `${(e.entryDate || '').slice(0, 10).split('-').reverse().join('.')} ${e.nameEt || e.entryType}` }))])
        sel.value = String(current)
        sel.addEventListener('change', async() => {
          const map = { ...(this.ctx.journal.assignmentMap || {}), [assignment]: sel.value ? Number(sel.value) : -1 }
          this.ctx.journal = { ...this.ctx.journal, assignmentMap: map }
          await storageSet({ [K_JOURNAL(jid)]: { ...(await storageGet([K_JOURNAL(jid)]))[K_JOURNAL(jid)], assignmentMap: map } })
          this.renderPreview()
        })
        box.append(el('div', { style: { margin: '4px 0' } }, [el('code', { text: this.ctx.meta.get(assignment)?.name || assignment }), ' → ', sel]))
      }
    }
    const userSelect = who => {
      const sel = el('select', {}, [el('option', { value: '', text: '— vali õpilane —' }),
        ...students.map(s => el('option', { value: tahvelStudentName(s), text: tahvelStudentName(s) }))])
      sel.addEventListener('change', async() => {
        this.ctx.userMap = { ...this.ctx.userMap, [who]: sel.value || undefined }
        await storageSet({ [K_USERS]: this.ctx.userMap })
        this.renderPreview()
      })
      return el('div', { style: { margin: '4px 0' } }, [el('code', { text: who }), ' → ', sel])
    }
    if (preview.otherGroup?.length) {
      // Names not in this journal: usually the other subgroup, but a differently written name lands here too — let it be fixed
      box.append(el('details', { style: { color: '#555', marginTop: '8px' } }, [
        el('summary', { text: `${preview.otherGroup.length} õpilast pole selles päevikus (teine rühm?) — jäetakse vahele. Kui keegi on siiski siit, vali nimi.` }),
        ...preview.otherGroup.map(userSelect)
      ]))
    }
    if (preview.unmatchedUsers.length) {
      box.append(el('div', { text: 'Õpilased, keda Tahvlis ei leitud', style: { fontWeight: 600, marginTop: '8px' } }))
      for (const who of preview.unmatchedUsers) {
        box.append(userSelect(who))
      }
    }
    return box
  }

  /** journalEntriesByDate may omit content/homework: read the full entries that assignments point to, so nothing is overwritten blindly. */
  async loadEntryTexts() {
    const { jid, entries, meta, journal } = this.ctx
    const ids = new Set()
    for (const [slug, info] of meta) {
      const id = (journal.assignmentMap || {})[slug] ?? matchEntryForAssignment(slug, entries, info, meta)?.id
      if (id != null && id !== -1) ids.add(String(id))
    }
    await Promise.all([...ids].map(async id => {
      try {
        const full = await this.api.tahvel.get(`/journals/${jid}/journalEntry/${id}`, {}, { cache: false })
        const e = entries.find(x => String(x.id) === id)
        if (e && full) Object.assign(e, { content: full.content ?? '', homework: full.homework ?? '', homeworkDuedate: full.homeworkDuedate ?? null })
      } catch (err) { Logger.warning(`[githubGrades] entry ${id} details: ${err.message}`) }
    }))
  }

  /** Two assignments on the same lesson → offer to create a separate entry for each extra one. */
  renderSharedSection() {
    const list = findSharedEntries({ entries: this.ctx.entries, meta: this.ctx.meta, assignmentMap: this.ctx.journal.assignmentMap || {} })
    if (!list.length) return null
    const box = el('div', { style: { marginTop: '14px', padding: '8px', background: '#fff8e6', border: '1px solid #f0c36d' } })
    box.append(el('div', { text: 'Mitu ülesannet samas tunnis — igaüks vajab oma sissekannet (muidu hinded põrkuvad). Tunni sisu ja kodutöö saad kirjutada pärast seda.', style: { fontWeight: 600 } }))
    const checks = []
    for (const n of list) {
      const cb = el('input', { type: 'checkbox', checked: true })
      checks.push([cb, n])
      box.append(el('label', { style: { display: 'block', margin: '4px 0' } }, [
        cb,
' Loo ',
el('strong', { text: `${n.entryDate.split('-').reverse().join('.')} Iseseisev töö "${n.name}"` }),
        el('span', { text: ` (tund jääb: ${n.keptBy})`, style: { color: '#555' } })
      ]))
    }
    box.append(el('button', {
      text: 'Loo sissekanded',
      style: { marginTop: '6px', padding: '6px 12px', fontWeight: 600 },
      onclick: () => this.createEntries(checks.filter(([cb]) => cb.checked).map(([, n]) => n))
    }))
    return box
  }

  async createEntries(list) {
    if (!list.length) { this.status('Midagi pole valitud.', true); return }
    const { jid } = this.ctx
    let done = 0
    try {
      let teachers = []
      try {
        const info = await this.api.tahvel.get(`/journals/${jid}`, {}, { cache: true, cacheExpiration: 36e5 })
        teachers = (info?.journalTeachers || []).slice(0, 1).map(t => String(t.id)).filter(t => t !== 'undefined')
      } catch { /* entry without teacher is still valid */ }
      for (const n of list) {
        this.status(`Loon sissekandeid… ${done}/${list.length}`)
        // Same payload shape as TahvelNewAssignmentSync (Kriit) uses for new independent-work entries
        await this.api.tahvel.post(`/journals/${jid}/journalEntry`, {
          startLessonNr: null,
lessons: null,
entryType: 'SISSEKANNE_I',
nameEt: n.name,
studyPeriodEvent: null,
          entryDate: `${n.entryDate}T00:00:00.000Z`,
content: n.name,
homework: n.homework || null,
          homeworkDuedate: n.homework ? n.homeworkDuedate : null,
journalOmoduleTheme: null,
          journalEntryStudents: [],
journalEntryCapacityTypes: ['MAHT_i'],
journalEntryTeachers: teachers
        }, { cache: false })
        done++
      }
      this.status(`Valmis: ${done} sissekannet loodud. Laen lehe uuesti…`)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      Logger.error('[githubGrades] create entries failed', e)
      this.status(`Viga pärast ${done} sissekannet: ${e.message}`, true)
    }
  }

  /** Lesson content + homework + due date from Classroom 50 assignments.json (metadata-only PUT, like JournalListSync). */
  renderTextSection() {
    const updates = buildEntryTextUpdates({ entries: this.ctx.entries, meta: this.ctx.meta, assignmentMap: this.ctx.journal.assignmentMap || {} })
    const box = el('div', { style: { marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #ddd' } })
    box.append(el('div', { text: 'Tunni sisu ja kodutöö (Classroom 50 Description + Due date)', style: { fontWeight: 600 } }))
    if (!updates.length) {
      box.append(el('div', { text: 'Kõik seotud sissekanded on juba ajakohased.', style: { color: '#555', marginTop: '4px' } }))
      return box
    }
    const short = t => (t && t.length > 70 ? `${t.slice(0, 70)}…` : t || '–')
    const checks = []
    for (const u of updates) {
      const cb = el('input', { type: 'checkbox', checked: u.selected })
      checks.push([cb, u])
      const what = [
        u.changes.content ? `sisu: ${short(u.changes.content)}` : null,
        u.changes.homeworkDuedate ? `tähtaeg: ${u.changes.homeworkDuedate.slice(0, 10).split('-').reverse().join('.')}` : null
      ].filter(Boolean).join(' · ')
      box.append(el('label', { style: { display: 'block', margin: '4px 0' } }, [
        cb,
' ',
el('strong', { text: u.entryName }),
` ← ${u.name}: ${what}`,
        u.overwrites ? el('span', { text: ` (asendab olemasoleva: "${short(u.current.content || u.current.homework)}")`, style: { color: '#b54708' } }) : null
      ]))
    }
    box.append(el('button', {
      text: 'Kirjuta sisu ja kodutööd Tahvlisse',
      style: { marginTop: '6px', padding: '6px 12px', fontWeight: 600 },
      onclick: () => this.applyTexts(checks.filter(([cb]) => cb.checked).map(([, u]) => u))
    }))
    return box
  }

  async applyTexts(list) {
    if (!list.length) { this.status('Midagi pole valitud.', true); return }
    const { jid } = this.ctx
    let done = 0
    try {
      for (const u of list) {
        this.status(`Kirjutan sisu… ${done}/${list.length}`)
        const entry = await this.api.tahvel.get(`/journals/${jid}/journalEntry/${u.entryId}`, {}, { cache: false })
        if (!entry) throw new Error(`Sissekannet ${u.entryId} ei saanud lugeda`)
        // Tahvel's metadata-only contract: journalEntryStudents must be [] (omitting → 500, resending rows → 412)
        const payload = { ...entry, ...u.changes, journalEntryStudents: [] }
        if (Array.isArray(payload.journalEntryTeachers)) payload.journalEntryTeachers = payload.journalEntryTeachers.map(t => String(t.id ?? t))
        await this.api.tahvel.put(`/journals/${jid}/journalEntry/${u.entryId}`, payload)
        done++
      }
      this.status(`Valmis: ${done} sissekannet uuendatud. Laen lehe uuesti…`)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      Logger.error('[githubGrades] apply texts failed', e)
      this.status(`Viga pärast ${done} sissekannet: ${e.message}`, true)
    }
  }

  /** One PUT per journal entry, sending only the students being changed (same contract JournalListSync uses). */
  async apply(rows) {
    if (!rows.length) { this.status('Midagi pole valitud.', true); return }
    const { jid } = this.ctx
    const byEntry = new Map()
    for (const r of rows) {
      if (!byEntry.has(r.entryId)) byEntry.set(r.entryId, [])
      byEntry.get(r.entryId).push(r)
    }
    let done = 0
    try {
      for (const [entryId, list] of byEntry) {
        this.status(`Kirjutan… ${done}/${rows.length}`)
        const entry = await this.api.tahvel.get(`/journals/${jid}/journalEntry/${entryId}`, { allStudents: true }, { cache: false })
        if (!entry || !Array.isArray(entry.journalEntryStudents)) throw new Error(`Sissekannet ${entryId} ei saanud lugeda`)
        const journalEntryStudents = list.map(r => {
          const grade = tahvelGrade(r.newGrade)
          const existing = entry.journalEntryStudents.find(js => String(js.journalStudent) === String(r.journalStudent))
          if (existing) return { ...existing, isMicro: existing.isMicro ?? false, grade, removeStudentHistory: true }
          return {
            id: null,
journalStudent: Number(r.journalStudent),
isMicro: false,
absence: null,
grade,
            verbalGrade: null,
removeStudentHistory: true,
addInfo: null,
isLessonAbsence: false,
            hasOverlappingLessonAbsence: false,
isPraise: false,
isRemark: false,
lessonAbsences: {},
            studentName: null,
studentGroup: null,
journalEntryStudentHistories: [],
            hasWholeDayAcceptedAbsence: false,
wholeDayAbsenceCode: null
          }
        })
        const payload = { ...entry, journalEntryStudents }
        if (Array.isArray(payload.journalEntryTeachers)) payload.journalEntryTeachers = payload.journalEntryTeachers.map(t => String(t.id ?? t))
        await this.api.tahvel.put(`/journals/${jid}/journalEntry/${entryId}`, payload)
        done += list.length
      }
      this.status(`Valmis: ${done} hinnet kirjutatud. Laen lehe uuesti…`)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      Logger.error('[githubGrades] apply failed', e)
      this.status(`Viga pärast ${done} hinnet: ${e.message}`, true)
    }
  }
}
