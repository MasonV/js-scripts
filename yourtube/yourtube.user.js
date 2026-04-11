// ==UserScript==
// @name         YourTube
// @namespace    yourtube
// @version      1.0.0
// @description  YouTube without the garbage — duration filtering, and more features to come
// @match        *://www.youtube.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/yourtube/yourtube.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/yourtube/yourtube.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[YourTube]'
	const LOG_PREFIX_DURATION = '[YourTube/Duration]'
	const SCRIPT_VERSION = '1.0.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yourtube/yourtube.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yourtube/yourtube.user.js'

	// All YourTube features share a single settings blob, keyed per-feature.
	const SETTINGS_KEY = 'yourtube_settings_v1'
	const ONBOARDED_KEY = 'yourtube_onboarded_v1'
	const UPDATE_BANNER_ID = 'yourtube-update-banner'

	// Page routes — which features run where.
	const ROUTE_SUBS = '/feed/subscriptions'

	// ═══════════════════════════════════════════════════════════════════
	//  LOGGING
	// ═══════════════════════════════════════════════════════════════════

	function log(msg, ...args) {
		console.log(`${LOG_PREFIX} ${msg}`, ...args)
	}

	function warn(msg, ...args) {
		console.warn(`${LOG_PREFIX} ${msg}`, ...args)
	}

	// Per-feature scoped logger. Use inside feature modules so a glance at the
	// console tells you which feature is talking.
	function makeLogger(prefix) {
		return {
			log: (msg, ...args) => console.log(`${prefix} ${msg}`, ...args),
			warn: (msg, ...args) => console.warn(`${prefix} ${msg}`, ...args),
			error: (msg, ...args) => console.error(`${prefix} ${msg}`, ...args),
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TIME PARSER (pure functions — testing candidates)
	//  Shared utility — any feature that needs duration parsing uses this.
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
		// Each component is a number followed by a unit. The lookahead rejects
		// only letters — `\b` wouldn't fire between two word characters like
		// the `h` and `3` in `1h30m`, but `(?![a-z])` correctly separates units
		// from digits while still excluding false matches like `heures`.
		const componentRe =
			/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g
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
	//  FEATURE: DURATION FILTER (subscription feed)
	//  Hides videos in the subscription grid whose duration falls outside
	//  the user's configured range. UI to be wired in a subsequent commit.
	// ═══════════════════════════════════════════════════════════════════

	const DurationFilter = (() => {
		const flog = makeLogger(LOG_PREFIX_DURATION)

		function shouldRunHere() {
			return window.location.pathname.startsWith(ROUTE_SUBS)
		}

		function init() {
			if (!shouldRunHere()) return
			flog.log('Feature active on subscription feed (UI not yet wired)')
			// DOM detection, filter, and UI layers land in subsequent commits.
		}

		return { init, shouldRunHere }
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTING / INIT
	// ═══════════════════════════════════════════════════════════════════

	function runFeatures() {
		DurationFilter.init()
		// Future features register here.
	}

	selfTestParser()
	runFeatures()

	// YouTube is a SPA — re-run routing after every client-side navigation so
	// features can activate/deactivate as the user moves between pages.
	document.addEventListener('yt-navigate-finish', () => {
		runFeatures()
	})

	log(`Initialized v${SCRIPT_VERSION} (parser milestone — UI not yet wired)`)

	// Dev-only exposes for in-browser inspection. Removed before shipping.
	// Firefox's content script sandbox wraps function references crossing the
	// boundary — direct assignment to unsafeWindow gives the page side a wrapper
	// it can't call. exportFunction() is Firefox's official escape hatch.
	// Chrome's Tampermonkey doesn't need it, so we fall back to direct assignment.
	function devExpose(name, fn) {
		if (typeof exportFunction === 'function') {
			exportFunction(fn, unsafeWindow, { defineAs: name })
		} else {
			unsafeWindow[name] = fn
		}
	}
	devExpose('__yourtube_parseDuration', parseDuration)
	devExpose('__yourtube_formatDuration', formatDuration)
})()
