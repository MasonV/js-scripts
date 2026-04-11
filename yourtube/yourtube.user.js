// ==UserScript==
// @name         YourTube
// @namespace    yourtube
// @version      1.1.0
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
	const SCRIPT_VERSION = '1.1.0'
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
	//  FEATURE: SETTINGS UI (floating gear button + side panel)
	//
	//  Mounts a fixed gear button in the bottom-right corner on every
	//  YouTube page. Clicking it opens a slide-in settings panel with the
	//  duration filter controls, circuit-breaker toggles, and the Apply /
	//  Reset / Defaults bottom bar.
	//
	//  The panel shell is intentionally global — settings apply everywhere
	//  YourTube runs, not just on the subs page. You can adjust settings
	//  anywhere and the filter re-runs next time you hit /feed/subscriptions.
	//
	//  MVP scope (this milestone):
	//    - min/max duration text inputs with live-preview parsing
	//    - circuit-breaker toggles for Shorts / Live / Premieres
	//    - Apply / Reset / Defaults bottom bar (Defaults is red)
	//
	//  Next milestone: dual-handle slider with user notches table.
	// ═══════════════════════════════════════════════════════════════════

	const SettingsUI = (() => {
		const ulog = makeLogger('[YourTube/UI]')

		const GEAR_ID = 'yourtube-gear-button'
		const PANEL_ID = 'yourtube-settings-panel'
		const OVERLAY_ID = 'yourtube-settings-overlay'

		// Field IDs — kept as constants so the form wiring below reads
		// cleanly and typos get caught at parse time.
		const FIELD_SHORTER = 'yourtube-shorter'
		const FIELD_LONGER = 'yourtube-longer'
		const BREAKER_SHORTS = 'yourtube-breaker-shorts'
		const BREAKER_LIVE = 'yourtube-breaker-live'
		const BREAKER_PREMIERES = 'yourtube-breaker-premieres'

		let stylesInstalled = false
		let panelBuilt = false
		let panelOpen = false
		let escHandler = null

		// ── Styles ─────────────────────────────────────────────────────

		function installStyles() {
			if (stylesInstalled) return
			stylesInstalled = true
			addStyle(`
				#${GEAR_ID} {
					position: fixed;
					bottom: 24px;
					right: 24px;
					z-index: 9998;
					min-width: 56px;
					height: 56px;
					padding: 0 20px 0 16px;
					border-radius: 28px;
					background: #0f0f0f;
					color: #fff;
					border: 2px solid #3ea6ff;
					box-shadow: 0 4px 16px rgba(0,0,0,0.5);
					font-family: Roboto, "YouTube Sans", Arial, sans-serif;
					font-size: 14px;
					font-weight: 600;
					cursor: pointer;
					display: flex;
					align-items: center;
					gap: 10px;
					transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
				}
				#${GEAR_ID}:hover {
					transform: translateY(-2px);
					box-shadow: 0 8px 24px rgba(62,166,255,0.55);
				}
				#${GEAR_ID} svg {
					width: 22px;
					height: 22px;
					flex-shrink: 0;
				}

				#${OVERLAY_ID} {
					position: fixed;
					inset: 0;
					background: rgba(0,0,0,0.55);
					z-index: 10000;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.18s ease-out;
				}
				#${OVERLAY_ID}.yourtube-open {
					opacity: 1;
					pointer-events: auto;
				}

				#${PANEL_ID} {
					position: fixed;
					top: 0;
					right: 0;
					bottom: 0;
					width: 440px;
					max-width: 100vw;
					z-index: 10001;
					background: #0f0f0f;
					color: #f1f1f1;
					font-family: Roboto, "YouTube Sans", Arial, sans-serif;
					transform: translateX(100%);
					transition: transform 0.22s ease-out;
					display: flex;
					flex-direction: column;
					box-shadow: -8px 0 32px rgba(0,0,0,0.7);
					box-sizing: border-box;
				}
				#${PANEL_ID}.yourtube-open {
					transform: translateX(0);
				}
				#${PANEL_ID} *, #${PANEL_ID} *::before, #${PANEL_ID} *::after {
					box-sizing: border-box;
				}

				.yourtube-header {
					padding: 20px 24px;
					border-bottom: 1px solid #272727;
					display: flex;
					align-items: center;
					justify-content: space-between;
					flex-shrink: 0;
				}
				.yourtube-header h2 {
					margin: 0;
					font-size: 18px;
					font-weight: 600;
					letter-spacing: 0.2px;
				}
				.yourtube-close {
					background: transparent;
					border: none;
					color: #aaa;
					font-size: 26px;
					line-height: 1;
					cursor: pointer;
					width: 36px;
					height: 36px;
					border-radius: 18px;
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 0;
				}
				.yourtube-close:hover { background: #272727; color: #fff; }

				.yourtube-body {
					flex: 1;
					overflow-y: auto;
					padding: 20px 24px 24px 24px;
				}
				.yourtube-section {
					margin-bottom: 28px;
				}
				.yourtube-section:last-child { margin-bottom: 8px; }
				.yourtube-section h3 {
					margin: 0 0 14px 0;
					font-size: 11px;
					text-transform: uppercase;
					letter-spacing: 1.2px;
					color: #9a9a9a;
					font-weight: 700;
				}

				.yourtube-field {
					margin-bottom: 18px;
				}
				.yourtube-field:last-child { margin-bottom: 0; }
				.yourtube-field label {
					display: block;
					margin-bottom: 8px;
					font-size: 14px;
					color: #f1f1f1;
					font-weight: 500;
				}
				.yourtube-field input[type="text"] {
					width: 100%;
					padding: 11px 14px;
					background: #1a1a1a;
					color: #fff;
					border: 1px solid #333;
					border-radius: 8px;
					font-size: 14px;
					font-family: inherit;
					transition: border-color 0.15s, background 0.15s;
				}
				.yourtube-field input[type="text"]::placeholder {
					color: #666;
				}
				.yourtube-field input[type="text"]:focus {
					outline: none;
					border-color: #3ea6ff;
				}
				.yourtube-field input[type="text"].yourtube-error {
					border-color: #ff4444;
					background: #2a1010;
				}
				.yourtube-preview {
					margin-top: 6px;
					font-size: 12px;
					color: #7fdc7f;
					min-height: 16px;
					font-family: "Roboto Mono", monospace;
				}
				.yourtube-preview.yourtube-preview-error { color: #ff6b6b; }
				.yourtube-preview.yourtube-preview-empty { color: #666; font-style: italic; }

				.yourtube-toggles {
					display: flex;
					flex-direction: column;
					gap: 12px;
				}
				.yourtube-breaker {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 14px 18px;
					background: #1a1a1a;
					border: 1px solid #272727;
					border-radius: 10px;
					cursor: pointer;
					user-select: none;
					transition: border-color 0.15s;
				}
				.yourtube-breaker:hover { border-color: #3ea6ff; }
				.yourtube-breaker-label {
					display: flex;
					align-items: center;
					gap: 12px;
					font-size: 15px;
					font-weight: 500;
				}
				.yourtube-breaker-icon {
					width: 24px;
					text-align: center;
					font-size: 16px;
					color: #aaa;
				}

				/* Circuit-breaker switch: dark housing + bright LED when ON.
				   Knob slides horizontally; LED glows green in ON state. */
				.yourtube-switch {
					position: relative;
					width: 68px;
					height: 34px;
					background: #1a1a1a;
					border-radius: 17px;
					border: 2px solid #3a3a3a;
					transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
					flex-shrink: 0;
				}
				.yourtube-switch::after {
					content: '';
					position: absolute;
					top: 3px;
					left: 3px;
					width: 24px;
					height: 24px;
					background: #5a5a5a;
					border-radius: 12px;
					transition: transform 0.2s ease-out, background 0.2s, box-shadow 0.2s;
				}
				.yourtube-switch.yourtube-on {
					background: #0b2a14;
					border-color: #2fdb6c;
					box-shadow: 0 0 12px rgba(47,219,108,0.35), inset 0 0 8px rgba(47,219,108,0.2);
				}
				.yourtube-switch.yourtube-on::after {
					transform: translateX(34px);
					background: #2fdb6c;
					box-shadow: 0 0 10px #2fdb6c, 0 0 18px rgba(47,219,108,0.6);
				}
				.yourtube-switch-label {
					position: absolute;
					top: 50%;
					transform: translateY(-50%);
					font-size: 9px;
					font-weight: 800;
					font-family: "Roboto Mono", monospace;
					letter-spacing: 0.5px;
					transition: opacity 0.2s;
				}
				.yourtube-switch-label.yourtube-on-label {
					left: 8px;
					color: #2fdb6c;
					opacity: 0;
					text-shadow: 0 0 6px #2fdb6c;
				}
				.yourtube-switch-label.yourtube-off-label {
					right: 8px;
					color: #888;
					opacity: 1;
				}
				.yourtube-switch.yourtube-on .yourtube-switch-label.yourtube-on-label { opacity: 1; }
				.yourtube-switch.yourtube-on .yourtube-switch-label.yourtube-off-label { opacity: 0; }

				.yourtube-footer {
					padding: 16px 24px;
					border-top: 1px solid #272727;
					display: flex;
					gap: 10px;
					flex-shrink: 0;
				}
				.yourtube-btn {
					flex: 1;
					padding: 11px 16px;
					border-radius: 8px;
					border: 1px solid #333;
					background: #1a1a1a;
					color: #fff;
					font-size: 14px;
					font-weight: 600;
					font-family: inherit;
					cursor: pointer;
					transition: background 0.12s, border-color 0.12s, color 0.12s;
				}
				.yourtube-btn:hover { background: #272727; }
				.yourtube-btn.yourtube-primary {
					background: #3ea6ff;
					border-color: #3ea6ff;
					color: #000;
				}
				.yourtube-btn.yourtube-primary:hover { background: #65b8ff; border-color: #65b8ff; }
				.yourtube-btn.yourtube-danger {
					border-color: #ff4444;
					color: #ff6666;
				}
				.yourtube-btn.yourtube-danger:hover {
					background: #2a1010;
					color: #ff8888;
					border-color: #ff6666;
				}
			`)
		}

		// ── Gear button ────────────────────────────────────────────────

		function mountGear() {
			if (document.getElementById(GEAR_ID)) return
			const btn = document.createElement('button')
			btn.id = GEAR_ID
			btn.type = 'button'
			btn.setAttribute('aria-label', 'Open YourTube settings')
			btn.innerHTML = `
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
				</svg>
				<span>YourTube</span>
			`
			btn.addEventListener('click', openPanel)
			document.body.appendChild(btn)
		}

		// ── Panel ──────────────────────────────────────────────────────

		function breakerMarkup(id, label, icon) {
			return `
				<div class="yourtube-breaker" data-breaker-target="${id}">
					<div class="yourtube-breaker-label">
						<span class="yourtube-breaker-icon">${icon}</span>
						<span>${label}</span>
					</div>
					<div class="yourtube-switch" id="${id}" role="switch" aria-checked="false" tabindex="0">
						<span class="yourtube-switch-label yourtube-on-label">ON</span>
						<span class="yourtube-switch-label yourtube-off-label">OFF</span>
					</div>
				</div>
			`
		}

		function buildPanel() {
			if (panelBuilt) return
			panelBuilt = true

			const overlay = document.createElement('div')
			overlay.id = OVERLAY_ID
			overlay.addEventListener('click', closePanel)

			const panel = document.createElement('div')
			panel.id = PANEL_ID
			panel.setAttribute('role', 'dialog')
			panel.setAttribute('aria-label', 'YourTube settings')
			panel.innerHTML = `
				<div class="yourtube-header">
					<h2>YourTube Settings</h2>
					<button class="yourtube-close" type="button" aria-label="Close settings">×</button>
				</div>
				<div class="yourtube-body">
					<section class="yourtube-section">
						<h3>Duration filter</h3>
						<div class="yourtube-field">
							<label for="${FIELD_SHORTER}">Hide videos shorter than</label>
							<input id="${FIELD_SHORTER}" type="text" spellcheck="false" autocomplete="off" placeholder="e.g. 5m, 1h30m, 3m 30s — leave blank for no minimum" />
							<div class="yourtube-preview" data-preview-for="${FIELD_SHORTER}"></div>
						</div>
						<div class="yourtube-field">
							<label for="${FIELD_LONGER}">Hide videos longer than</label>
							<input id="${FIELD_LONGER}" type="text" spellcheck="false" autocomplete="off" placeholder="e.g. 20m, 1h — leave blank for no maximum" />
							<div class="yourtube-preview" data-preview-for="${FIELD_LONGER}"></div>
						</div>
					</section>
					<section class="yourtube-section">
						<h3>Hide these kinds of tiles</h3>
						<div class="yourtube-toggles">
							${breakerMarkup(BREAKER_SHORTS, 'Shorts', '▶')}
							${breakerMarkup(BREAKER_LIVE, 'Live streams', '●')}
							${breakerMarkup(BREAKER_PREMIERES, 'Premieres', '◈')}
						</div>
					</section>
				</div>
				<div class="yourtube-footer">
					<button class="yourtube-btn yourtube-primary" data-action="apply" type="button">Apply</button>
					<button class="yourtube-btn" data-action="reset" type="button">Reset</button>
					<button class="yourtube-btn yourtube-danger" data-action="defaults" type="button">Defaults</button>
				</div>
			`

			panel.querySelector('.yourtube-close').addEventListener('click', closePanel)

			// Wire live-preview on the two text inputs. Parsing happens on
			// every keystroke so the user sees their input being understood.
			panel.querySelectorAll('input[type="text"]').forEach((input) => {
				attachLivePreview(input, panel)
			})

			// Wire each circuit-breaker row: clicking anywhere on the row
			// toggles the switch. Keyboard activation on the switch too.
			panel.querySelectorAll('.yourtube-breaker').forEach((row) => {
				const switchEl = row.querySelector('.yourtube-switch')
				const toggle = () => {
					const next = !switchEl.classList.contains('yourtube-on')
					switchEl.classList.toggle('yourtube-on', next)
					switchEl.setAttribute('aria-checked', next ? 'true' : 'false')
				}
				row.addEventListener('click', toggle)
				switchEl.addEventListener('keydown', (e) => {
					if (e.key === ' ' || e.key === 'Enter') {
						e.preventDefault()
						toggle()
					}
				})
			})

			panel.querySelector('[data-action="apply"]').addEventListener('click', onApply)
			panel.querySelector('[data-action="reset"]').addEventListener('click', onReset)
			panel.querySelector('[data-action="defaults"]').addEventListener('click', onDefaults)

			document.body.appendChild(overlay)
			document.body.appendChild(panel)
		}

		// ── Live preview ───────────────────────────────────────────────

		function attachLivePreview(input, panel) {
			const previewEl = panel.querySelector(
				`.yourtube-preview[data-preview-for="${input.id}"]`,
			)
			const update = () => {
				const raw = input.value.trim()
				if (!raw) {
					input.classList.remove('yourtube-error')
					previewEl.className = 'yourtube-preview yourtube-preview-empty'
					previewEl.textContent = '(no bound — all durations allowed)'
					return
				}
				const secs = parseDuration(raw)
				if (secs == null || Number.isNaN(secs)) {
					input.classList.add('yourtube-error')
					previewEl.className = 'yourtube-preview yourtube-preview-error'
					previewEl.textContent = "couldn't parse that"
					return
				}
				input.classList.remove('yourtube-error')
				previewEl.className = 'yourtube-preview'
				previewEl.textContent = `= ${formatDuration(secs)}`
			}
			input.addEventListener('input', update)
			update()
		}

		// ── Form <-> settings sync ─────────────────────────────────────

		function loadFormFromSettings() {
			const s = getSettings().duration
			const shorterEl = document.getElementById(FIELD_SHORTER)
			const longerEl = document.getElementById(FIELD_LONGER)
			shorterEl.value = s.shorterThan != null ? formatDuration(s.shorterThan) : ''
			longerEl.value = s.longerThan != null ? formatDuration(s.longerThan) : ''
			// Fire input events so the live-preview updates.
			shorterEl.dispatchEvent(new Event('input'))
			longerEl.dispatchEvent(new Event('input'))

			setBreaker(BREAKER_SHORTS, s.hideShorts)
			setBreaker(BREAKER_LIVE, s.hideLive)
			setBreaker(BREAKER_PREMIERES, s.hidePremieres)
		}

		function setBreaker(id, on) {
			const el = document.getElementById(id)
			if (!el) return
			el.classList.toggle('yourtube-on', !!on)
			el.setAttribute('aria-checked', on ? 'true' : 'false')
		}

		function getBreaker(id) {
			const el = document.getElementById(id)
			return el ? el.classList.contains('yourtube-on') : false
		}

		function readFormDuration(fieldId) {
			const raw = document.getElementById(fieldId).value.trim()
			if (!raw) return { ok: true, value: null }
			const secs = parseDuration(raw)
			if (secs == null || Number.isNaN(secs)) return { ok: false, value: null }
			return { ok: true, value: secs }
		}

		// ── Button handlers ────────────────────────────────────────────

		function onApply() {
			const shorter = readFormDuration(FIELD_SHORTER)
			const longer = readFormDuration(FIELD_LONGER)
			if (!shorter.ok || !longer.ok) {
				ulog.warn('Apply blocked — one or more fields cannot be parsed')
				return
			}
			const next = {
				...getSettings(),
				duration: {
					shorterThan: shorter.value,
					longerThan: longer.value,
					hideShorts: getBreaker(BREAKER_SHORTS),
					hideLive: getBreaker(BREAKER_LIVE),
					hidePremieres: getBreaker(BREAKER_PREMIERES),
				},
			}
			saveSettings(next)
			ulog.log('Settings saved', next.duration)
			DurationFilter.applyFilter()
			closePanel()
		}

		// Reset = discard edits, reload last-saved values into the form.
		function onReset() {
			loadFormFromSettings()
			ulog.log('Form reset to saved settings')
		}

		// Defaults = wipe settings back to factory. Confirm first because
		// this is destructive (the button is red for a reason).
		function onDefaults() {
			const ok = confirm(
				'Reset all YourTube settings to defaults?\n\nThis clears every filter bound and toggle.',
			)
			if (!ok) return
			saveSettings(structuredCloneCompat(DEFAULT_SETTINGS))
			loadFormFromSettings()
			DurationFilter.applyFilter()
			ulog.log('Reset to defaults')
		}

		// ── Open / close ───────────────────────────────────────────────

		function openPanel() {
			if (panelOpen) return
			panelOpen = true
			loadFormFromSettings()
			document.getElementById(OVERLAY_ID).classList.add('yourtube-open')
			document.getElementById(PANEL_ID).classList.add('yourtube-open')
			// ESC closes the panel. Bind once per open so we don't accumulate
			// listeners; unbind on close.
			escHandler = (e) => {
				if (e.key === 'Escape') closePanel()
			}
			document.addEventListener('keydown', escHandler)
		}

		function closePanel() {
			if (!panelOpen) return
			panelOpen = false
			const overlay = document.getElementById(OVERLAY_ID)
			const panel = document.getElementById(PANEL_ID)
			if (overlay) overlay.classList.remove('yourtube-open')
			if (panel) panel.classList.remove('yourtube-open')
			if (escHandler) {
				document.removeEventListener('keydown', escHandler)
				escHandler = null
			}
		}

		function init() {
			installStyles()
			mountGear()
			buildPanel()
		}

		return { init, openPanel, closePanel }
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTING / INIT
	// ═══════════════════════════════════════════════════════════════════

	function runFeatures() {
		SettingsUI.init()
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

	log(`Initialized v${SCRIPT_VERSION} — click the YourTube button bottom-right to open settings`)

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
