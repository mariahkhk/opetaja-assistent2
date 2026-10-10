/**
 * GitHub → Tahvel grades — pure helpers (no DOM, no chrome.*), unit tested.
 *
 * A teacher keeps a grades file in any GitHub repo. Supported formats:
 *   1) CSV or Markdown table, one row per (student, assignment):
 *        Ülesanne | Õpilane | GitHub | Punktid | Max | Hinne
 *      "Ülesanne" is required, plus "Õpilane" (name as in Tahvel) or "GitHub" (username),
 *      plus either "Hinne" (5,4,3,2,1,A,MA) or "Punktid" + "Max".
 *   2) Classroom 50 scores.json (schema classroom50/scores/v1); names come from roster.csv next to it.
 */

const GITHUB_API = 'https://api.github.com'

/** GitHub/Classroom 50 add-on version — shown in the popup and panel; bump with every patch. */
export const ADDON_VERSION = 'v26 (28.09.2026)'

/**
 * Network transport for GitHub requests: (url, init) → Promise<{ ok, status, text }>.
 * Default = window fetch; the extension swaps in a background-worker transport (no CORS / page restrictions).
 */
let transport = async(url, init = {}) => {
  const res = await fetch(url, init)
  return { ok: res.ok, status: res.status, text: await res.text() }
}
export function setGitHubTransport(fn) { transport = fn }
export function gitHubRequest(url, init) { return transport(url, init) }

export const DEFAULT_THRESHOLDS = { 5: 90, 4: 75, 3: 50, 2: 20 }

/** Lowercase, strip diacritics and extra whitespace — "Tõnu  Õun" → "tonu oun" */
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Order-independent name key: "Mets Mari" and "Mari Mets" → "mari mets" */
export function nameKey(s) {
  return normalizeName(s).split(' ').filter(Boolean).sort().join(' ')
}

/** CSV (comma or semicolon, quotes, CRLF) → array of rows (arrays). */
function csvRows(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] || ''
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim() !== ''))
}

/** Markdown table → array of rows (arrays); separator row dropped. */
function markdownRows(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim())
    .filter(l => l.startsWith('|') && !/^\|?[\s:|-]+\|?$/.test(l))
    .map(l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim().replace(/^`|`$/g, '')))
}

/**
 * CSV or Markdown table → array of objects. Headers go through `keyOf` (default: normalized header).
 */
export function parseTable(text, keyOf = normalizeName) {
  const isMd = /^\s*\|/m.test(String(text || ''))
  const rows = isMd ? markdownRows(text) : csvRows(text)
  if (!rows.length) return []
  const headers = rows[0].map(h => keyOf(h.trim()))
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])))
}

/** Backwards-compatible name */
export const parseCsv = text => parseTable(text, h => h.toLowerCase())

const GRADE_COLUMNS = {
  assignment: /^(ulesanne|assignment|too|sissekanne|task)$/,
  name: /^(opilane|nimi|name|student|opilase nimi)$/,
  username: /^(github|kasutaja|kasutajanimi|username|login|github kasutaja)$/,
  score: /^(punktid|punkte|score|points)$/,
  max: /^(max|maksimum|max score|max punktid|maxpunktid)$/,
  grade: /^(hinne|grade)$/
}

function gradeHeaderKey(h) {
  const n = normalizeName(h)
  for (const [key, re] of Object.entries(GRADE_COLUMNS)) if (re.test(n)) return key
  return n
}

/** Normalize a grade cell: '5', ' 4 ', 'A', 'ma', 'arvestatud' → '5' | '4' | 'A' | 'MA'; else null */
export function normalizeGrade(v) {
  const n = normalizeName(v)
  if (/^[1-5]$/.test(n)) return n
  if (/^(a|arvestatud|passed)$/.test(n)) return 'A'
  if (/^(ma|mittearvestatud|failed)$/.test(n)) return 'MA'
  return null
}

const toNumber = v => {
  if (v == null || String(v).trim() === '') return NaN
  return Number(String(v).replace(',', '.'))
}

/**
 * Parse a grades file into records:
 *   { assignment, username|null, name|null, score, max, grade|null, late, warning }
 */
