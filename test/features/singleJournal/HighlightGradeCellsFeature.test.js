import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import HighlightGradeCellsFeature from '../../../src/features/singleJournal/highlightGradeCells/HighlightGradeCellsFeature.js'

describe('HighlightGradeCellsFeature', () => {
  let feature
  let dom

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
      url: 'https://tahvel.edu.ee/#/journal/123/edit'
    })
    global.window = dom.window
    global.document = dom.window.document
    global.MutationObserver = dom.window.MutationObserver
    feature = new HighlightGradeCellsFeature()
  })

  test('activates only on journal edit pages', () => {
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/edit')).toBe(true)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
  })

  test('classifies configured positive and negative grades', () => {
    expect(feature._getGradeType('A')).toBe('positive')
    expect(feature._getGradeType('3')).toBe('positive')
    expect(feature._getGradeType('4')).toBe('positive')
    expect(feature._getGradeType('5')).toBe('positive')
    expect(feature._getGradeType('MA')).toBe('negative')
    expect(feature._getGradeType('1')).toBe('negative')
    expect(feature._getGradeType('2')).toBe('negative')
    expect(feature._getGradeType('X')).toBe('negative')
    expect(feature._getGradeType('P')).toBeNull()
    expect(feature._getGradeType('V')).toBeNull()
  })

  test('normalises grade-history strings to the trailing current grade', () => {
    // Regression: cells with grade-modification history render as
    // "4 * / 4 * / 3" (current=3) or "4 * / 2" (current=2). The classifier
    // must read only the trailing segment, otherwise the full string matches
    // neither POSITIVE nor NEGATIVE and the cell loses its colour.
    expect(feature._normalizeGradeValue('4 * / 4 * / 3')).toBe('3')
    expect(feature._normalizeGradeValue(' 4 * /  4 * /  3 ')).toBe('3')
    expect(feature._normalizeGradeValue('4 * / 2')).toBe('2')
    expect(feature._normalizeGradeValue('X * / 5')).toBe('5')
    // No history → unchanged behaviour
    expect(feature._normalizeGradeValue('4')).toBe('4')
    expect(feature._normalizeGradeValue(' MA ')).toBe('MA')
    expect(feature._normalizeGradeValue('')).toBe('')
  })

  test('classifies cells whose text shows grade history by the current grade', () => {
    expect(feature._getGradeType(feature._normalizeGradeValue('4 * / 4 * / 3'))).toBe('positive')
    expect(feature._getGradeType(feature._normalizeGradeValue('4 * / 2'))).toBe('negative')
    expect(feature._getGradeType(feature._normalizeGradeValue('5 * / X'))).toBe('negative')
  })

  test('injects green text color for positive grade text', () => {
    feature.injectCSS()

    expect(document.getElementById('highlight-grade-cells-style').textContent).toContain('color: #0b7a4b')
  })

  test('injects grey background for empty AP student grade cells', () => {
    feature.injectCSS()

    const css = document.getElementById('highlight-grade-cells-style').textContent
    const apCellCss = css.match(/td\.oa2-grade-cell-ap-empty \{([\s\S]*?)\}/)?.[1]
    expect(apCellCss).toContain('background-color: #efefef')
    expect(apCellCss).not.toContain('box-shadow')
  })

  test('injects default cursor for highlighted grade text', () => {
    feature.injectCSS()

    const css = document.getElementById('highlight-grade-cells-style').textContent
    expect(css).toContain('cursor: default')
    expect(css).toContain('cursor: text')
  })

  test('injects black custom tooltip styling for grade comments', () => {
    feature.injectCSS()

    const css = document.getElementById('highlight-grade-cells-style').textContent
    expect(css).toContain('.oa2-grade-tooltip')
    expect(css).toContain('background: rgba(33, 37, 41, 0.96)')
    expect(css).toContain('td.oa2-grade-cell-positive tahvel-tooltip')
  })

  test('suppresses native title while showing custom grade tooltip', () => {
    const cell = document.createElement('td')
    cell.className = 'oa2-grade-cell-positive'
    cell.title = 'Praegune hinne erineb arvutatud hindest\nPraegune: A\nArvutatud: MA'
    document.body.appendChild(cell)

    feature._showTooltip(cell.title, { clientX: 0, clientY: 0 }, cell)

    expect(cell.hasAttribute('title')).toBe(false)
    expect(cell.dataset.oa2SuppressedTitle).toContain('Praegune hinne erineb')

    feature._hideTooltip()

    expect(cell.title).toContain('Praegune hinne erineb')
    expect(cell.dataset.oa2SuppressedTitle).toBeUndefined()
  })

  test('highlights full grade cells in columns that contain grades', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th><th>26.03</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td><td>P</td></tr>
            <tr><td>2</td><td>Student 2</td><td>MA</td><td>V</td></tr>
            <tr><td>3</td><td>Student 3</td><td>4</td><td></td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.run()

    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
    expect(rows[1].children[2].classList.contains('oa2-grade-cell-negative')).toBe(true)
    expect(rows[2].children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
    expect(rows[0].children[3].className).toBe('')
    expect(rows[1].children[3].className).toBe('')
  })

  test('marks empty AP student grade cells as not required without overriding grades', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th><th>26.03</th><th>27.03</th><th>28.03</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><i><span>AP </span></i><a href="/#/students/1/main">AP Student</a></td>
              <td></td>
              <td>4</td>
              <td>P</td>
              <td><select class="grade-select"><option selected></option><option>A</option></select></td>
            </tr>
            <tr>
              <td>2</td>
              <td><a href="/#/students/2/main">Regular Student</a></td>
              <td></td>
              <td>A</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    feature.run()

    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].children[2].classList.contains('oa2-grade-cell-ap-empty')).toBe(true)
    expect(rows[0].children[3].classList.contains('oa2-grade-cell-positive')).toBe(true)
    expect(rows[0].children[3].classList.contains('oa2-grade-cell-ap-empty')).toBe(false)
    expect(rows[0].children[4].classList.contains('oa2-grade-cell-ap-empty')).toBe(false)
    expect(rows[0].children[5].classList.contains('oa2-grade-cell-ap-empty')).toBe(true)
    expect(rows[1].children[2].classList.contains('oa2-grade-cell-ap-empty')).toBe(false)
  })

  test('does not load API comments during regular highlighting run', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `
    let apiCalls = 0
    feature.api = { tahvel: { get: () => { apiCalls += 1 } } }

    feature.run()

    expect(apiCalls).toBe(0)
  })

  test('ignores embedded Tahvel tooltip text when detecting grade values', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Student 1</td>
              <td><span class="invalid-grading-schema">MA</span><tahvel-tooltip>Ei esitatud</tahvel-tooltip></td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    feature.run()

    expect(document.querySelector('tbody tr').children[2].classList.contains('oa2-grade-cell-negative')).toBe(true)
  })

  test('highlights the full grade column while quick update form is open', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Student 1</td>
              <td><div class="quick-update"><select class="grade-select"><option selected>A</option></select></div></td>
            </tr>
            <tr>
              <td>2</td>
              <td>Student 2</td>
              <td>A</td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    feature.run()

    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
    expect(rows[1].children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
  })

  test('observer quick-update path updates the full open grade column', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th><th>26.03</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Student 1</td>
              <td><div class="quick-update"><select class="grade-select"><option selected>A</option></select></div></td>
              <td>A</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Student 2</td>
              <td>MA</td>
              <td>MA</td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    feature._updateOpenQuickUpdateColumns()

    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
    expect(rows[1].children[2].classList.contains('oa2-grade-cell-negative')).toBe(true)
    expect(rows[0].children[3].className).toBe('')
    expect(rows[1].children[3].className).toBe('')
  })

  test('uses selected grade when a journal assessment cell is open for editing', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Student 1</td>
              <td>
                <div class="grade-cell">
                  <div class="row quick-update">
                    <tahvel-grade-select>
                      <select class="grade-select">
                        <option></option>
                        <option>1</option>
                        <option>2</option>
                        <option>3</option>
                        <option>4</option>
                        <option>5</option>
                        <option selected>A</option>
                        <option>MA</option>
                        <option>X</option>
                      </select>
                    </tahvel-grade-select>
                    <textarea></textarea>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    feature.run()

    expect(document.querySelector('tbody tr').children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
  })

  test('does not change columns without grade values', () => {
    document.body.innerHTML = `
      <table class="tahvel-table with-borders">
        <thead>
          <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>Student 1</td><td>P</td></tr>
          <tr><td>2</td><td>Student 2</td><td>V</td></tr>
        </tbody>
      </table>
    `

    feature.run()

    document.querySelectorAll('tbody td').forEach(cell => {
      expect(cell.classList.contains('oa2-grade-cell-positive')).toBe(false)
      expect(cell.classList.contains('oa2-grade-cell-negative')).toBe(false)
    })
  })

  test('observes document changes so late-loaded journal tables are highlighted', async () => {
    feature._setupObserver()

    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    await new Promise(resolve => setTimeout(resolve, 150))

    expect(document.querySelector('tbody tr').children[2].classList.contains('oa2-grade-cell-positive')).toBe(true)
  })

  test('ignores tooltip DOM mutations to avoid hover flicker reruns', async () => {
    let runCount = 0
    feature.run = () => {
      runCount += 1
    }
    feature._setupObserver()

    const tooltip = document.createElement('div')
    tooltip.className = 'oa2-grade-tooltip'
    tooltip.textContent = 'Ei esitatud'
    document.body.appendChild(tooltip)
    tooltip.firstChild.textContent = 'Heading puudub'

    await new Promise(resolve => setTimeout(resolve, 150))

    expect(runCount).toBe(0)
    feature.onDeactivate()
  })

  test('shows instant black tooltip for open grade comments', () => {
    document.body.innerHTML = `
      <table class="tahvel-table with-borders">
        <thead><tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Student 1</td>
            <td class="oa2-grade-cell-negative"><textarea>Ei esitatud</textarea></td>
          </tr>
        </tbody>
      </table>
    `
    feature.injectCSS()
    feature._setupTooltipListeners()

    const cell = document.querySelector('td.oa2-grade-cell-negative')
    cell.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 60 }))

    expect(document.querySelector('.oa2-grade-tooltip').textContent).toBe('Ei esitatud')

    cell.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))

    expect(document.querySelector('.oa2-grade-tooltip')).toBeNull()
    feature._removeTooltipListeners()
  })

  test('uses loaded API grade comment for closed grade tooltip', () => {
    document.body.innerHTML = `
      <table class="tahvel-table with-borders">
        <thead><tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td>
            <td><a href="/#/students/203875/main">Student 1</a></td>
            <td class="oa2-grade-cell-negative">MA</td>
          </tr>
        </tbody>
      </table>
    `

    feature._studentIdToJournalStudentId = new Map([['203875', '5400417']])
    feature._gradeCommentCache = new Map([['0:5400417', 'Tingimusvormindus ei tööta']])

    const table = document.querySelector('table')
    const row = document.querySelector('tbody tr')
    const cell = row.children[2]
    feature._applyGradeComments(table, [row], 2)

    expect(cell.dataset.oa2GradeComment).toBeUndefined()
    expect(feature._getTooltipText(cell)).toBe('Tingimusvormindus ei tööta')
  })

  test('matches same-date grade columns by header entry type before positional fallback', () => {
    document.body.innerHTML = `
      <table class="tahvel-table with-borders">
        <thead>
          <tr>
            <th>Nr</th>
            <th>Õppija</th>
            <th style="background-color: rgb(252, 231, 243);">25.03</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td><a href="/#/students/203875/main">Student 1</a></td>
            <td class="oa2-grade-cell-negative">MA</td>
          </tr>
        </tbody>
      </table>
    `

    feature._journalEntries = [
      { entryDate: '2026-03-25T00:00:00Z', entryType: 'SISSEKANNE_P' },
      { entryDate: '2026-03-25T00:00:00Z', entryType: 'SISSEKANNE_H' }
    ]
    feature._studentIdToJournalStudentId = new Map([['203875', '5400417']])
    feature._gradeCommentCache = new Map([['1:5400417', 'Tingimusvormindus ei tööta']])

    const table = document.querySelector('table')
    const row = document.querySelector('tbody tr')
    const cell = row.children[2]
    feature._applyGradeComments(table, [row], 2)

    expect(cell.dataset.oa2GradeComment).toBeUndefined()
    expect(feature._getTooltipText(cell)).toBe('Tingimusvormindus ei tööta')
  })

  test('removes custom tooltip if hovered grade cell is removed', () => {
    document.body.innerHTML = `
      <table class="tahvel-table with-borders">
        <thead><tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Student 1</td>
            <td class="oa2-grade-cell-negative"><textarea>Ei esitatud</textarea></td>
          </tr>
        </tbody>
      </table>
    `
    feature.injectCSS()
    feature._setupTooltipListeners()

    const cell = document.querySelector('td.oa2-grade-cell-negative')
    cell.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 60 }))
    expect(document.querySelector('.oa2-grade-tooltip')).toBeTruthy()

    cell.remove()
    feature.run()

    expect(document.querySelector('.oa2-grade-tooltip')).toBeNull()
    feature._removeTooltipListeners()
  })

  test('updates highlighting when an open grade select changes', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Student 1</td>
              <td><select class="grade-select"><option>A</option><option selected>MA</option></select></td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    let runCount = 0
    feature.run = () => {
      runCount += 1
    }
    feature.onActivate()
    const cell = document.querySelector('tbody tr').children[2]
    const select = document.querySelector('select')

    select.selectedIndex = 0
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))

    expect(cell.classList.contains('oa2-grade-cell-positive')).toBe(true)
    expect(cell.classList.contains('oa2-grade-cell-negative')).toBe(false)
    expect(runCount).toBe(0)

    feature.onDeactivate()
  })

  test('ignores API grade comments loaded for a previous journal', async () => {
    let resolveEntries
    let resolveStudents
    feature.api = {
      tahvel: {
        get: endpoint => new Promise(resolve => {
          if (endpoint.endsWith('/journalEntriesByDate')) resolveEntries = resolve
          if (endpoint.endsWith('/journalStudents')) resolveStudents = resolve
        })
      }
    }
    feature.onActivate()

    const loadPromise = feature._loadGradeComments(2)
    window.history.pushState({}, '', 'https://tahvel.edu.ee/#/journal/456/edit')
    resolveEntries([{ journalStudentResults: { 5400417: { addInfo: 'Vana kommentaar' } } }])
    resolveStudents([{ studentId: 203875, id: 5400417 }])
    await loadPromise

    expect(feature._gradeCommentCache.size).toBe(0)
    feature.onDeactivate()
  })

  test('throttles expected API failures when loading grade comments', async () => {
    let apiCalls = 0
    const error = new Error('API Error: 403')
    error.status = 403
    feature.api = {
      tahvel: {
        get: mock(() => {
          apiCalls += 1
          return Promise.reject(error)
        })
      }
    }
    feature.onActivate()

    await feature._loadGradeComments(2)
    await feature._loadGradeComments(2)

    expect(apiCalls).toBe(2)
    feature.onDeactivate()
  })

  test('does not show delayed API tooltip after mouse leaves cell', async () => {
    document.body.innerHTML = `
      <table class="tahvel-table with-borders">
        <thead><tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Student 1</td>
            <td class="oa2-grade-cell-negative">MA</td>
          </tr>
        </tbody>
      </table>
    `
    let resolveLoad
    feature._loadGradeComments = () => new Promise(resolve => {
      resolveLoad = () => {
        feature._cellGradeComments.set(document.querySelector('td.oa2-grade-cell-negative'), 'Hilinenud kommentaar')
        resolve()
      }
    })
    feature.injectCSS()
    feature._setupTooltipListeners()

    const cell = document.querySelector('td.oa2-grade-cell-negative')
    cell.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 60 }))
    cell.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    resolveLoad()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('.oa2-grade-tooltip')).toBeNull()
    feature._removeTooltipListeners()
  })
})
