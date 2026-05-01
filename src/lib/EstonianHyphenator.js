const ESTONIAN_VOWELS = new Set(Array.from('aeiouõäöüAEIOUÕÄÖÜ'))

const COMMON_ESTONIAN_DIPHTHONGS = new Set([
  'ae',
'ai',
'ao',
'au',
  'ea',
'ei',
'eo',
'eu',
  'iu',
  'oa',
'oe',
'oi',
'ou',
  'ui',
  'õa',
'õe',
'õi',
'õo',
'õu',
  'äe',
'äi',
'äo',
'äu',
  'öa',
'öe',
'öi',
  'üi'
])

const FOREIGN_DIPHTHONGS = new Set(['ia', 'ie', 'io', 'ua', 'ue', 'uo', 'üa', 'üe', 'üo'])
const FOREIGN_CONSONANT_MULTIGRAPHS = ['sch', 'dž', 'ch', 'sh', 'ph', 'th', 'ck']

export default class EstonianHyphenator {
  static hyphenate(text, {
    marker = '\u00AD',
    exceptions = {},
    allowForeignDiphthongs = false,
    keepForeignConsonantMultigraphs = true
  } = {}) {
    const exceptionMap = new Map(
      Object.entries(exceptions).map(([word, pattern]) => [word.toLocaleLowerCase('et-EE'), pattern])
    )

    return text.replace(/\p{L}+/gu, word => {
      const key = word.toLocaleLowerCase('et-EE')
      if (exceptionMap.has(key)) return EstonianHyphenator.#applyExceptionPattern(word, exceptionMap.get(key), marker)
      return EstonianHyphenator.#hyphenateWord(word, { marker, allowForeignDiphthongs, keepForeignConsonantMultigraphs })
    })
  }

  static #hyphenateWord(word, options) {
    const chars = Array.from(word)
    const breaks = new Set()
    const n = chars.length

    for (let i = 0; i < n;) {
      if (!EstonianHyphenator.#isVowel(chars[i])) {
        i += 1
        continue
      }

      const vStart = i
      while (i < n && EstonianHyphenator.#isVowel(chars[i])) i += 1
      const vEnd = i

      for (const offset of EstonianHyphenator.#vowelRunBreakOffsets(chars.slice(vStart, vEnd), options)) {
        breaks.add(vStart + offset)
      }

      const cStart = i
      while (i < n && !EstonianHyphenator.#isVowel(chars[i])) i += 1
      const cEnd = i

      if (cStart < cEnd && i < n) {
        const units = EstonianHyphenator.#consonantUnits(chars, cStart, cEnd, options.keepForeignConsonantMultigraphs)
        breaks.add(units[units.length - 1].start)
      }
    }

    const legalBreaks = [...breaks].filter(pos => pos >= 2 && n - pos >= 2).sort((a, b) => a - b)
    return EstonianHyphenator.#insertMarkers(chars, legalBreaks, options.marker)
  }

  static #isVowel(ch) {
    return ESTONIAN_VOWELS.has(ch)
  }

  static #sameVowel(a, b) {
    return a.toLocaleLowerCase('et-EE') === b.toLocaleLowerCase('et-EE')
  }

  static #normalizedPair(a, b) {
    return (a + b).toLocaleLowerCase('et-EE')
  }

  static #isLongVowelOrDiphthong(a, b, { allowForeignDiphthongs }) {
    const pair = EstonianHyphenator.#normalizedPair(a, b)

    return (
      EstonianHyphenator.#sameVowel(a, b) ||
      COMMON_ESTONIAN_DIPHTHONGS.has(pair) ||
      (allowForeignDiphthongs && FOREIGN_DIPHTHONGS.has(pair))
    )
  }

  static #vowelRunBreakOffsets(run, options) {
    const n = run.length
    if (n <= 1) return []

    if (n === 2) return EstonianHyphenator.#isLongVowelOrDiphthong(run[0], run[1], options) ? [] : [1]

    if (n === 3) {
      const first = EstonianHyphenator.#isLongVowelOrDiphthong(run[0], run[1], options)
      const second = EstonianHyphenator.#isLongVowelOrDiphthong(run[1], run[2], options)
      const firstLong = EstonianHyphenator.#sameVowel(run[0], run[1])
      const secondLong = EstonianHyphenator.#sameVowel(run[1], run[2])

      if (first && !second) return [2]
      if (!first && second) return [1]
      if (first && second) return secondLong && !firstLong ? [1] : [2]
      return [1, 2]
    }

    if (n === 4) {
      const p01 = EstonianHyphenator.#isLongVowelOrDiphthong(run[0], run[1], options)
      const p12 = EstonianHyphenator.#isLongVowelOrDiphthong(run[1], run[2], options)
      const p23 = EstonianHyphenator.#isLongVowelOrDiphthong(run[2], run[3], options)

      if (p01 && p23) return [2]
      if (p12) return [1, 3]
    }

    const parts = []
    for (let i = 0; i < n;) {
      if (i + 1 < n && EstonianHyphenator.#isLongVowelOrDiphthong(run[i], run[i + 1], options)) {
        parts.push(2)
        i += 2
      } else {
        parts.push(1)
        i += 1
      }
    }

    const offsets = []
    let pos = 0
    for (const len of parts.slice(0, -1)) {
      pos += len
      offsets.push(pos)
    }
    return offsets
  }

  static #consonantUnits(chars, start, end, keepForeign) {
    if (!keepForeign) {
      return Array.from({ length: end - start }, (_, idx) => ({ start: start + idx, end: start + idx + 1 }))
    }

    const units = []
    for (let i = start; i < end;) {
      let matched = null

      for (const graph of FOREIGN_CONSONANT_MULTIGRAPHS) {
        const graphChars = Array.from(graph)
        const slice = chars.slice(i, i + graphChars.length).join('').toLocaleLowerCase('et-EE')
        if (i + graphChars.length <= end && slice === graph) {
          matched = { start: i, end: i + graphChars.length }
          break
        }
      }

      units.push(matched ?? { start: i, end: i + 1 })
      i = units[units.length - 1].end
    }

    return units
  }

  static #insertMarkers(chars, breaks, marker) {
    const set = new Set(breaks)
    let out = ''

    for (let i = 0; i <= chars.length; i += 1) {
      if (set.has(i)) out += marker
      if (i < chars.length) out += chars[i]
    }

    return out
  }

  static #applyExceptionPattern(word, pattern, marker) {
    if (Array.isArray(pattern)) return EstonianHyphenator.#insertMarkers(Array.from(word), pattern, marker)

    const chars = Array.from(word)
    let out = ''
    let i = 0

    for (const p of Array.from(String(pattern))) {
      if (p === '-') out += marker
      else if (i < chars.length) out += chars[i++]
    }

    while (i < chars.length) out += chars[i++]
    return out
  }
}