export function parseGradesFile(text, path = '') {
  const trimmed = String(text || '').trim()
  if (/\.json$/i.test(path) || trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed)
    if (json && json.schema === 'classroom50/scores/v1') return latestScores(json)
    throw new Error('Tundmatu JSON: oodati Classroom 50 scores.json faili')
  }
  return parseTable(trimmed, gradeHeaderKey)
    .filter(r => r.assignment && (r.name || r.username))
    .map(r => ({
      assignment: r.assignment,
      username: r.username ? r.username.replace(/^@/, '').toLowerCase() : null,
      name: r.name || null,
      score: toNumber(r.score),
      max: toNumber(r.max),
      grade: normalizeGrade(r.grade),
      late: false,
      warning: null
    }))
}

/** Classroom 50 scores.json → latest submission per (assignment, member). */
export function latestScores(scores) {
  const out = []
  const assignments = scores && scores.assignments ? scores.assignments : {}
  for (const [slug, bucket] of Object.entries(assignments)) {
    for (const entry of bucket.entries || []) {
      const latest = (entry.submissions || [])[0]
      if (!latest) continue
      const members = Array.isArray(entry.member_usernames) && entry.member_usernames.length
        ? entry.member_usernames
        : [entry.owner]
      for (const username of members) {
        out.push({
          assignment: slug,
          username: String(username).toLowerCase(),
          name: null,
          score: Number(latest.score),
          max: Number(latest['max-score']),
          grade: null,
          late: latest.late === true,
          warning: latest.provenance_warning || null
        })
      }
    }
  }
  return out
}

/** roster.csv (Classroom 50) → Map(usernameLower → display name) */
export function rosterNames(rosterRows) {
  const map = new Map()
  for (const r of rosterRows || []) {
    const username = (r.username || r.github || '').toLowerCase()
    if (!username) continue
    const full = r.name || r.nimi || [r.first_name, r.last_name].filter(Boolean).join(' ')
    if (full) map.set(username, full)
  }
  return map
}

/** Percent → Tahvel grade value: '5'..'1' or 'A'/'MA' */
export function percentToGrade(percent, mode = '5', thresholds = DEFAULT_THRESHOLDS) {
  if (!Number.isFinite(percent)) return null
  if (mode === 'AMA') return percent >= (thresholds[3] ?? 50) ? 'A' : 'MA'
  for (const g of [5, 4, 3, 2]) {
    if (percent >= thresholds[g]) return String(g)
  }
  return '1'
}

/** Tahvel grade object for a grade value ('1'..'5', 'A', 'MA') */
export function tahvelGrade(value) {
  const names = {
    5: ['Väga hea', 'Very good'],
4: ['Hea', 'Good'],
3: ['Rahuldav', 'Satisfactory'],
    2: ['Puudulik', 'Insufficient'],
1: ['Nõrk', 'Weak'],
A: ['Arvestatud', 'Passed'],
MA: ['Mittearvestatud', 'Failed']
  }
  const v = String(value)
  if (!names[v]) return null
  return {
    code: `KUTSEHINDAMINE_${v}`,
    gradingSchemaRowId: null,
    value: v,
    value2: v.toLowerCase(),
    extraval1: null,
    extraval2: null,
    nameEt: names[v][0],
    nameEn: names[v][1],
    valid: true
  }
}

/** Current grade value of a journalEntryStudents row, e.g. 'KUTSEHINDAMINE_4' → '4' */
export function gradeValueOf(row) {
  const g = row && row.grade
  if (!g) return null
  if (typeof g === 'string') return g.replace(/^KUTSEHINDAMINE_/, '')
  if (g.code) return String(g.code).replace(/^KUTSEHINDAMINE_/, '')
  return g.value ? String(g.value) : null
}

/** ISO instant → 'YYYY-MM-DD' in Estonian time */
export function tallinnDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/**
 * Find the Tahvel journal entry for an assignment.
 * 1) tag "gh:<assignment>" (or legacy "c50:<assignment>") in the entry name or content
 * 2) entry name equals the assignment slug (dashes = spaces) or its title (meta.name, from Classroom 50 assignments.json)
 * 3) date window from assignments.json: first entry between available_from and due,
 *    preferring practical work (SISSEKANNE_P) and independent work (SISSEKANNE_I) over plain lessons
 */
