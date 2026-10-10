import { describe, expect, test } from 'bun:test'
import { fuzzyStudent, formatDescription, findSharedEntries, homeworkPart,
  buildPreview, findJournalConfig, latestScores, matchEntryForAssignment, nameKey, normalizeGrade, normalizeMode,
  parseCsv, parseGradesFile, parseJournalTable, percentToGrade, splitRepo, tahvelGrade, toRawUrl,
  groupKey, pickClassroom, entryMode, assignmentMeta, tallinnDate, buildEntryTextUpdates, tahvelDueDate
} from '../../src/lib/githubGrades.js'

const students = [
  { id: 101, fullname: 'Mets Mari' },
  { id: 102, firstname: 'Juhan', lastname: 'Võsa' }
]
const entries = [
  { id: 1, nameEt: 'Linux alused', journalEntryStudents: [{ journalStudent: 102, grade: { code: 'KUTSEHINDAMINE_2' } }] },
  { id: 2, nameEt: 'Rühmatöö', content: 'gh:git-grupp', journalEntryStudents: [] },
  { id: 3, nameEt: 'Vana', content: 'c50:vana-too', journalEntryStudents: [] }
]

describe('generic grades file', () => {
  const csv = 'Ülesanne;Õpilane;GitHub;Punktid;Max;Hinne\r\nlinux-alused;Mari Mets;@MariMets;8,5;10;\nlinux-alused;;juhanv;2;10;\ngit-grupp;Juhan Võsa;;;;A\ntühi;;;;;\n'
  const md = '| Ülesanne | Õpilane | Hinne |\n|---|---|---|\n| git-grupp | Mari Mets | 4 |\n'

  test('CSV with semicolons, decimal comma, @username', () => {
    const r = parseGradesFile(csv, 'hinded.csv')
    expect(r.length).toBe(3)
    expect(r[0]).toMatchObject({ assignment: 'linux-alused', name: 'Mari Mets', username: 'marimets', score: 8.5, max: 10, grade: null })
    expect(r[2]).toMatchObject({ grade: 'A', name: 'Juhan Võsa' })
  })

  test('Markdown table', () => {
    expect(parseGradesFile(md, 'hinded.md')).toEqual([
      { assignment: 'git-grupp', username: null, name: 'Mari Mets', score: NaN, max: NaN, grade: '4', late: false, warning: null }
    ])
  })

  test('preview: name match, username via dropdown map, direct grade', () => {
    const records = parseGradesFile(csv, 'hinded.csv')
    const p = buildPreview({ records, entries, students })
    expect(p.unmatchedUsers).toEqual(['juhanv'])
    expect(p.rows.find(r => r.entryId === 1 && r.journalStudent === 101)).toMatchObject({ newGrade: '4', changed: true })
    expect(p.rows.find(r => r.entryId === 2)).toMatchObject({ newGrade: 'A', journalStudent: 102 })
    const fixed = buildPreview({ records, entries, students, userMap: { juhanv: 'Juhan Võsa' } })
    expect(fixed.rows.find(r => r.entryId === 1 && r.journalStudent === 102)).toMatchObject({ currentGrade: '2', newGrade: '2', changed: false })
  })
})

describe('Classroom 50 scores.json', () => {
  const sub = (score, max, extra = {}) => ({ submission: 'submit/1', datetime: '2026-09-20T10:00:00Z', score, 'max-score': max, tests: [], ...extra })
  const scores = {
    schema: 'classroom50/scores/v1',
    assignments: {
      'linux-alused': { type: 'individual', entries: [{ owner: 'marimets', submissions: [sub(9, 10), sub(3, 10)] }] },
      'git-grupp': { type: 'group', entries: [{ owner: 'marimets', member_usernames: ['marimets', 'juhanv'], submissions: [sub(15, 20, { late: true })] }] }
    }
  }
  const roster = parseCsv('username,first_name,last_name\nmarimets,Mari,Mets\njuhanv,Juhan,Võsa\n')

  test('latest submission, group members credited', () => {
    const r = latestScores(scores)
    expect(r.find(x => x.assignment === 'linux-alused').score).toBe(9)
    expect(r.filter(x => x.assignment === 'git-grupp').map(x => x.username)).toEqual(['marimets', 'juhanv'])
  })

  test('preview with roster names', () => {
    const records = parseGradesFile(JSON.stringify(scores), 'it24/scores.json')
    const p = buildPreview({ records, roster, entries, students })
    expect(p.unmatchedUsers).toEqual([])
    expect(p.rows.filter(r => r.entryId === 2).map(r => r.newGrade)).toEqual(['4', '4'])
    expect(p.rows.find(r => r.entryId === 2).late).toBe(true)
  })
})

