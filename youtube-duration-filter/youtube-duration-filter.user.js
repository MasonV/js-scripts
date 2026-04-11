// ==UserScript==
// @name         YourTube — Duration Filter
// @namespace    youtube-duration-filter
// @version      1.0.0
// @description  Filter videos on the YouTube subscription feed by duration, with a slider, notches, and circuit-breaker toggles for Shorts/Live/Premieres
// @match        *://www.youtube.com/feed/subscriptions*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/youtube-duration-filter/youtube-duration-filter.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/youtube-duration-filter/youtube-duration-filter.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[YourTube/Duration]'
	const SCRIPT_VERSION = '1.0.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/youtube-duration-filter/youtube-duration-filter.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/youtube-duration-filter/youtube-duration-filter.user.js'

	const SETTINGS_KEY = 'youtube_duration_filter_settings_v1'
	const ONBOARDED_KEY = 'youtube_duration_filter_onboarded_v1'
	const UPDATE_BANNER_ID = 'ydf-update-banner'

	// ═══════════════════════════════════════════════════════════════════
	//  LOGGING
	// ═══════════════════════════════════════════════════════════════════

	function log(msg, ...args) {
		console.log(`${LOG_PREFIX} ${msg}`, ...args)
	}

	function warn(msg, ...args) {
		console.warn(`${LOG_PREFIX} ${msg}`, ...args)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TIME PARSER (pure functions — testing candidates)
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Parses a duration string into seconds.
	 *
	 * Returns null for empty/whitespace input.
	 * Returns NaN for unparseable input (caller decides how to surface).
	 *
	 * Accepts (case-insensitive, whitespace-tolerant):
	 *   "5m", "5 min", "5 minutes"      → 300
	 *   "1h", "1h30m", "1h 30m"         → 3600, 5400
	 *   "3.5m", "3.5 minutes"           → 210
	 *   "3m 30s"                        → 210
	 *   "90s", "90 sec"                 → 90
	 *   "90"                            → 5400  (bare number = minutes)
	 *   "5:00", "1:30:00"               → 300, 5400
	 *   ""                              → null
	 */
	function parseDuration(input) {
		if (input == null) return null
		const raw = String(input).trim().toLowerCase()
		if (raw === '') return null

		// Colon notation: M:SS or H:MM:SS
		if (/^\d+(:\d{1,2}){1,2}$/.test(raw)) {
			const parts = raw.split(':').map(Number)
			if (parts.some(Number.isNaN)) return NaN
			let seconds = 0
			if (parts.length === 2) {
				seconds = parts[0] * 60 + parts[1]
			} else {
				seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
			}
			return seconds
		}

		// Bare number = minutes (allows decimals: "3.5" → 210)
		if (/^\d+(\.\d+)?$/.test(raw)) {
			return Math.round(parseFloat(raw) * 60)
		}

		// Unit-tagged: e.g. "1h30m", "3m 30s", "3.5 minutes"
		// Each component is a number followed by a unit. Strip spaces between
		// number and unit, sum across components.
		const componentRe = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g
		let total = 0
		let matched = false
		let match
		// Track consumed characters so we can detect leftover garbage.
		let consumed = ''
		while ((match = componentRe.exec(raw)) !== null) {
			matched = true
			consumed += match[0]
			const value = parseFloat(match[1])
			const unit = match[2]
			if (unit.startsWith('h')) total += value * 3600
			else if (unit.startsWith('m')) total += value * 60
			else if (unit.startsWith('s')) total += value
		}
		if (!matched) return NaN

		// Reject if there are non-whitespace characters that didn't match.
		const stripped = raw.replace(/\s+/g, '')
		const consumedStripped = consumed.replace(/\s+/g, '')
		if (stripped !== consumedStripped) return NaN

		return Math.round(total)
	}

	/**
	 * Formats seconds back into a natural-language preview.
	 *   300  → "5 minutes"
	 *   5400 → "1 hour 30 minutes"
	 *   90   → "1 minute 30 seconds"
	 *   60   → "1 minute"
	 *   0    → "0 seconds"
	 *   null → ""
	 */
	function formatDuration(seconds) {
		if (seconds == null) return ''
		if (!Number.isFinite(seconds)) return ''
		const total = Math.max(0, Math.round(seconds))
		if (total === 0) return '0 seconds'

		const h = Math.floor(total / 3600)
		const m = Math.floor((total % 3600) / 60)
		const s = total % 60

		const parts = []
		if (h > 0) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`)
		if (m > 0) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`)
		if (s > 0) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`)
		return parts.join(' ')
	}

	// Smoke-test the parser on load so we catch regressions immediately.
	// Logged as a single grouped console message.
	function selfTestParser() {
		const cases = [
			['', null],
			['   ', null],
			['5m', 300],
			['5 min', 300],
			['5 minutes', 300],
			['5:00', 300],
			['1h', 3600],
			['1h30m', 5400],
			['1h 30m', 5400],
			['1:30:00', 5400],
			['3.5m', 210],
			['3.5 minutes', 210],
			['3m 30s', 210],
			['90s', 90],
			['90 sec', 90],
			['90', 5400],
			['1:23:45', 5025],
			['12:34', 754],
			['gibberish', NaN],
			['5x', NaN],
		]
		const failures = []
		for (const [input, expected] of cases) {
			const got = parseDuration(input)
			const ok =
				(Number.isNaN(expected) && Number.isNaN(got)) ||
				(expected === null && got === null) ||
				got === expected
			if (!ok) failures.push({ input, expected, got })
		}
		if (failures.length === 0) {
			log(`parseDuration self-test: ${cases.length} cases passed`)
		} else {
			warn(`parseDuration self-test: ${failures.length} failures`, failures)
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT (parser-only milestone — UI to follow)
	// ═══════════════════════════════════════════════════════════════════

	selfTestParser()
	log(`Initialized v${SCRIPT_VERSION} (parser milestone — UI not yet wired)`)

	// Expose for in-browser inspection during development.
	// Will be removed once the UI is wired.
	// eslint-disable-next-line no-undef
	if (typeof unsafeWindow !== 'undefined') {
		// nothing yet
	}
	window.__ydf_parseDuration = parseDuration
	window.__ydf_formatDuration = formatDuration
})()
