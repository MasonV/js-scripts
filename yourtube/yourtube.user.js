// ==UserScript==
// @name         YourTube
// @namespace    yourtube
// @version      1.0.1
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
	const SCRIPT_VERSION = '1.0.1'
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
	//  SETTINGS (single blob, keyed per-feature)
	//  Shared by all features. Defaults are intentionally conservative —
	//  on first install nothing is hidden until the user opens the UI
	//  and configures something.
	// ═══════════════════════════════════════════════════════════════════

	const DEFAULT_SETTINGS = {
		duration: {
			shorterThan: null, // seconds; null = no lower bound
			longerThan: null, // seconds; null = no upper bound
			hideShorts: false,
			hideLive: false,
			hidePremieres: false,
		},
	}

	function getSettings() {
		try {
			const raw = localStorage.getItem(SETTINGS_KEY)
			if (!raw) return structuredCloneCompat(DEFAULT_SETTINGS)
			const parsed = JSON.parse(raw)
			// Shallow-merge per feature so new defaults land without wiping
			// the user's existing preferences.
			return {
				...DEFAULT_SETTINGS,
				...parsed,
				duration: {
					...DEFAULT_SETTINGS.duration,
					...(parsed && parsed.duration ? parsed.duration : {}),
				},
			}
		} catch (e) {
			warn('Failed to read settings, using defaults:', e)
			return structuredCloneCompat(DEFAULT_SETTINGS)
		}
	}

	function saveSettings(next) {
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
		} catch (e) {
			warn('Failed to save settings:', e)
		}
	}

	// structuredClone may not be present in very old browsers; fall back to
	// JSON round-trip. DEFAULT_SETTINGS contains only JSON-safe values.
	function structuredCloneCompat(obj) {
		if (typeof structuredClone === 'function') return structuredClone(obj)
		return JSON.parse(JSON.stringify(obj))
	}

	// GM_addStyle is Tampermonkey-provided. Violentmonkey also supports it,
	// but if we ever run somewhere that doesn't, fall back to a style element.
	function addStyle(css) {
		if (typeof GM_addStyle === 'function') {
			GM_addStyle(css)
			return
		}
		const el = document.createElement('style')
		el.textContent = css
		document.head.appendChild(el)
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
	//
	//  Lifecycle:
	//    1. init() is called on script load and on every yt-navigate-finish
	//    2. If the current page is not the subs feed → teardown observer
	//    3. Otherwise install CSS (once), scan current tiles, watch the grid
	//       for new tiles, and apply the filter on each mutation
	//
	//  DOM layout on /feed/subscriptions:
	//    ytd-rich-grid-renderer
	//      └─ ytd-rich-item-renderer (one per tile)
	//           └─ ytd-rich-grid-media
	//                └─ ytd-thumbnail-overlay-time-status-renderer
	//                     └─ span (contains "12:34" / "1:23:45" / "LIVE" / etc.)
	//    ytd-rich-shelf-renderer[is-shorts] contains Shorts tiles
	//
	//  Selectors are intentionally loose and probed in a fallback chain —
	//  YouTube's DOM changes and we'd rather degrade than hard-break.
	// ═══════════════════════════════════════════════════════════════════

	const DurationFilter = (() => {
		const flog = makeLogger(LOG_PREFIX_DURATION)

		const HIDDEN_CLASS = 'yourtube-duration-hidden'
		const STYLES_INSTALLED_FLAG = 'yourtube-duration-styles-installed'

		const SELECTORS = {
			tile: 'ytd-rich-item-renderer',
			shortsShelf: 'ytd-rich-shelf-renderer[is-shorts]',
			durationBadge: 'ytd-thumbnail-overlay-time-status-renderer',
		}

		// Strict duration shape: M:SS or H:MM:SS, nothing else. We use this to
		// pull a duration out of a tile by walking text nodes when the badge
		// element selector fails (YouTube renames wrappers periodically).
		const DURATION_TEXT_RE = /^\d+:\d{1,2}(?::\d{1,2})?$/

		let observer = null
		let stylesInstalled = false
		let scanPending = false
		// Last scan summary string. We compare against this each scan and only
		// log when something actually changed — keeps the console quiet during
		// the storm of YouTube's internal mutations.
		let lastScanSignature = ''

		function shouldRunHere() {
			return window.location.pathname.startsWith(ROUTE_SUBS)
		}

		// ── DOM reading ────────────────────────────────────────────────

		/**
		 * Pulls the visible text out of a time-status badge. YouTube has used
		 * different inner element IDs/classes over the years; try each and
		 * fall back to the badge's own textContent.
		 */
		function readBadgeText(badge) {
			const candidates = [
				badge.querySelector('#text'),
				badge.querySelector('.badge-shape-wiz__text'),
				badge.querySelector('span'),
				badge,
			]
			for (const el of candidates) {
				if (!el) continue
				const text = (el.textContent || '').trim()
				if (text) return text
			}
			return ''
		}

		/**
		 * DOM-walker fallback: returns the first text node inside `tile` whose
		 * trimmed content strictly matches the duration shape (M:SS or H:MM:SS).
		 *
		 * This is what saves us when YouTube renames the badge wrapper element —
		 * the duration string itself almost always still exists somewhere in
		 * the tile, even if our preferred selector misses. We strict-match the
		 * full text node content to avoid false hits like timestamps embedded
		 * in titles ("Watch this at 3:45...").
		 */
		function findDurationTextInTile(tile) {
			const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT, null)
			let node
			while ((node = walker.nextNode())) {
				const text = (node.nodeValue || '').trim()
				if (text && DURATION_TEXT_RE.test(text)) return text
			}
			return ''
		}

		/**
		 * Detects live/premiere/shorts state by scanning tile text for the
		 * canonical badge labels. Used as a fallback when the badge element
		 * itself isn't found by selector.
		 */
		function detectStateFromText(tile) {
			const text = (tile.textContent || '').toUpperCase()
			if (/\bLIVE\b/.test(text)) return 'live'
			if (/\bPREMIERE/.test(text) || /\bUPCOMING\b/.test(text)) return 'premiere'
			if (/\bSHORTS\b/.test(text)) return 'short'
			return null
		}

		/**
		 * Classifies a tile and (if applicable) reads its duration.
		 * Returns { seconds, kind } where kind is one of:
		 *   'video'    — standard video with a parseable duration
		 *   'short'    — inside a Shorts shelf, or badge text includes SHORTS
		 *   'live'     — currently streaming
		 *   'premiere' — scheduled / upcoming
		 *   'unknown'  — couldn't classify (badge missing or unparseable)
		 * `seconds` is null for non-video kinds.
		 *
		 * Resolution order:
		 *   1. Shorts shelf wrapper (most reliable signal)
		 *   2. Time-status badge element (preferred when YT renders it)
		 *   3. Tree-walker for a duration-shaped text node anywhere in the tile
		 *   4. Text scan for LIVE / PREMIERE / SHORTS labels
		 */
		function readTile(tile) {
			if (tile.closest(SELECTORS.shortsShelf)) {
				return { seconds: null, kind: 'short' }
			}

			// 1. Preferred path: time-status badge element.
			const badge = tile.querySelector(SELECTORS.durationBadge)
			if (badge) {
				const style = (badge.getAttribute('overlay-style') || '').toUpperCase()
				if (style === 'LIVE') return { seconds: null, kind: 'live' }
				if (style === 'UPCOMING') return { seconds: null, kind: 'premiere' }

				const text = readBadgeText(badge)
				if (text) {
					const upper = text.toUpperCase()
					if (upper.includes('LIVE')) return { seconds: null, kind: 'live' }
					if (upper.includes('PREMIERE') || upper.includes('UPCOMING')) {
						return { seconds: null, kind: 'premiere' }
					}
					if (upper === 'SHORTS') return { seconds: null, kind: 'short' }

					const seconds = parseDuration(text)
					if (seconds != null && !Number.isNaN(seconds)) {
						return { seconds, kind: 'video' }
					}
				}
			}

			// 2. Fallback: walk text nodes for a duration-shaped string.
			const walked = findDurationTextInTile(tile)
			if (walked) {
				const seconds = parseDuration(walked)
				if (seconds != null && !Number.isNaN(seconds)) {
					return { seconds, kind: 'video' }
				}
			}

			// 3. Fallback: scan visible text for state labels.
			const state = detectStateFromText(tile)
			if (state) return { seconds: null, kind: state }

			return { seconds: null, kind: 'unknown' }
		}

		// ── Filter evaluation ──────────────────────────────────────────

		/**
		 * Decides whether a tile should be visible given current settings.
		 * Returns true to show, false to hide. Unknown-kind tiles are never
		 * hidden — if we can't classify it, the safe default is to show it.
		 */
		function evaluateTile(info, settings) {
			switch (info.kind) {
				case 'short':
					return !settings.hideShorts
				case 'live':
					return !settings.hideLive
				case 'premiere':
					return !settings.hidePremieres
				case 'unknown':
					return true
				case 'video': {
					if (settings.shorterThan != null && info.seconds < settings.shorterThan) {
						return false
					}
					if (settings.longerThan != null && info.seconds > settings.longerThan) {
						return false
					}
					return true
				}
				default:
					return true
			}
		}

		// ── Application ────────────────────────────────────────────────

		function installStyles() {
			if (stylesInstalled) return
			stylesInstalled = true
			addStyle(`
				.${HIDDEN_CLASS} {
					display: none !important;
				}
			`)
			flog.log('Styles installed')
		}

		/**
		 * Scans every tile currently in the DOM, classifies it, applies the
		 * current filter, and logs a summary. Idempotent — safe to call on
		 * every mutation. Bails out if we're no longer on the subs page, since
		 * the broad document.body observer can fire mid-SPA-navigation.
		 */
		function applyFilter() {
			if (!shouldRunHere()) return
			const settings = getSettings().duration
			const tiles = document.querySelectorAll(SELECTORS.tile)

			const kinds = { video: 0, short: 0, live: 0, premiere: 0, unknown: 0 }
			let visible = 0
			let hidden = 0

			for (const tile of tiles) {
				const info = readTile(tile)
				kinds[info.kind] = (kinds[info.kind] || 0) + 1

				const show = evaluateTile(info, settings)
				if (show) {
					tile.classList.remove(HIDDEN_CLASS)
					visible++
				} else {
					tile.classList.add(HIDDEN_CLASS)
					hidden++
				}
			}

			// Skip the log if nothing changed since last scan. The observer
			// is broad and fires constantly during normal page life — without
			// dedup we'd flood the console with identical lines.
			const signature = `${tiles.length}|${visible}|${hidden}|${kinds.video}|${kinds.short}|${kinds.live}|${kinds.premiere}|${kinds.unknown}`
			if (signature !== lastScanSignature) {
				lastScanSignature = signature
				flog.log(
					`Scan: ${tiles.length} tiles (${visible} visible, ${hidden} hidden)`,
					kinds,
				)
			}
		}

		/**
		 * Debounces filter application to once per animation frame. The
		 * subs grid fires dozens of mutations during lazy-load and we'd
		 * otherwise run the filter on every one.
		 */
		function scheduleScan() {
			if (scanPending) return
			scanPending = true
			requestAnimationFrame(() => {
				scanPending = false
				applyFilter()
			})
		}

		/**
		 * Returns true if `node` is, contains, or is contained-by a tile element.
		 * Used to filter mutation records so we only re-scan when an actual
		 * tile is added or removed, not on every internal lit-element churn.
		 */
		function isTileRelated(node) {
			if (!node || node.nodeType !== Node.ELEMENT_NODE) return false
			if (node.matches && node.matches(SELECTORS.tile)) return true
			if (node.querySelector && node.querySelector(SELECTORS.tile)) return true
			if (node.closest && node.closest(SELECTORS.tile)) return true
			return false
		}

		function onMutations(records) {
			for (const rec of records) {
				for (const n of rec.addedNodes) {
					if (isTileRelated(n)) {
						scheduleScan()
						return
					}
				}
				for (const n of rec.removedNodes) {
					if (isTileRelated(n)) {
						scheduleScan()
						return
					}
				}
			}
		}

		function watchGrid() {
			if (observer) observer.disconnect()
			// Watch the whole body — YouTube swaps out the grid container on
			// SPA navigation and narrow observers fall off. The mutation
			// callback filters down to tile-related records so we don't burn
			// cycles on every internal mutation.
			observer = new MutationObserver(onMutations)
			observer.observe(document.body, { childList: true, subtree: true })
			flog.log('Observer installed')
		}

		function teardown() {
			if (observer) {
				observer.disconnect()
				observer = null
				flog.log('Observer torn down')
			}
		}

		function init() {
			if (!shouldRunHere()) {
				teardown()
				return
			}
			installStyles()
			// Initial scan + schedule — the initial scan catches tiles already
			// in the DOM, the observer catches everything that appears after.
			applyFilter()
			watchGrid()
		}

		return { init, shouldRunHere, readTile, evaluateTile, applyFilter }
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

	log(`Initialized v${SCRIPT_VERSION} (detection milestone — UI not yet wired)`)

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
	devExpose('__yourtube_getSettings', getSettings)
	devExpose('__yourtube_applyFilter', DurationFilter.applyFilter)
})()