describe('helpers', () => {
  test('grades', () => {
    expect(percentToGrade(90)).toBe('5')
    expect(percentToGrade(49)).toBe('2')
    expect(percentToGrade(10)).toBe('1')
    expect(percentToGrade(50, 'AMA')).toBe('A')
    expect(normalizeGrade(' ma ')).toBe('MA')
    expect(normalizeGrade('Arvestatud')).toBe('A')
    expect(normalizeGrade('6')).toBeNull()
    expect(tahvelGrade('A')).toMatchObject({ code: 'KUTSEHINDAMINE_A', value2: 'a' })
  })
  test('entry matching: gh: tag, legacy c50: tag, same name', () => {
    expect(matchEntryForAssignment('git-grupp', entries).id).toBe(2)
    expect(matchEntryForAssignment('vana-too', entries).id).toBe(3)
    expect(matchEntryForAssignment('linux-alused', entries).id).toBe(1)
    expect(matchEntryForAssignment('puudub', entries)).toBeNull()
  })
  test('misc', () => {
    expect(nameKey('Võsa  Juhan')).toBe(nameKey('juhan vosa'))
    expect(splitRepo('https://github.com/hkhk-automation/hinded.git')).toEqual({ owner: 'hkhk-automation', repo: 'hinded' })
    expect(toRawUrl('https://github.com/a/b/blob/main/x.md')).toBe('https://raw.githubusercontent.com/a/b/main/x.md')
    expect(normalizeMode('A/MA')).toBe('AMA')
  })
})

describe('shared journal table', () => {
  const md = `| Päevik ID | Päevik | Rühm | Repo | Fail | Hindamine |
|---|---|---|---|---|---|
| 111 | Automatiseerimine | IT-24 | hkhk-automation/classroom50 | it24/scores.json | 5 |
|  | Automatiseerimine | ITS-25 | hkhk-automation/hinded | its25.csv | A/MA |
| 999 | Pooleli | | | | |
`
  const rows = parseJournalTable(md)
  test('parse + match', () => {
    expect(rows.length).toBe(2)
    expect(findJournalConfig(rows, { id: 111 }).file).toBe('it24/scores.json')
    expect(findJournalConfig(rows, { id: 5, name: 'automatiseerimine', groupsText: '["ITS-25"]' }).repo).toBe('hkhk-automation/hinded')
    expect(findJournalConfig(rows, { id: 7, name: 'Automatiseerimine', groupsText: 'IT-99' })).toBeNull()
  })
})

describe('Classroom 50 auto-detect', () => {
  const dirs = ['it24-automatiseerimine', 'its25-automatiseerimine', 'it24-monitooring', 'it26-avalused']
  test('group code picks the folder', () => {
    expect(pickClassroom(dirs, ['ITS-25'], 'Automatiseerimine')).toBe('its25-automatiseerimine')
    expect(pickClassroom(dirs, ['IT-26'], 'Arvutivõrkude alused-gr1')).toBe('it26-avalused')
  })
  test('journal name breaks ties within a group', () => {
    expect(pickClassroom(dirs, ['IT-24'], 'Automatiseerimine')).toBe('it24-automatiseerimine')
    expect(pickClassroom(dirs, ['IT-24'], 'Monitooring')).toBe('it24-monitooring')
  })
  test('no match', () => {
    expect(pickClassroom(dirs, ['IS1-26'], 'X')).toBeNull()
    expect(groupKey('IT-24')).toBe('it24')
  })
})

