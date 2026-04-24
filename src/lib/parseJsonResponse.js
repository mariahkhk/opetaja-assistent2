/**
 * Parse a response body as JSON, throwing tagged errors on empty/invalid input.
 *
 * @param {string} text - Raw response body text.
 * @param {string} urlString - Full URL (query string and fragment are stripped before inclusion in errors).
 * @returns {*} Parsed JSON value (object, array, or primitive like null/true/false).
 * @throws {Error} `API Error: parseJsonResponse called with non-string url (<typeof>)` when urlString is not a string.
 * @throws {Error} `API Error: parseJsonResponse called with non-string text (<typeof>)` when text is not a string.
 * @throws {Error} `API Error: empty response from <url>` when text is empty or whitespace-only.
 * @throws {Error} `API Error: invalid JSON response from <url>: <parseError.message>` when JSON.parse fails;
 *                  the original `SyntaxError` is attached as `.cause`.
 */
export function parseJsonResponse(text, urlString) {
  if (typeof urlString !== 'string') {
    throw new Error(
      `API Error: parseJsonResponse called with non-string url (${typeof urlString})`,
      { cause: new TypeError(`urlString was ${typeof urlString}`) }
    )
  }
  if (typeof text !== 'string') {
    throw new Error(
      `API Error: parseJsonResponse called with non-string text (${typeof text})`,
      { cause: new TypeError(`text was ${typeof text}`) }
    )
  }
  // Strip query string and fragment to keep session-sensitive data out of Sentry/logs
  const safeUrl = urlString.split('?')[0].split('#')[0]
  if (text.trim() === '') {
    throw new Error(`API Error: empty response from ${safeUrl}`)
  }
  try {
    return JSON.parse(text)
  } catch (parseError) {
    throw new Error(`API Error: invalid JSON response from ${safeUrl}: ${parseError.message}`, { cause: parseError })
  }
}