/** "gh:<slug>" / "c50:<slug>" as a whole tag — "gh:lab10" must not count as "gh:lab1" */
function hasTag(text, slug) {
  const esc = String(slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\w-])(?:gh|c50):${esc}(?![\\w-])`, 'i').test(String(text || '')) // eslint-disable-line security/detect-non-literal-regexp -- slug is regex-escaped above
}

/** Entry explicitly claimed by an assignment: "gh:<slug>"/"c50:<slug>" tag, or entry name = slug / assignment name */
function claimsEntry(slug, info, e) {
  if (hasTag(`${e.nameEt || ''} ${e.content || ''}`, slug)) return true
  const targets = [normalizeName(String(slug).replace(/-/g, ' ')), normalizeName(info?.name)].filter(Boolean)
  return targets.includes(normalizeName(e.nameEt))
}

export function matchEntryForAssignment(assignment, entries, meta = null, allMeta = null) {
  const list = entries || []
  const tagged = list.find(e => hasTag(`${e.nameEt || ''} ${e.content || ''}`, assignment))
  if (tagged) return tagged
  const targets = [normalizeName(String(assignment).replace(/-/g, ' ')), normalizeName(meta?.name)].filter(Boolean)
  const byName = list.find(e => targets.includes(normalizeName(e.nameEt)))
  if (byName) return byName
  if (meta && (meta.available_from || meta.due)) {
    const from = tallinnDate(meta.available_from) || '0000-00-00'
    const to = tallinnDate(meta.due) || '9999-99-99'
    // An entry named after (or tagged with) another assignment belongs to that one — don't take it by date
    const others = allMeta ? [...allMeta].filter(([slug]) => slug !== assignment) : []
    const inWindow = list
      .filter(e => e.entryDate && e.entryDate.slice(0, 10) >= from && e.entryDate.slice(0, 10) <= to)
      .filter(e => !others.some(([slug, info]) => claimsEntry(slug, info, e)))
      .sort((x, y) => x.entryDate.localeCompare(y.entryDate))
    const rank = e => (e.entryType === 'SISSEKANNE_P' ? 0 : e.entryType === 'SISSEKANNE_I' ? 1 : 2)
    return [...inWindow].sort((x, y) => rank(x) - rank(y))[0] || null
  }
  return null
}

/**
 * Assignments that landed in the same Tahvel entry only by date (e.g. two labs released the same day).
 * One keeps the entry (autograded first, then the one whose text is already there); the others get a
 * proposal for their own new entry named after the assignment, so each lab gets its own grade column.
 */
/**
 * Standard description format (same for every course):
 *   Teooria: <topic> — <link>      ← lesson content only
 *   Praktikum: <what to do> — <link> ← lesson content + homework
 * Lines starting with "Teooria:" / "Loeng:" never go into homework.
 */
export function homeworkPart(description) {
  return String(description || '').split('\n').filter(l => !/^\s*(teooria|loeng)\s*:/i.test(l)).join('\n').trim()
}

export function findSharedEntries({ entries, meta = new Map(), assignmentMap = {} }) {
  const groups = new Map()
  for (const [slug, info] of meta) {
    if (assignmentMap[slug] != null) continue
    const e = matchEntryForAssignment(slug, entries, info, meta)
    if (!e || claimsEntry(slug, info, e)) continue
    if (!groups.has(e.id)) groups.set(e.id, { entry: e, items: [] })
    groups.get(e.id).items.push({ slug, info })
  }
  const out = []
  for (const { entry, items } of groups.values()) {
    if (items.length < 2) continue
    // Same decision in every journal (gr1, gr2 …): autograded lab keeps the lesson, group work moves out, then by name — never by what's in Tahvel now
    const isGroup = it => /grupit[öo]{2}|group/i.test(`${it.slug} ${it.info.name || ''}`)
    items.sort((x, y) => (y.info.autograded - x.info.autograded) || (isGroup(x) - isGroup(y)) ||
      String(x.info.name || x.slug).localeCompare(String(y.info.name || y.slug), 'et'))
    for (const it of items.slice(1)) {
      out.push({
        slug: it.slug,
name: it.info.name || it.slug,
keptBy: items[0].info.name || items[0].slug,
        entryDate: (entry.entryDate || '').slice(0, 10) || tallinnDate(it.info.available_from),
        homework: homeworkPart(it.info.description),
        homeworkDuedate: it.info.due ? tahvelDueDate(it.info.due) : null
      })
    }
  }
  return out
}

/**
 * Readable text for Tahvel: one sentence per line, "Juhend:"/links on their own line.
 * Line breaks the teacher put in the description are kept.
 */
export function formatDescription(text) {
  if (!text) return text
  return String(text).split('\n').map(line => line
    .replace(/\s+(Juhend|Link|Esita|Esitage|Tähtaeg)\s*:/g, '\n$1:')
    .replace(/([.!?])\s+(?=[A-ZÕÄÖÜŠŽ0-9"„(])/g, '$1\n')
    .replace(/\s+(https?:\/\/\S+)$/g, (m, u, off, str) => (/[:—–-]\s*$/.test(str.slice(0, off)) ? ` ${u}` : `\n${u}`))
  ).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Classroom 50 assignments.json → Map(slug → { name, description, due, available_from }) */
export function assignmentMeta(json) {
  const map = new Map()
  for (const a of (json && json.assignments) || []) {
    if (!a || !a.slug) continue
    // Only autograded assignments produce scores; others (no_autograder / empty_repo / grading off|manual) never count as "missing"
    const autograded = !a.no_autograder && !a.empty_repo && !['off', 'manual'].includes(a.grading?.mode)
    map.set(a.slug, {
      name: a.name,
      description: formatDescription(a.description),
      rawDescription: a.description,
      due: a.due,
      available_from: a.available_from,
      autograded
    })
  }
  return map
}

/** Tahvel journalStudents row → display name */
export function tahvelStudentName(s) {
  if (!s) return ''
  const src = s.student || s
  return src.fullname || [src.firstname, src.lastname].filter(Boolean).join(' ') || s.studentName || ''
}

/** Grading scale already used in a journal entry: 'AMA' if it has A/MA grades, '5' if numeric, else null. */
export function entryMode(entry) {
  const values = (entry?.journalEntryStudents || []).map(gradeValueOf).filter(Boolean)
  if (values.some(v => v === 'A' || v === 'MA')) return 'AMA'
  if (values.some(v => /^[1-5]$/.test(v))) return '5'
  return null
}

/**
 * Build the preview rows from parsed records.
 * @returns {{rows: Array, unmatchedUsers: string[], unmatchedAssignments: string[], otherGroup: string[]}}
 */
/** mode: '5' | 'AMA' = teacher's explicit choice; empty = follow the grades already in each entry */
/**
 * missingGrade: '' (off) | '2' | '1' — grade for journal students with NO submission once the due date
 * (assignments.json `due`) has passed. On an A/MA scale it becomes 'MA'. `now` is injectable for tests.
 */
/**
 * Name written slightly differently ("Mari Mets" ↔ "Mari-Liis Mets", missing middle name):
 * same last name and one first name starts with the other — only when exactly one journal student fits.
 */
export function fuzzyStudent(name, students) {
  const parts = normalizeName(name).split(' ').filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  const first = parts[0]
  const hits = (students || []).filter(s => {
    const p = normalizeName(tahvelStudentName(s)).split(' ').filter(Boolean)
    if (p.length < 2 || p[p.length - 1] !== last) return false
    return p[0].startsWith(first) || first.startsWith(p[0])
  })
  return hits.length === 1 ? hits[0] : null
}

export function buildPreview({ records, roster = [], entries, students, assignmentMap = {}, userMap = {}, mode = '', thresholds = DEFAULT_THRESHOLDS, meta = new Map(), missingGrade = '', now = new Date() }) {
  const names = rosterNames(roster)
  const byKey = new Map()
  for (const s of students || []) byKey.set(nameKey(tahvelStudentName(s)), s)

  const rows = []
  const unresolved = new Map() // assignment → count of records not tied to a journal student
  const unmatchedUsers = new Set()
  const unmatchedAssignments = new Set()
  const otherGroup = new Set()

  for (const r of records || []) {
    const entryId = assignmentMap[r.assignment] ?? matchEntryForAssignment(r.assignment, entries, meta.get(r.assignment), meta)?.id
    const entry = entryId != null ? (entries || []).find(e => String(e.id) === String(entryId)) : null
    if (!entry) { unmatchedAssignments.add(r.assignment); continue }

    const who = r.username || r.name
    const displayName = (r.username && userMap[r.username]) || userMap[who] || r.name || (r.username && names.get(r.username)) || ''
    const student = byKey.get(nameKey(displayName)) || fuzzyStudent(displayName, students)
    if (!student) {
      // Known by name (roster/file) but not in this journal → other subgroup of a shared classroom; skip quietly
      unresolved.set(r.assignment, (unresolved.get(r.assignment) || 0) + 1)
      if (displayName && !userMap[who]) { otherGroup.add(who); continue }
      unmatchedUsers.add(who); continue
    }

    const percent = r.max > 0 ? (r.score / r.max) * 100 : NaN
    const newGrade = r.grade || percentToGrade(percent, mode || entryMode(entry) || '5', thresholds)
    const existingRow = (entry.journalEntryStudents || []).find(js => String(js.journalStudent) === String(student.id))
    const currentGrade = gradeValueOf(existingRow)

    rows.push({
      assignment: r.assignment,
      who,
      entryId: entry.id,
      entryName: `${(entry.entryDate || '').slice(0, 10).split('-').reverse().join('.')} ${entry.nameEt || r.assignment}`.trim(),
      journalStudent: student.id,
      studentName: tahvelStudentName(student),
      score: Number.isFinite(r.score) ? r.score : null,
      max: Number.isFinite(r.max) ? r.max : null,
      percent: Number.isFinite(percent) ? Math.round(percent) : null,
      late: r.late,
      warning: r.warning,
      currentGrade,
      newGrade,
      changed: newGrade != null && newGrade !== currentGrade
    })
  }
  // Past-due assignments: students in this journal with no submission get the "missing" grade
  if (missingGrade) {
    const assignments = [...new Set([...(records || []).map(r => r.assignment), ...meta.keys()])]
    const active = (students || []).filter(s => !/OPPURSTAATUS_[KL]$/.test(String(s.status || s.student?.status || '')))
    for (const assignment of assignments) {
      const info = meta.get(assignment)
      const due = info?.due
      if (!due || new Date(due) > now || info.autograded === false) continue
      const entryId = assignmentMap[assignment] ?? matchEntryForAssignment(assignment, entries, meta.get(assignment), meta)?.id
      const entry = entryId != null ? (entries || []).find(e => String(e.id) === String(entryId)) : null
      if (!entry) continue
      const submitted = new Set(rows.filter(r => r.assignment === assignment).map(r => String(r.journalStudent)))
      const scale = mode || entryMode(entry) || '5'
      const newGrade = scale === 'AMA' ? 'MA' : missingGrade
      for (const st of active) {
        if (submitted.has(String(st.id))) continue
        const existingRow = (entry.journalEntryStudents || []).find(js => String(js.journalStudent) === String(st.id))
        const currentGrade = gradeValueOf(existingRow)
        rows.push({
          assignment,
who: tahvelStudentName(st),
entryId: entry.id,
          entryName: `${(entry.entryDate || '').slice(0, 10).split('-').reverse().join('.')} ${entry.nameEt || assignment}`.trim(),
          journalStudent: st.id,
studentName: tahvelStudentName(st),
          score: null,
max: null,
percent: null,
late: false,
missing: true,
          // Someone's submission could not be tied to a name — this student may have submitted: never pre-tick
          uncertain: unresolved.has(assignment),
          warning: unresolved.has(assignment) ? 'kontrolli: mõnda esitust ei seotud nimega' : null,
          currentGrade,
newGrade,
changed: newGrade !== currentGrade
        })
      }
    }
  }

  // Two assignments pointing at the same entry for the same student can't both be written — flag them
  const seen = new Map()
  for (const r of rows) {
    const key = `${r.entryId}:${r.journalStudent}`
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  for (const r of rows) {
    if (seen.get(`${r.entryId}:${r.journalStudent}`) > 1) { r.conflict = true; r.changed = false }
  }
  rows.sort((a, b) => a.entryName.localeCompare(b.entryName, 'et') || a.studentName.localeCompare(b.studentName, 'et'))
  return { rows, unmatchedUsers: [...unmatchedUsers].sort(), unmatchedAssignments: [...unmatchedAssignments].sort(), otherGroup: [...otherGroup].sort() }
}

/**
 * Shared school table: which Tahvel journal reads which GitHub file.
 *
 * | Päevik ID | Päevik | Rühm | Repo | Fail | Hindamine |
 * | 123456 | Automatiseerimine | IT-24 | my-org/hinded | it24/hinded.csv | 5 |
 */
export function parseJournalTable(md) {
  const keyOf = h => {
    const n = normalizeName(h)
    if (/^(paevik id|journal id|id)$/.test(n)) return 'id'
    if (/^(paevik|journal|aine)$/.test(n)) return 'name'
    if (/^(ruhm|opperuhm|group)$/.test(n)) return 'group'
    if (/^(repo|repositoorium|repository)$/.test(n)) return 'repo'
    if (/^(fail|file|path|tee)$/.test(n)) return 'file'
    if (/^(hindamine|mode|grading)$/.test(n)) return 'mode'
    return n
  }
  return parseTable(md, keyOf).filter(r => r.repo && r.repo.includes('/') && r.file)
}

/** Pick the table row for this journal. journal = { id, name, groupsText } */
export function findJournalConfig(rows, journal) {
  const id = String(journal.id || '')
  const byId = (rows || []).find(r => r.id && String(r.id).trim() === id)
  if (byId) return byId
  const name = normalizeName(journal.name)
  const groups = normalizeName(journal.groupsText)
  return (rows || []).find(r => !r.id && r.name && normalizeName(r.name) === name &&
    (!r.group || groups.includes(normalizeName(r.group)))) || null
}

/** github.com/.../blob/... → raw.githubusercontent.com/... (other URLs unchanged) */
export function toRawUrl(url) {
  const m = String(url || '').trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : String(url || '').trim()
}

/** 'AMA', 'A/MA', 'mitteeristav' → 'AMA'; anything else → '5' */
export function normalizeMode(v) {
  const n = normalizeName(v)
  return /^(ama|a ma|mitteeristav|arvestus)$/.test(n) ? 'AMA' : '5'
}

/** "owner/repo" → { owner, repo } */
export function splitRepo(repo) {
  const [owner, name] = String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').split('/')
  return { owner: owner || '', repo: name || '' }
}

/**
 * Fetch a file from a GitHub repo (default branch).
 * With a token: GitHub API (works for private repos). Without: raw.githubusercontent.com (public repos only).
 * Returns null when the file does not exist.
 */
export async function fetchRepoFile({ repo, path, token }) {
  const { owner, repo: name } = splitRepo(repo)
  const cleanPath = String(path || '').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
  const res = token
    ? await transport(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${cleanPath}`, {
      headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store'
    })
    : await transport(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/HEAD/${cleanPath}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (res.status === 401) throw new Error('GitHub 401: token on vale või aegunud — uuenda tokenit popupis')
  if (res.status === 403) throw new Error(`GitHub 403: tokenil pole ligipääsu repole ${repo}`)
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${repo}/${path}`)
  return res.text
}

/** Classroom 50 only: trigger the collect-scores workflow (token needs Actions: write). */
export async function triggerCollectScores({ repo, token, classroom, ref = 'main' }) {
  const { owner, repo: name } = splitRepo(repo)
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/collect-scores.yaml/dispatches`
  const res = await transport(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref, inputs: classroom ? { classroom } : {} })
  })
  if (res.status !== 204) throw new Error(`GitHub ${res.status}: collect-scores käivitamine ebaõnnestus`)
}