describe('grading scale from existing grades', () => {
  test('entry with A/MA grades converts points to A/MA', () => {
    const e = { id: 9, nameEt: 'Lab', journalEntryStudents: [{ journalStudent: 102, grade: { code: 'KUTSEHINDAMINE_A' } }] }
    expect(entryMode(e)).toBe('AMA')
    const p = buildPreview({ records: [{ assignment: 'lab', name: 'Mari Mets', score: 6, max: 10 }], entries: [e], students })
    expect(p.rows[0].newGrade).toBe('A')
    expect(entryMode({ journalEntryStudents: [] })).toBeNull()
    const forced = buildPreview({ records: [{ assignment: 'lab', name: 'Mari Mets', score: 6, max: 10 }], entries: [e], students, mode: '5' })
    expect(forced.rows[0].newGrade).toBe('3')
  })
})

describe('conflicts', () => {
  test('two assignments on the same entry for one student are blocked', () => {
    const e = { id: 9, nameEt: 'Tund', entryDate: '2026-09-17T00:00:00Z', journalEntryStudents: [] }
    const records = [{ assignment: 'lab-03', name: 'Mari Mets', score: 10, max: 10 }, { assignment: 'lab-04', name: 'Mari Mets', score: 5, max: 10 }]
    const p = buildPreview({ records, entries: [e], students, assignmentMap: { 'lab-03': 9, 'lab-04': 9 } })
    expect(p.rows.every(r => r.conflict && !r.changed)).toBe(true)
    expect(p.rows[0].entryName).toBe('17.09.2026 Tund')
  })
})

describe('auto-link by Classroom 50 assignments.json', () => {
  const journal = [
    { id: 1, nameEt: 'Loeng - Miks automatiseerimine?', entryType: 'SISSEKANNE_T', entryDate: '2026-09-03T00:00:00Z' },
    { id: 2, nameEt: 'Lab 01 - Keskkond ja SSH', entryType: 'SISSEKANNE_P', entryDate: '2026-09-09T00:00:00Z' },
    { id: 3, nameEt: 'Muudatuste jälgimine meeskonnas', entryType: 'SISSEKANNE_T', entryDate: '2026-09-10T00:00:00Z' },
    { id: 4, nameEt: 'Ansible hkhk-automation.github.io', entryType: 'SISSEKANNE_T', entryDate: '2026-09-17T00:00:00Z' }
  ]
  const meta = assignmentMeta({ assignments: [
    { slug: 'lab-01-keskkond-ja-ssh', name: 'Lab 01 - Keskkond ja SSH', available_from: '2026-09-01T20:00:00Z', due: '2026-09-09T20:59:00Z' },
    { slug: 'lab-02-versioonihaldus', name: 'Lab 02 - Versioonihaldus', available_from: '2026-09-10T11:05:00Z', due: '2026-09-17T11:06:00Z' },
    { slug: 'lab-03-ansible-nginx', name: 'Lab 03 - Ansible (nginx)', available_from: '2026-09-16T20:00:00Z', due: '2026-09-23T20:59:00Z' }
  ] })
  test('Tallinn date', () => {
    expect(tallinnDate('2026-09-16T21:30:00Z')).toBe('2026-09-17')
  })
  test('by title, then by date window', () => {
    expect(matchEntryForAssignment('lab-01-keskkond-ja-ssh', journal, meta.get('lab-01-keskkond-ja-ssh')).id).toBe(2)
    expect(matchEntryForAssignment('lab-02-versioonihaldus', journal, meta.get('lab-02-versioonihaldus')).id).toBe(3)
    expect(matchEntryForAssignment('lab-03-ansible-nginx', journal, meta.get('lab-03-ansible-nginx')).id).toBe(4)
    expect(matchEntryForAssignment('lab-03-ansible-nginx', journal)).toBeNull()
  })
})

describe('shared classroom (gr1 + gr2)', () => {
  test('roster students not in this journal are skipped, unknown ones asked', () => {
    const records = [{ assignment: 'lab', username: 'mari', score: 1, max: 1 }, { assignment: 'lab', username: 'teine', score: 1, max: 1 }, { assignment: 'lab', username: 'x9', score: 1, max: 1 }]
    const roster = parseCsv('username,name\nmari,Mari Mets\nteine,Teise Rühma Õpilane\n')
    const p = buildPreview({ records, roster, entries: [{ id: 1, nameEt: 'lab', journalEntryStudents: [] }], students })
    expect(p.rows.length).toBe(1)
    expect(p.otherGroup).toEqual(['teine'])
    expect(p.unmatchedUsers).toEqual(['x9'])
  })
})

