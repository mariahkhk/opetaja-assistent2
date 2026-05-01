import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import AssignmentTitleRowFeature from '../../../src/features/singleJournal/assignmentTitleRow/AssignmentTitleRowFeature.js'

function stripSoftHyphens(text) {
  return text.replace(/\u00AD/g, '')
}

describe('AssignmentTitleRowFeature', () => {
  let feature
  let dom

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
      url: 'https://tahvel.edu.ee/#/journal/123/edit'
    })
    global.window = dom.window
    global.document = dom.window.document
    global.MutationObserver = dom.window.MutationObserver
    feature = new AssignmentTitleRowFeature()
    feature.isActive = true
  })

  test('activates only on journal edit pages', () => {
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/edit')).toBe(true)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
  })

  test('injects narrow font styling for title row', () => {
    feature._injectCSS()

    const css = document.getElementById('oa2-assignment-title-row-style').textContent
    expect(css).not.toContain('fonts.googleapis.com')
    expect(css).toContain("font-family: 'Arial Narrow', Arial, sans-serif")
    expect(css).toContain('background: #fff')
    expect(css).toContain('font-size: 8.5px')
    expect(css).toContain('padding: 1px 2px')
    expect(css).toContain('height: 2.55em')
    expect(css).toContain('@keyframes oa2-assignment-title-slide-up')
    expect(css).toContain('thead tr.oa2-assignment-title-row,')
    expect(css).toContain('thead tr.oa2-assignment-title-row > th {')
    expect(css).toContain('animation: oa2-assignment-title-slide-up 560ms ease-out both')
    expect(css).not.toContain('thead tr.oa2-assignment-outcome-row th.oa2-assignment-row__first-content')
    expect(css).not.toContain('thead tr.oa2-assignment-title-row th.oa2-assignment-row__first-content')
    expect(css).toContain('thead tr.oa2-assignment-title-row th.oa2-assignment-row__spacer')
    expect(css).toContain('border-right: 1px solid #d9d9d6')
    expect(css).toContain('vertical-align: middle')
    expect(css).toContain('display: flex')
    expect(css).toContain('align-items: center')
    expect(css).toContain('justify-content: center')
    expect(css).toContain('width: 100%')
    expect(css).toContain('height: 2.1em')
    expect(css).toContain('max-height: 2.1em')
    expect(css).toContain('margin: 0')
    expect(css).toContain('hyphens: manual')
    expect(css).toContain('overflow-wrap: normal')
    expect(css).toContain('text-align: center')
    expect(css).toContain('word-break: normal')
    expect(css).not.toContain('text-overflow: ellipsis')
    expect(css).not.toContain('-webkit-line-clamp')
  })

  test('does not set language-specific hyphenation attribute on title text', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', content: 'Poolitamise kontrollimiseks piisavalt pikk lause.' }])
      }
    }

    await feature.run()

    expect(document.querySelector('.oa2-assignment-title-row__text')?.getAttribute('lang')).toBeNull()
  })

  test('renders soft hyphenated text into the title row', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', content: 'Varasemalt esitamata praktiliste tööde esitamine.' }])
      }
    }

    await feature.run()

    const text = document.querySelector('.oa2-assignment-title-row__text')?.textContent || ''
    expect(text.includes('\u00AD')).toBe(true)
  })

  test('renders assignment title row from journal entries', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(252, 231, 243)">25.03</th>
              <th style="background-color: rgb(236, 252, 203)">25.03</th>
              <th>Lõpptulemus</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>4</td><td>A</td><td>5</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [
          { id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_H', nameEt: 'Kontrolltöö' },
          { id: 2, entryDate: '2026-03-25', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö 7' }
        ])
      }
    }

    await feature.run()

    const titleRow = document.querySelector('thead tr.oa2-assignment-title-row')
    const cells = Array.from(titleRow.children).map(cell => stripSoftHyphens(cell.textContent.trim()))
    expect(cells).toEqual(['', 'Kontrolltöö', 'Iseseisev töö 7', ''])
    expect(titleRow.children[0].getAttribute('colspan')).toBe('2')
    expect(titleRow.children[1].dataset.fullText).toBe('Kontrolltöö')
    expect(titleRow.children[1].classList.contains('oa2-assignment-row__first-content')).toBe(true)
  })

  test('uses entry detail content for configured Tahvel type labels', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
              <th style="background-color: rgb(204, 251, 241)">13.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    const get = mock(async url => {
      if (url === '/journals/123/journalEntriesByDate') {
        return [
          { id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', content: '' },
          { id: 2, entryDate: '2026-04-13', entryType: 'SISSEKANNE_P', nameEt: 'Praktiline töö', content: '' }
        ]
      }

      if (url === '/journals/123/journalEntry/1') {
        return { id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', content: 'Läbida ülesanded 001-014. Ülejäänud kirjeldus.' }
      }

      if (url === '/journals/123/journalEntry/2') {
        return { id: 2, entryDate: '2026-04-13', entryType: 'SISSEKANNE_P', nameEt: 'Praktiline töö', content: 'Koosta esitlus tehisaruga.' }
      }

      throw new Error(`Unexpected URL: ${url}`)
    })
    feature.api = { tahvel: { get } }

    await feature.run()

    const titleRow = document.querySelector('thead tr.oa2-assignment-title-row')
    const cells = Array.from(titleRow.children).map(cell => stripSoftHyphens(cell.textContent.trim()))
    expect(cells).toEqual(['', 'Läbida ülesanded 001-014.', 'Koosta esitlus tehisaruga.'])
    expect(get).toHaveBeenCalledTimes(3)
  })

  test('uses content fallback for all configured Tahvel labels', () => {
    const labels = [
      'E-õpe',
      'Hindamine',
      'Iseseisev töö',
      'Perioodi hinne',
      'Praktiline töö',
      'Tund'
    ]

    labels.forEach(label => {
      expect(feature._shouldUseEntryContentFallback({ nameEt: label })).toBe(true)
    })

    expect(feature._shouldUseEntryContentFallback({ nameEt: 'Kontrolltöö' })).toBe(false)
    expect(feature._shouldUseEntryContentFallback({ nameEt: 'Arvutustabel (ÕV1)' })).toBe(false)
  })

  test('strips only generated outcome suffixes from assignment titles', () => {
    expect(feature._getEntryTitle({ nameEt: 'Arvutustabel (ÕV1)' })).toBe('Arvutustabel')
    expect(feature._getEntryTitle({ nameEt: 'Projekt (ÕV1, ÕV3)' })).toBe('Projekt')
    expect(feature._getEntryTitle({ nameEt: 'Projekt (järeltöö)' })).toBe('Projekt (järeltöö)')
    expect(feature._getEntryTitle({ nameEt: 'Projekt (ÕV1 ja kordus)' })).toBe('Projekt (ÕV1 ja kordus)')
  })

  test('does not truncate date-prefixed content to bare day number', () => {
    const title = feature._getEntryContentTitle({
      content: '22. aprilli tunnis harjutati korrektse uhelehekuljelise CV koostamist. Jargnev lause.'
    })

    expect(title).toBe('22. aprilli tunnis harjutati korrektse uhelehekuljelise CV koostamist.')
  })

  test('removes URL schemes from rendered title text', () => {
    const title = feature._getEntryContentTitle({
      content: 'Vaata https://example.com/teema ja http://test.ee/jargmine.'
    })

    expect(title).toBe('Vaata example.com/teema ja test.ee/jargmine.')
  })

  test('keeps full tooltip text for long truncated titles', () => {
    const longText = `${'sona '.repeat(45)}lopp`
    const tooltip = feature._getTooltipText(longText)

    expect(tooltip).toBe(longText)
  })

  test('marks truncated title cells with tooltip text', () => {
    document.body.innerHTML = '<table><thead><tr class="oa2-assignment-title-row"><th data-full-text="Täistekst pikema sisuga"><span class="oa2-assignment-title-row__text">Täistekst pikema sisuga</span></th></tr></thead></table>'

    const row = document.querySelector('tr.oa2-assignment-title-row')
    const text = row.querySelector('.oa2-assignment-title-row__text')
    feature._isOverflowing = mock(() => true)
    feature._truncateWithEllipsis = mock(() => 'Täistekst…')

    feature._applyTruncationIndicators(row)

    expect(text?.classList.contains('oa2-assignment-title-row__text--truncated')).toBe(true)
    expect(text?.dataset.tooltipText).toBe('Täistekst pikema sisuga')
  })

  test('increases table wrapper height to fit added header rows', () => {
    document.body.innerHTML = `
      <div id="studentTable" class="tahvel-table-wrapper">
        <table class="tahvel-table with-borders">
          <thead><tr><th>Nr</th><th>Õppija</th></tr></thead>
          <tbody><tr><td>1</td><td>Student 1</td></tr></tbody>
        </table>
      </div>
    `

    const wrapper = document.getElementById('studentTable')
    const table = wrapper.querySelector('table')
    Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 497 })
    Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, value: 546 })
    wrapper.style.height = ''
    wrapper.style.maxHeight = ''
    feature._adjustTableWrapperHeight(table)

    expect(wrapper.style.height).toBe('546px')
    expect(wrapper.style.overflowY).toBe('hidden')
  })

  test('allows for horizontal scrollbar height when expanding table wrapper', () => {
    document.body.innerHTML = `
      <div id="studentTable" class="tahvel-table-wrapper">
        <table class="tahvel-table with-borders">
          <thead><tr><th>Nr</th><th>Õppija</th></tr></thead>
          <tbody><tr><td>1</td><td>Student 1</td></tr></tbody>
        </table>
      </div>
    `

    const wrapper = document.getElementById('studentTable')
    const table = wrapper.querySelector('table')
    Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 531 })
    Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, value: 546 })
    Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 548 })
    wrapper.style.borderTop = '1px solid rgb(217, 217, 214)'
    wrapper.style.borderBottom = '1px solid rgb(217, 217, 214)'
    wrapper.style.height = ''
    wrapper.style.maxHeight = ''
    feature._adjustTableWrapperHeight(table)

    expect(wrapper.style.height).toBe('561px')
    expect(wrapper.style.overflowY).toBe('hidden')
  })

  test('uses visible header title when Tahvel already renders it in the DOM', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th>25.03 Projekti demo</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>5</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [])
      }
    }

    await feature.run()

    const titleRow = document.querySelector('thead tr.oa2-assignment-title-row')
    expect(stripSoftHyphens(titleRow.children[1].textContent.trim())).toBe('Projekti demo')
  })

  test('keeps entry outcomes when using a visible header title', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04 Projekti demo</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Projekti demo (ÕV1)' }])
      }
    }

    await feature.run()

    expect(stripSoftHyphens(document.querySelector('thead tr.oa2-assignment-title-row')?.children[1].textContent.trim() || '')).toBe('Projekti demo')
    expect(document.querySelector('thead tr.oa2-assignment-outcome-row .oa2-assignment-outcome-row__badge')?.textContent.trim()).toBe('ÕV1')
  })

  test('renders an ÕV badge row when at least one entry has outcomes', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
              <th style="background-color: rgb(204, 251, 241)">13.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [
          { id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö (ÕV1, ÕV3)', content: 'Lahenda harjutused.' },
          { id: 2, entryDate: '2026-04-13', entryType: 'SISSEKANNE_P', nameEt: 'Praktiline töö', content: 'Koosta esitlus.' }
        ])
      }
    }

    await feature.run()

    const table = document.querySelector('table')
    const rows = Array.from(document.querySelectorAll('thead tr'))
    const outcomeRow = document.querySelector('thead tr.oa2-assignment-outcome-row')
    expect(rows[0].classList.contains('oa2-assignment-title-row')).toBe(true)
    expect(rows[1].classList.contains('oa2-assignment-outcome-row')).toBe(false)
    expect(rows[2].classList.contains('oa2-assignment-outcome-row')).toBe(true)
    expect(outcomeRow).not.toBeNull()
    expect(rows[1].querySelector('th')?.getAttribute('rowspan')).toBe('2')
    expect(outcomeRow.children.length).toBe(2)
    const badges = Array.from(outcomeRow.querySelectorAll('.oa2-assignment-outcome-row__badge')).map(badge => badge.textContent.trim())
    expect(badges).toEqual(['ÕV1', 'ÕV3'])
  })

  test('merges consecutive empty assignment title cells', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
              <th style="background-color: rgb(236, 252, 203)">12.04</th>
              <th style="background-color: rgb(236, 252, 203)">13.04</th>
              <th style="background-color: rgb(236, 252, 203)">14.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td><td>A</td><td>A</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [
          { id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Töö' },
          { id: 2, entryDate: '2026-04-12', entryType: 'SISSEKANNE_I' },
          { id: 3, entryDate: '2026-04-13', entryType: 'SISSEKANNE_I' },
          { id: 4, entryDate: '2026-04-14', entryType: 'SISSEKANNE_I' }
        ])
      }
    }

    await feature.run()

    const titleRow = document.querySelector('thead tr.oa2-assignment-title-row')
    const cells = Array.from(titleRow.children).map(cell => stripSoftHyphens(cell.textContent.trim()))
    expect(cells).toEqual(['', 'Töö', ''])
    expect(titleRow.children[2].getAttribute('colspan')).toBe('3')
  })

  test('restores native header rowspan after repeated outcome-row renders', () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    const table = document.querySelector('table')
    const headerCells = feature._getHeaderColumnCells(table)
    const titles = [
      { headerCell: headerCells[0], outcomes: [] },
      { headerCell: headerCells[1], outcomes: [] },
      { headerCell: headerCells[2], outcomes: ['1'] }
    ]

    feature._renderOutcomeRow(table, titles)
    feature._renderOutcomeRow(table, titles)
    feature._renderOutcomeRow(table, titles.map(item => ({ ...item, outcomes: [] })))

    expect(table.querySelector('thead tr:first-child th')?.getAttribute('rowspan')).toBeNull()
  })

  test('does not render an ÕV badge row when no entry has outcomes', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', content: 'Lahenda harjutused.' }])
      }
    }

    await feature.run()

    expect(document.querySelector('thead tr.oa2-assignment-outcome-row')).toBeNull()
  })

  test('renders the title row above the existing header rows', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', content: 'Lahenda harjutused.' }])
      }
    }

    await feature.run()

    const theadRows = Array.from(document.querySelectorAll('thead tr'))
    expect(theadRows[0].classList.contains('oa2-assignment-title-row')).toBe(true)
    expect(theadRows[1].classList.contains('oa2-assignment-title-row')).toBe(false)
  })

  test('keeps title row aligned when left headers use rowspan', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th rowspan="2"></th>
              <th rowspan="2">Nr</th>
              <th rowspan="2">Õppija</th>
              <th colspan="2">Sissekanded</th>
            </tr>
            <tr>
              <th style="background-color: rgb(236, 252, 203)">11.04</th>
              <th style="background-color: rgb(204, 251, 241)">13.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td></td><td>1</td><td>Student 1</td><td>A</td><td>V</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [
          { id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' },
          { id: 2, entryDate: '2026-04-13', entryType: 'SISSEKANNE_P', nameEt: 'Praktiline töö' }
        ])
      }
    }

    await feature.run()

    const titleRow = document.querySelector('thead tr.oa2-assignment-title-row')
    const cells = Array.from(titleRow.children).map(cell => stripSoftHyphens(cell.textContent.trim()))
    expect(cells).toEqual(['', 'Iseseisev töö', 'Praktiline töö'])
    expect(titleRow.children[0].getAttribute('colspan')).toBe('3')
  })

  test('copies sticky layout and borders from source header cells', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th style="position: sticky; left: 0px; width: 49px; border-right: 1px solid rgb(217, 217, 214);"> </th>
              <th style="position: sticky; left: 49px; width: 33px; border-right: 1px solid rgb(217, 217, 214);">Nr</th>
              <th style="position: sticky; left: 82px; width: 201px; border-right: 1px solid rgb(217, 217, 214);">Õppija</th>
              <th style="width: 90px; background-color: rgb(236, 252, 203); border-right: 1px solid rgb(217, 217, 214);">11.04</th>
            </tr>
          </thead>
          <tbody>
            <tr><td></td><td>1</td><td>Student 1</td><td>A</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-04-11', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' }])
      }
    }
    feature._injectCSS()

    await feature.run()

    const titleRow = document.querySelector('thead tr.oa2-assignment-title-row')
    expect(titleRow.children[0].style.position).toBe('sticky')
    expect(titleRow.children[0].style.left).toBe('0px')
    expect(titleRow.children[0].getAttribute('colspan')).toBe('3')
    expect(titleRow.children[0].style.borderRight).toContain('solid')
  })

  test('removes the helper row when no titles are available', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th>25.03</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>5</td></tr>
          </tbody>
        </table>
      </div>
    `

    feature.api = {
      tahvel: {
        get: mock(async () => [{ id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_H' }])
      }
    }

    await feature.run()

    expect(document.querySelector('thead tr.oa2-assignment-title-row')).toBeNull()
  })

  test('does not render after deactivation while entries are still loading', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(252, 231, 243)">25.03</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>4</td></tr>
          </tbody>
        </table>
      </div>
    `

    let resolveEntries
    feature.api = {
      tahvel: {
        get: mock(() => new Promise(resolve => { resolveEntries = resolve }))
      }
    }
    const runPromise = feature.run()
    feature.onDeactivate()
    resolveEntries([{ id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_H', nameEt: 'Kontrolltöö' }])
    await runPromise

    expect(document.querySelector('thead tr.oa2-assignment-title-row')).toBeNull()
  })

  test('retries loading entries after a failed request', async () => {
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Õppija</th>
              <th style="background-color: rgb(252, 231, 243)">25.03</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Student 1</td><td>4</td></tr>
          </tbody>
        </table>
      </div>
    `

    const get = mock()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce([{ id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_H', nameEt: 'Kontrolltöö' }])
    feature.api = { tahvel: { get } }
    await feature.run()
    expect(document.querySelector('thead tr.oa2-assignment-title-row')).toBeNull()

    await feature.run()
    expect(stripSoftHyphens(document.querySelector('thead tr.oa2-assignment-title-row')?.children[1].textContent.trim() || '')).toBe('Kontrolltöö')
    expect(get).toHaveBeenCalledTimes(2)
  })

  test('recognizes the entry modal save button', () => {
    document.body.innerHTML = `
      <add-entry>
        <modal>
          <button>SALVESTA</button>
        </modal>
      </add-entry>
      <button>SALVESTA</button>
      <add-entry>
        <button disabled>SALVESTA</button>
      </add-entry>
    `

    const [entrySaveButton, pageSaveButton, disabledEntrySaveButton] = document.querySelectorAll('button')

    expect(feature._isEntrySaveButtonClick({ target: entrySaveButton })).toBe(true)
    expect(feature._isEntrySaveButtonClick({ target: pageSaveButton })).toBe(false)
    expect(feature._isEntrySaveButtonClick({ target: disabledEntrySaveButton })).toBe(false)
  })

  test('title data requests bypass shared cache to allow retries after transient errors', async () => {
    const get = mock(async () => [{ id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_H', nameEt: 'Kontrolltöö' }])
    feature.api = { tahvel: { get } }

    await feature._loadJournalEntries()
    await feature._loadJournalEntries()
    feature._invalidateEntriesCache()
    await feature._loadJournalEntries()

    expect(get).toHaveBeenCalledTimes(2)
    expect(get.mock.calls[0][2].cache).toBe(false)
    expect(get.mock.calls[1][2].cache).toBe(false)
  })

  test('force refresh bypasses in-memory entry detail cache', async () => {
    const get = mock()
      .mockResolvedValueOnce({ id: 1, nameEt: 'Iseseisev töö', content: 'Vana sisu.' })
      .mockResolvedValueOnce({ id: 1, nameEt: 'Iseseisev töö', content: 'Uus sisu.' })
    feature.api = { tahvel: { get } }

    const first = await feature._loadEntryDetail(123, { id: 1 })
    const cached = await feature._loadEntryDetail(123, { id: 1 })
    const refreshed = await feature._loadEntryDetail(123, { id: 1 }, { forceRefresh: true })

    expect(first.content).toBe('Vana sisu.')
    expect(cached.content).toBe('Vana sisu.')
    expect(refreshed.content).toBe('Uus sisu.')
    expect(get).toHaveBeenCalledTimes(2)
    expect(get.mock.calls[0][2].cache).toBe(false)
    expect(get.mock.calls[1][2].cache).toBe(false)
  })

  test('post-save observer refresh keeps bypassing cache until a successful update run', async () => {
    const get = mock(async () => [{ id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_H', nameEt: 'Kontrolltöö' }])
    feature.api = { tahvel: { get } }
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th>25.03</th></tr>
          </thead>
          <tbody><tr><td>1</td><td>Student 1</td><td>5</td></tr></tbody>
        </table>
      </div>
    `

    feature._pendingPostSaveForceRefresh = true
    feature._forceRefreshUntil = 0
    feature._setupObserver(document.querySelector('table'))

    document.querySelector('tbody').appendChild(document.createElement('tr'))
    await new Promise(resolve => setTimeout(resolve, 150))

    expect(get.mock.calls[0][2].cache).toBe(false)
    expect(feature._pendingPostSaveForceRefresh).toBe(false)
  })

  test('post-save refresh remains pending when required detail loading fails', async () => {
    const get = mock()
      .mockResolvedValueOnce([{ id: 1, entryDate: '2026-03-25', entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' }])
      .mockRejectedValueOnce(new Error('temporary failure'))
    feature.api = { tahvel: { get } }
    document.body.innerHTML = `
      <div id="studentTable">
        <table class="tahvel-table with-borders">
          <thead>
            <tr><th>Nr</th><th>Õppija</th><th style="background-color: rgb(236, 252, 203)">25.03</th></tr>
          </thead>
          <tbody><tr><td>1</td><td>Student 1</td><td>5</td></tr></tbody>
        </table>
      </div>
    `

    feature._pendingPostSaveForceRefresh = true

    await feature.run({ forceRefresh: true, clearPostSaveForceRefreshOnSuccess: true })

    expect(get).toHaveBeenCalledTimes(2)
    expect(feature._pendingPostSaveForceRefresh).toBe(true)
  })
})