/** "IT-24" → "it24" (group code as used at the start of Classroom 50 classroom names) */
export function groupKey(code) {
  return normalizeName(code).replace(/ /g, '')
}

/**
 * Pick the Classroom 50 classroom folder for a journal.
 * Folder names start with the group code: "it24-automatiseerimine" ↔ Tahvel group "IT-24".
 * When several folders share the group, the one sharing most words with the journal name wins.
 * Returns the folder name or null.
 */
export function pickClassroom(dirs, groupCodes, journalName = '') {
  const groups = new Set((groupCodes || []).map(groupKey).filter(Boolean))
  const candidates = (dirs || []).filter(d => groups.has(groupKey(String(d).split('-')[0])))
  if (candidates.length <= 1) return candidates[0] || null
  const words = new Set(normalizeName(journalName).split(' ').filter(w => w.length > 2))
  const score = d => normalizeName(d.replace(/-/g, ' ')).split(' ').filter(w => [...words].some(j => j.startsWith(w.slice(0, 5)) || w.startsWith(j.slice(0, 5)))).length
  const ranked = [...candidates].sort((a, b) => score(b) - score(a))
  // Several courses for the same group: pick only a clear winner by journal name, never a guess
  return score(ranked[0]) > 0 && score(ranked[0]) > score(ranked[1]) ? ranked[0] : null
}