describe('missing work after due date', () => {
  const e = { id: 9, nameEt: 'Lab', entryDate: '2026-09-17T00:00:00Z', journalEntryStudents: [{ journalStudent: 102, grade: { code: 'KUTSEHINDAMINE_4' } }] }
  const meta = new Map([['lab', { name: 'Lab', due: '2026-09-23T20:59:00Z' }]])
  const records = [{ assignment: 'lab', name: 'Mari Mets', score: 10, max: 10 }]
  const withLeft = [...students, { id: 103, fullname: 'Lahkunud Õpilane', status: 'OPPURSTAATUS_K' }]
  test('past due: non-submitters get 2 (existing grade shown, not auto-ticked by UI)', () => {
    const p = buildPreview({ records, entries: [e], students: withLeft, meta, missingGrade: '2', now: new Date('2026-09-28') })
    const juhan = p.rows.find(r => r.journalStudent === 102)
    expect(juhan).toMatchObject({ missing: true, newGrade: '2', currentGrade: '4', changed: true })
    expect(p.rows.find(r => r.journalStudent === 103)).toBeUndefined()
    expect(p.rows.find(r => r.journalStudent === 101).newGrade).toBe('5')
  })
  test('before due or option off: nothing added; A/MA scale gives MA', () => {
    expect(buildPreview({ records, entries: [e], students, meta, missingGrade: '2', now: new Date('2026-09-20') }).rows.length).toBe(1)
    expect(buildPreview({ records, entries: [e], students, meta, now: new Date('2026-09-28') }).rows.length).toBe(1)
    const ama = buildPreview({ records, entries: [e], students, meta, missingGrade: '2', mode: 'AMA', now: new Date('2026-09-28') })
    expect(ama.rows.find(r => r.missing).newGrade).toBe('MA')
  })
})

describe('missing work: only autograded assignments', () => {
  test('grading off / no_autograder / empty_repo never produce "missing" rows', () => {
    const e = { id: 10, nameEt: 'Muudatuste jälgimine', entryDate: '2026-09-10T00:00:00Z', journalEntryStudents: [] }
    const meta = assignmentMeta({ assignments: [
      { slug: 'lab-02', name: 'Lab 02', empty_repo: true, grading: { mode: 'off' }, available_from: '2026-09-10T11:05:00Z', due: '2026-09-17T11:06:00Z' }
    ] })
    const p = buildPreview({ records: [], entries: [e], students, meta, missingGrade: '2', now: new Date('2026-09-28') })
    expect(p.rows.length).toBe(0)
    const meta2 = assignmentMeta({ assignments: [{ slug: 'lab-02', name: 'Lab 02', available_from: '2026-09-10T11:05:00Z', due: '2026-09-17T11:06:00Z' }] })
    expect(buildPreview({ records: [], entries: [e], students, meta: meta2, missingGrade: '2', now: new Date('2026-09-28') }).rows.length).toBe(2)
  })
})

describe('lesson content + homework from assignments.json', () => {
  const entries = [
    { id: 1, nameEt: 'Ansible', entryDate: '2026-09-17T00:00:00Z', content: '', homework: null },
    { id: 2, nameEt: 'Vault', entryDate: '2026-09-24T00:00:00Z', content: 'Oma tekst', homework: '' }
  ]
  const meta = assignmentMeta({ assignments: [
    { slug: 'lab-03', name: 'Lab 03 - Ansible', description: 'Ehita playbook.', available_from: '2026-09-16T20:00:00Z', due: '2026-09-23T20:59:00Z' },
    { slug: 'lab-04', name: 'Lab 04 - Vault', description: 'Krüpteeri saladused.', available_from: '2026-09-24T04:00:00Z', due: '2026-09-30T20:59:00Z' }
  ] })
  test('due date = Estonian day', () => {
    expect(tahvelDueDate('2026-09-23T20:59:00Z')).toBe('2026-09-23T23:59:59.000Z')
  })
  test('empty entry is pre-selected, existing text is not', () => {
    const u = buildEntryTextUpdates({ entries, meta })
    const l3 = u.find(x => x.slug === 'lab-03')
    expect(l3).toMatchObject({ entryId: 1, selected: true, overwrites: false })
    expect(l3.changes).toEqual({ content: 'Lab 03 - Ansible', homework: 'Ehita playbook.', homeworkDuedate: '2026-09-23T23:59:59.000Z' })
    expect(u.find(x => x.slug === 'lab-04').changes.content).toBe('Oma tekst\n\nLab 04 - Vault')
  })
  test('nothing to do when Tahvel already matches', () => {
    const same = [{ ...entries[0], content: 'Ehita playbook.', homework: 'Ehita playbook.', homeworkDuedate: '2026-09-23T23:59:59.000Z' }]
    expect(buildEntryTextUpdates({ entries: same.map(e => ({ ...e, content: 'Ansible' })), meta: assignmentMeta({ assignments: [{ slug: 'lab-03', name: 'Ansible', description: 'Ehita playbook.', due: '2026-09-23T20:59:00Z', available_from: '2026-09-16T20:00:00Z' }] }) })).toEqual([])
  })
})

describe('gh: tag in entry content is kept', () => {
  test('entry holding only the tag is pre-selected and the tag survives', () => {
    const entries = [{ id: 1, nameEt: 'Tund', entryDate: '2026-09-17T00:00:00Z', content: 'gh:lab-03', homework: '' }]
    const meta = assignmentMeta({ assignments: [{ slug: 'lab-03', name: 'Lab 03', description: 'Ehita playbook.', due: '2026-09-23T20:59:00Z' }] })
    const [u] = buildEntryTextUpdates({ entries, meta })
    expect(u.selected).toBe(true)
    expect(u.changes.content).toBe('Lab 03\ngh:lab-03')
    expect(u.changes.homework).toBe('Ehita playbook.')
  })
})

describe('no description → nothing written', () => {
  test('due date alone is not written to an entry', () => {
    const entries = [{ id: 1, nameEt: 'Tund', entryDate: '2026-09-24T00:00:00Z', content: '', homework: '' }]
    const meta = assignmentMeta({ assignments: [{ slug: 'lab-03', name: 'Lab 03', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z' }] })
    expect(buildEntryTextUpdates({ entries, meta })).toEqual([])
  })
})

describe('two assignments on the same day share one entry', () => {
  test('texts are combined, latest due date wins', () => {
    const entries = [{ id: 7, nameEt: 'Tund', entryDate: '2026-09-24T00:00:00Z', content: '', homework: '' }]
    const meta = assignmentMeta({ assignments: [
      { slug: 'lab-03-kommutaator-ruuter', name: 'Lab 03 - Kommutaatori ja ruuteri seadistamine', description: 'Seadista ruuter.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z' },
      { slug: 'lab-03-grupitoo', name: 'Lab 03 - Grupitöö: selgita teistele', description: 'Selgita teistele.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-01T20:59:00Z' }
    ] })
    const u = buildEntryTextUpdates({ entries, meta })
    expect(u.length).toBe(1)
    expect(u[0].changes.content).toBe('Lab 03 - Grupitöö: selgita teistele\nLab 03 - Kommutaatori ja ruuteri seadistamine')
    expect(u[0].changes.homework).toBe('Lab 03 - Grupitöö: selgita teistele\nSelgita teistele.\n\nLab 03 - Kommutaatori ja ruuteri seadistamine\nSeadista ruuter.')
    expect(u[0].changes.homeworkDuedate).toBe('2026-10-02T23:59:59.000Z')
    expect(u[0].selected).toBe(true)
  })
})

describe('two labs on one lesson → separate entry', () => {
  const meta = assignmentMeta({ assignments: [
    { slug: 'lab-03-kommutaator-ruuter', name: 'Lab 03 - Kommutaatori ja ruuteri seadistamine', description: 'Ehita väike kohtvõrk.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z', tests: [{ name: 'x', points: 1 }] },
    { slug: 'lab-03-grupitoo', name: 'Lab 03 - Grupitöö: selgita teistele', description: 'Grupitöö: valige teema.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z', grading: { mode: 'manual' } }
  ] })
  test('extra assignment gets a proposal, autograded one keeps the lesson', () => {
    const entries = [{ id: 7, nameEt: 'Tund', entryType: 'SISSEKANNE_T', entryDate: '2026-09-24T00:00:00Z', content: 'Grupitöö: valige teema.' }]
    const p = findSharedEntries({ entries, meta })
    expect(p.length).toBe(1)
    expect(p[0].name).toBe('Lab 03 - Grupitöö: selgita teistele')
    expect(p[0].entryDate).toBe('2026-09-24')
  })
  test('after creation each lab has its own entry', () => {
    const entries = [
      { id: 7, nameEt: 'Tund', entryType: 'SISSEKANNE_T', entryDate: '2026-09-24T00:00:00Z' },
      { id: 8, nameEt: 'Lab 03 - Grupitöö: selgita teistele', entryType: 'SISSEKANNE_I', entryDate: '2026-09-24T00:00:00Z' }
    ]
    expect(matchEntryForAssignment('lab-03-kommutaator-ruuter', entries, meta.get('lab-03-kommutaator-ruuter'), meta).id).toBe(7)
    expect(matchEntryForAssignment('lab-03-grupitoo', entries, meta.get('lab-03-grupitoo'), meta).id).toBe(8)
    expect(findSharedEntries({ entries, meta }).length).toBe(0)
  })
})

describe('lesson describes a lab split into its own entry', () => {
  test('Tund content has both labs, homework only its own', () => {
    const meta = assignmentMeta({ assignments: [
      { slug: 'lab-03-kommutaator-ruuter', name: 'Lab 03 - Kommutaatori ja ruuteri seadistamine', description: 'Ehita võrk.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z' },
      { slug: 'lab-03-grupitoo', name: 'Lab 03 - Grupitöö: selgita teistele', description: 'Selgita teistele.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z' }
    ] })
    const entries = [
      { id: 7, nameEt: 'Tund', entryType: 'SISSEKANNE_T', entryDate: '2026-09-24T00:00:00Z', content: '' },
      { id: 8, nameEt: 'Lab 03 - Grupitöö: selgita teistele', entryType: 'SISSEKANNE_I', entryDate: '2026-09-24T00:00:00Z', content: 'Selgita teistele.', homework: 'Selgita teistele.', homeworkDuedate: '2026-10-02T23:59:59.000Z' }
    ]
    const u = buildEntryTextUpdates({ entries, meta })
    const t = u.find(x => x.entryId === 7)
    expect(t.changes.content).toBe('Lab 03 - Grupitöö: selgita teistele\nLab 03 - Kommutaatori ja ruuteri seadistamine')
    expect(t.changes.homework).toBe('Ehita võrk.')
  })
})

describe('teacher text is kept', () => {
  const meta = assignmentMeta({ assignments: [
    { slug: 'lab-02', name: 'Lab 02 - Kommutaator', description: 'Seadista kommutaator.', available_from: '2026-09-17T05:00:00Z', due: '2026-09-25T20:59:00Z' }
  ] })
  test('lecture line stays, lab is appended, second run changes nothing', () => {
    const entries = [{ id: 5, nameEt: 'Tund', entryType: 'SISSEKANNE_T', entryDate: '2026-09-17T00:00:00Z', content: 'Oma märkus', homework: '' }]
    const u = buildEntryTextUpdates({ entries, meta })
    expect(u[0].changes.content).toBe('Oma märkus\n\nLab 02 - Kommutaator')
    expect(u[0].selected).toBe(true)
    entries[0].content = u[0].changes.content
    entries[0].homework = u[0].changes.homework
    entries[0].homeworkDuedate = u[0].changes.homeworkDuedate
    expect(buildEntryTextUpdates({ entries, meta }).length).toBe(0)
  })
})

describe('standard description', () => {
  test('Teooria line goes to content, not homework', () => {
    const d = 'Teooria: 0b Topoloogiad — https://x/t\nPraktikum: ehita võrk — https://x/p'
    expect(homeworkPart(d)).toBe('Praktikum: ehita võrk — https://x/p')
    const meta = assignmentMeta({ assignments: [{ slug: 'lab-02', name: 'Lab 02', description: d, available_from: '2026-09-17T05:00:00Z', due: '2026-09-25T20:59:00Z' }] })
    const u = buildEntryTextUpdates({ entries: [{ id: 5, nameEt: 'Tund', entryDate: '2026-09-17T00:00:00Z', content: '', homework: '' }], meta })
    expect(u[0].changes.content).toBe('Lab 02\nTeooria: 0b Topoloogiad — https://x/t')
    expect(u[0].changes.homework).toBe('Praktikum: ehita võrk — https://x/p')
  })
})

describe('readable description', () => {
  test('sentence per line, link on own line, old one-line text replaced', () => {
    const d = "Ehita väike kohtvõrk; tee tõrkeotsing. Esita .pkt fail oma repos (commit + push). Juhend: https://x/p3.html"
    expect(formatDescription(d)).toBe("Ehita väike kohtvõrk; tee tõrkeotsing.\nEsita .pkt fail oma repos (commit + push).\nJuhend: https://x/p3.html")
    const meta = assignmentMeta({ assignments: [{ slug: 'l3', name: 'Lab 03', description: d, available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z' }] })
    const u = buildEntryTextUpdates({ entries: [{ id: 1, nameEt: 'Tund', entryDate: '2026-09-24T00:00:00Z', content: 'Oma märkus\n\n' + d, homework: d }], meta })
    expect(u[0].changes.content).toBe('Oma märkus\n\nLab 03')
    expect(u[0].changes.homework).toBe(formatDescription(d))
  })
})

describe('edited description replaces old homework', () => {
  test('no duplicate after description change', () => {
    const meta = assignmentMeta({ assignments: [{ slug: 'l1', name: 'Lab 01 - Packet Tracer', description: 'Teooria: 0a Võrguseadmed\nUus tekst.', available_from: '2026-09-10T05:00:00Z', due: '2026-09-20T20:59:00Z' }] })
    const entries = [{ id: 1, nameEt: 'Tund', entryDate: '2026-09-10T00:00:00Z', content: 'Lab 01 - Packet Tracer\nTeooria: vana', homework: 'Vana tekst.\nJuhend: x' }]
    const u = buildEntryTextUpdates({ entries, meta })
    expect(u[0].changes.homework).toBe('Uus tekst.')
    expect(u[0].changes.content).toBe('Lab 01 - Packet Tracer\nTeooria: 0a Võrguseadmed')
  })
})

describe('written text is not offered again', () => {
  test('after writing (Tahvel returns \\r\\n) nothing is left to do', () => {
    const meta = assignmentMeta({ assignments: [{ slug: 'l1', name: 'Lab 01 - Packet Tracer', description: 'Teooria: 0a Võrguseadmed\nPaigalda PT. Esita fail. Juhend: https://x/p1.html', available_from: '2026-09-10T05:00:00Z', due: '2026-09-20T20:59:00Z' }] })
    const entries = [{ id: 1, nameEt: 'Tund', entryDate: '2026-09-10T00:00:00Z', content: 'Teooria: 0a Võrguseadmed\nLab 01 - Packet Tracer\nTeooria: 0a Võrguseadmed', homework: 'vana' }]
    const u = buildEntryTextUpdates({ entries, meta })[0]
    expect(u.changes.content).toBe('Lab 01 - Packet Tracer\nTeooria: 0a Võrguseadmed')
    entries[0].content = u.changes.content.replace(/\n/g, '\r\n') + ' '
    entries[0].homework = u.changes.homework.replace(/\n/g, '\r\n')
    entries[0].homeworkDuedate = u.changes.homeworkDuedate
    expect(buildEntryTextUpdates({ entries, meta })).toEqual([])
  })
})

describe('two labs, same theory', () => {
  test('theory line once', () => {
    const d = n => ({ slug: 'l' + n, name: 'Lab 03 - ' + n, description: 'Teooria: 0a, 0b\nTee ' + n + '.', available_from: '2026-09-24T05:00:00Z', due: '2026-10-02T20:59:00Z' })
    const meta = assignmentMeta({ assignments: [d('A'), d('B')] })
    const entries = [
      { id: 7, nameEt: 'Tund', entryType: 'SISSEKANNE_T', entryDate: '2026-09-24T00:00:00Z', content: '' },
      { id: 8, nameEt: 'Lab 03 - B', entryType: 'SISSEKANNE_I', entryDate: '2026-09-24T00:00:00Z', content: '' }
    ]
    const t = buildEntryTextUpdates({ entries, meta }).find(x => x.entryId === 7)
    expect(t.changes.content).toBe('Lab 03 - A\nLab 03 - B\nTeooria: 0a, 0b')
  })
})

describe('review fixes', () => {
  const students = [{ id: 1, fullname: 'Mari-Liis Mets' }, { id: 2, fullname: 'Jaan Tamm' }]
  const entries = [{ id: 9, nameEt: 'Lab 01', entryType: 'SISSEKANNE_P', entryDate: '2026-09-01T00:00:00Z', journalEntryStudents: [] }]
  const meta = assignmentMeta({ assignments: [{ slug: 'lab-01', name: 'Lab 01', description: 'x', available_from: '2026-09-01T05:00:00Z', due: '2026-09-09T20:59:00Z', tests: [{}] }] })
  test('slightly different name is matched (1+2)', () => {
    expect(fuzzyStudent('Mari Mets', students).id).toBe(1)
    const p = buildPreview({ records: [{ assignment: 'lab-01', name: 'Mari Mets', score: 9, max: 10 }], entries, students, meta, missingGrade: '2', now: new Date('2026-10-01') })
    expect(p.rows.find(r => r.journalStudent === 1).newGrade).toBe('5')
    expect(p.rows.find(r => r.journalStudent === 2).missing).toBe(true)
  })
  test('unresolved submission → missing grade not pre-ticked (1)', () => {
    const p = buildPreview({ records: [{ assignment: 'lab-01', username: 'ghost99', score: 9, max: 10 }], entries, students, meta, missingGrade: '2', now: new Date('2026-10-01') })
    expect(p.rows.filter(r => r.missing).every(r => r.uncertain)).toBe(true)
  })
  test('gh:lab10 is not gh:lab1 (3)', () => {
    const es = [{ id: 1, nameEt: 'x', content: 'gh:lab10' }, { id: 2, nameEt: 'y', content: 'gh:lab1' }]
    expect(matchEntryForAssignment('lab1', es).id).toBe(2)
    expect(matchEntryForAssignment('lab10', es).id).toBe(1)
  })
  test('teacher Teooria line outside our block stays (4)', () => {
    const m = assignmentMeta({ assignments: [{ slug: 'l', name: 'Lab 05', description: 'Teooria: uus\nTee.', available_from: '2026-10-01T05:00:00Z', due: '2026-10-09T20:59:00Z' }] })
    const es = [{ id: 1, nameEt: 'Tund', entryDate: '2026-10-01T00:00:00Z', content: 'Teooria: minu loeng\n\nLab 05\nTeooria: vana', homework: 'Tee.' }]
    expect(buildEntryTextUpdates({ entries: es, meta: m })[0].changes.content).toBe('Teooria: minu loeng\n\nLab 05\nTeooria: uus')
  })
  test('teacher homework is not wiped (5)', () => {
    const m = assignmentMeta({ assignments: [{ slug: 'l', name: 'Lab 05', description: 'Teooria: ainult', available_from: '2026-10-01T05:00:00Z', due: '2026-10-09T20:59:00Z' }] })
    const es = [{ id: 1, nameEt: 'Tund', entryDate: '2026-10-01T00:00:00Z', content: '', homework: 'Loe peatükk 3.' }]
    const u = buildEntryTextUpdates({ entries: es, meta: m })[0]
    expect(u.changes.homework).toBeUndefined()
    const m2 = assignmentMeta({ assignments: [{ slug: 'l', name: 'Lab 05', description: 'Tee X.', available_from: '2026-10-01T05:00:00Z', due: '2026-10-09T20:59:00Z' }] })
    const u2 = buildEntryTextUpdates({ entries: es, meta: m2 })[0]
    expect(u2.changes.homework).toBe('Loe peatükk 3.\n\nTee X.')
    expect(u2.selected).toBe(false)
  })
  test('no guessing between courses (6)', () => {
    expect(pickClassroom(['it24-automatiseerimine', 'it24-linux'], ['IT-24'], 'Andmebaasid')).toBeNull()
    expect(pickClassroom(['it24-automatiseerimine', 'it24-linux'], ['IT-24'], 'Automatiseerimine')).toBe('it24-automatiseerimine')
  })
})