/** List folder names in a repo's root (needs a token for private repos). */
export async function listRepoDirs({ repo, token }) {
  const { owner, repo: name } = splitRepo(repo)
  const res = await transport(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store'
  })
  if (!res.ok) {
    const dirs = []
    dirs.error = res.status === 404 ? 'token ei näe repot classroom50 (tokeni Repository access)' : res.status === 401 ? 'token ei kehti' : `GitHub ${res.status}`
    return dirs
  }
  const items = JSON.parse(res.text || '[]')
  return Array.isArray(items) ? items.filter(i => i.type === 'dir' && !i.name.startsWith('.')).map(i => i.name) : []
}

/** Tahvel homework due date: Estonian calendar day in the datetime shape Tahvel/Kriit use (…T23:59:59.000Z) */
export function tahvelDueDate(iso) {
  const day = tallinnDate(iso)
  return day ? `${day}T23:59:59.000Z` : null
}

/**
 * Lesson text from Classroom 50 assignments.json → Tahvel entry fields.
 * For every assignment linked to an entry: content (sisu) = description, homework = description, homeworkDuedate = due.
 * `selected` defaults to true only where Tahvel is still empty or already identical — existing texts are not overwritten silently.
 */
export function buildEntryTextUpdates({ entries, meta = new Map(), assignmentMap = {} }) {
  // Group assignments by the Tahvel entry they belong to — two labs on the same day share one entry,
  // so their texts are combined instead of the second overwriting the first
  const byEntry = new Map()
  for (const [slug, info] of meta) {
    if (!info.description) continue
    const entryId = assignmentMap[slug] ?? matchEntryForAssignment(slug, entries, info, meta)?.id
    const entry = entryId != null ? (entries || []).find(e => String(e.id) === String(entryId)) : null
    if (!entry) continue
    if (!byEntry.has(entry.id)) byEntry.set(entry.id, { entry, items: [], extra: [] })
    byEntry.get(entry.id).items.push({ slug, info })
  }
  // A lab split off into its own independent-work entry is still done in that day's lesson:
  // describe it in the lesson's content too (homework + due date stay in its own entry)
  for (const g of byEntry.values()) {
    if (g.entry.entryType !== 'SISSEKANNE_I') continue
    const day = (g.entry.entryDate || '').slice(0, 10)
    const lesson = [...byEntry.values()].find(o => o !== g && o.entry.entryType !== 'SISSEKANNE_I' && (o.entry.entryDate || '').slice(0, 10) === day)
    if (lesson) lesson.extra.push(...g.items)
  }
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out = []
  for (const { entry, items, extra } of byEntry.values()) {
    items.sort((a, b) => String(a.info.name || a.slug).localeCompare(String(b.info.name || b.slug), 'et'))
    const multi = items.length > 1
    const hw = items.map(it => (multi ? `${it.info.name || it.slug}\n` : '') + homeworkPart(it.info.description)).filter(t => t.trim()).join('\n\n')
    // Keep linking tags ("gh:<slug>") the teacher put in the entry, so the link survives the new text
    const tags = items.map(it => (String(entry.content || '').match(new RegExp(`\\b(?:gh|c50):${esc(it.slug)}\\b`, 'i')) || [])[0]).filter(Boolean) // eslint-disable-line security/detect-non-literal-regexp -- slug is regex-escaped
    const all = [...items, ...extra].sort((a, b) => String(a.info.name || a.slug).localeCompare(String(b.info.name || b.slug), 'et'))
    // Tahvel: "Sisu" = what the lesson was about (lab names + any Teooria: line), "Kodutöö" = the task text itself
    const theory = it => String(it.info.description || '').split('\n').filter(l => /^\s*(teooria|loeng)\s*:/i.test(l)).join('\n')
    // Lab names first, then each different Teooria line once (two labs of the same lesson usually share the theory)
    const body = [...all.map(it => it.info.name || it.slug), ...new Set(all.flatMap(it => theory(it).split('\n')).filter(Boolean))].join('\n')
    const text = [body, ...tags].join('\n')
    const dues = items.map(it => it.info.due).filter(Boolean).sort()
    const due = dues.length ? tahvelDueDate(dues[dues.length - 1]) : null
    // Tahvel may hand text back with \r\n or trailing spaces — compare normalized, or the same text is offered again forever
    const norm = t => String(t || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim()
    const cur = { content: norm(entry.content), homework: norm(entry.homework), due: entry.homeworkDuedate ? String(entry.homeworkDuedate).slice(0, 10) : '' }
    // Keep what the teacher wrote (e.g. the lecture topic): strip only our own earlier lab texts and tags, then append the labs
    // Our earlier texts in every shape we have ever written them (old one-line versions included)
    const ours = [...meta].flatMap(([, i]) => [i.description, i.rawDescription].filter(Boolean).flatMap(d => {
      const t = String(d).trim(); const h = homeworkPart(t); const n = i.name || ''
      return [`${n}: ${t}`, `${n}\n${t}`, t, `${n}: ${h}`, `${n}\n${h}`, h]
    })).filter(x => x && x.trim()).sort((a, b) => b.length - a.length)
    const names = new Set([...meta].map(([slug, i]) => String(i.name || slug).trim().toLowerCase()))
    const isTheory = l => /^\s*(teooria|loeng)\s*:/i.test(l)
    // Teooria lines that are literally in one of the descriptions are ours wherever they stand
    const ourTheory = new Set([...meta].flatMap(([, i]) => [i.description, i.rawDescription]).filter(Boolean)
      .flatMap(d => String(d).split('\n')).filter(isTheory).map(l => l.trim().toLowerCase()))
    // Our block in "Sisu" = lab-name lines followed by their Teooria lines. Only that block is replaced;
    // Teooria/Loeng lines the teacher wrote elsewhere stay.
    const keep = t => {
      let r = t
      for (const o of ours) r = r.split(o).join('')
      for (const tag of tags) r = r.replace(new RegExp(esc(tag), 'gi'), '') // eslint-disable-line security/detect-non-literal-regexp -- tag is regex-escaped
      const out = []
      let inOurs = false
      for (const l of r.split('\n')) {
        if (names.has(l.trim().toLowerCase())) { inOurs = true; continue }
        if ((inOurs && isTheory(l)) || ourTheory.has(l.trim().toLowerCase())) continue
        inOurs = false
        out.push(l.trimEnd())
      }
      return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    }
    const newContent = [keep(cur.content), text].filter(Boolean).join('\n\n')
    // Kodutöö = the current description. Old text is replaced only when it is ours: empty, a known description,
    // the same Juhend link, or the lesson already carries our lab-name block. Anything else is the teacher's → ask.
    const urls = hw.match(/https?:\/\/\S+/g) || []
    const hwOurs = !cur.homework || !keep(cur.homework) || urls.some(u => cur.homework.includes(u)) ||
      cur.content.split('\n').some(l => names.has(l.trim().toLowerCase()))
    const newHomework = hw ? (hwOurs ? hw : [cur.homework, hw].join('\n\n')) : cur.homework
    const changes = {}
    if (cur.content !== newContent) changes.content = newContent
    if (cur.homework !== newHomework) changes.homework = newHomework
    // A due date without any homework text makes no sense in Tahvel — only set it when there is (or will be) homework
    if (due && (hw || cur.homework) && cur.due !== due.slice(0, 10)) changes.homeworkDuedate = due
    if (!Object.keys(changes).length) continue
    const overwrites = !!changes.homework && !hwOurs
    out.push({
      slug: items.map(it => it.slug).join(', '),
name: items.map(it => it.info.name || it.slug).join(' + '),
entryId: entry.id,
      entryName: `${(entry.entryDate || '').slice(0, 10).split('-').reverse().join('.')} ${entry.nameEt || ''}`.trim(),
      changes,
current: cur,
overwrites: !!overwrites,
selected: !overwrites
    })
  }
  return out.sort((a, b) => a.entryName.localeCompare(b.entryName, 'et'))
}
