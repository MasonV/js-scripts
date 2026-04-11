// ==UserScript==
// @name         YourTube
// @namespace    yourtube
// @version      1.1.6
// @description  YouTube without the garbage — duration filtering, and more features to come
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @match        *://m.youtube.com/*
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
	const SCRIPT_VERSION = '1.1.6'
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
			// Watch the document root (documentElement) — YouTube swaps out
			// the grid container on SPA navigation and narrow observers
			// fall off. We observe the root instead of body because body
			// itself can be replaced on this user's YT variant (see the
			// v1.1.2 debug probe diagnosis). The mutation callback filters
			// down to tile-related records so we don't burn cycles on
			// every internal mutation.
			observer = new MutationObserver(onMutations)
			observer.observe(document.documentElement, { childList: true, subtree: true })
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

	// ═══════════════════════════════════════════════════════════════════
	//  DEBUG PROBE — multi-variant UI mount test
	//
	//  The v1.1.1 production UI isn't appearing for the user. This probe
	//  mounts five highly-visible debug markers using different DOM mount
	//  strategies so we can see which approach survives on their specific
	//  YouTube setup. When the user reports which markers are visible
	//  (and which aren't), we'll know exactly which mount strategy to
	//  adopt for the real gear button.
	//
	//  Variants:
	//    A (red)     — document.body.appendChild (current strategy)
	//    B (orange)  — document.documentElement.appendChild (sibling of body)
	//    C (yellow)  — ytd-app.appendChild (into YouTube's app shell)
	//    D (green)   — Shadow DOM (impervious to YT's CSS leakage)
	//    E (purple)  — full-width top bar, prepended to body
	//
	//  Each marker is inline-styled (no GM_addStyle dependency), placed at
	//  fixed position with max-int z-index, and clickable. Clicking any
	//  marker pops an alert() — if that works, event wiring is intact.
	//  The probe retries every 500ms for the first ~10s and audits the
	//  DOM every 2s for 30s, logging which markers survived.
	// ═══════════════════════════════════════════════════════════════════

	const DebugProbe = (() => {
		const dlog = makeLogger('[YourTube/Debug]')
		const PROBE_PREFIX = 'yourtube-debug-probe-'

		// Fires BEFORE any deferred work. If this line is missing from the
		// console, the script didn't even reach the probe definition.
		dlog.log('⭐ MODULE LOADED at', new Date().toISOString())

		// Creates a fixed-position badge element. Uses setAttribute('style')
		// rather than style.cssText so it's impossible for YT's CSS or our
		// own stylesheet to override critical positioning.
		function makeBadge(id, label, bg, color, posCss) {
			const el = document.createElement('div')
			el.id = PROBE_PREFIX + id
			el.textContent = label
			el.setAttribute(
				'style',
				[
					'position: fixed',
					posCss,
					`background: ${bg}`,
					`color: ${color}`,
					'padding: 8px 14px',
					'font: bold 13px/1 monospace',
					'z-index: 2147483647',
					'border-radius: 6px',
					'border: 2px solid #fff',
					'box-shadow: 0 2px 12px rgba(0,0,0,0.7)',
					'cursor: pointer',
					'pointer-events: auto',
					'user-select: none',
				].join('; '),
			)
			el.addEventListener('click', () => {
				dlog.log(`Marker ${id} clicked`)
				try {
					alert(`[YourTube Debug] Marker ${id} is alive and clickable.`)
				} catch (_) {}
			})
			return el
		}

		function tryA_Body() {
			try {
				if (document.getElementById(PROBE_PREFIX + 'A')) return
				if (!document.body) {
					dlog.warn('A (body): document.body missing')
					return
				}
				document.body.appendChild(
					makeBadge('A', 'A: BODY', '#e53935', '#fff', 'top: 8px; left: 8px'),
				)
				dlog.log('✅ A (body): mounted')
			} catch (e) {
				dlog.warn('A (body): failed', e)
			}
		}

		function tryB_DocElement() {
			try {
				if (document.getElementById(PROBE_PREFIX + 'B')) return
				document.documentElement.appendChild(
					makeBadge('B', 'B: HTML', '#fb8c00', '#fff', 'top: 8px; left: 130px'),
				)
				dlog.log('✅ B (html): mounted')
			} catch (e) {
				dlog.warn('B (html): failed', e)
			}
		}

		function tryC_YtdApp() {
			try {
				if (document.getElementById(PROBE_PREFIX + 'C')) return
				const host = document.querySelector('ytd-app')
				if (!host) {
					dlog.warn('C (ytd-app): ytd-app element not found')
					return
				}
				host.appendChild(
					makeBadge('C', 'C: YTD-APP', '#fdd835', '#000', 'top: 8px; left: 260px'),
				)
				dlog.log('✅ C (ytd-app): mounted')
			} catch (e) {
				dlog.warn('C (ytd-app): failed', e)
			}
		}

		function tryD_Shadow() {
			try {
				if (document.getElementById(PROBE_PREFIX + 'D-host')) return
				if (!document.body) {
					dlog.warn('D (shadow): document.body missing')
					return
				}
				const host = document.createElement('div')
				host.id = PROBE_PREFIX + 'D-host'
				host.setAttribute(
					'style',
					'position: fixed; top: 8px; left: 400px; z-index: 2147483647;',
				)
				const root = host.attachShadow({ mode: 'open' })
				const style = document.createElement('style')
				style.textContent = `
					.marker {
						background: #43a047;
						color: #fff;
						padding: 8px 14px;
						font: bold 13px/1 monospace;
						border-radius: 6px;
						border: 2px solid #fff;
						box-shadow: 0 2px 12px rgba(0,0,0,0.7);
						cursor: pointer;
						user-select: none;
					}
				`
				const badge = document.createElement('div')
				badge.className = 'marker'
				badge.textContent = 'D: SHADOW'
				badge.addEventListener('click', () => {
					dlog.log('Marker D clicked')
					try {
						alert('[YourTube Debug] Marker D (shadow DOM) is alive.')
					} catch (_) {}
				})
				root.appendChild(style)
				root.appendChild(badge)
				document.body.appendChild(host)
				dlog.log('✅ D (shadow): mounted')
			} catch (e) {
				dlog.warn('D (shadow): failed', e)
			}
		}

		function tryE_TopBar() {
			try {
				if (document.getElementById(PROBE_PREFIX + 'E')) return
				if (!document.body) {
					dlog.warn('E (top-bar): document.body missing')
					return
				}
				const el = document.createElement('div')
				el.id = PROBE_PREFIX + 'E'
				el.textContent =
					'[YourTube DEBUG] v1.1.2 LOADED — click this bar to confirm script is running'
				el.setAttribute(
					'style',
					[
						'position: fixed',
						'top: 0',
						'left: 0',
						'right: 0',
						'background: #6a1b9a',
						'color: #fff',
						'padding: 12px 16px',
						'font: bold 14px/1.2 sans-serif',
						'z-index: 2147483647',
						'text-align: center',
						'border-bottom: 3px solid #fff',
						'box-shadow: 0 2px 20px rgba(0,0,0,0.8)',
						'cursor: pointer',
						'pointer-events: auto',
						'user-select: none',
					].join('; '),
				)
				el.addEventListener('click', () => {
					dlog.log('Marker E clicked')
					try {
						alert('[YourTube Debug] Marker E (top bar) is alive.')
					} catch (_) {}
				})
				document.body.appendChild(el)
				dlog.log('✅ E (top-bar): mounted')
			} catch (e) {
				dlog.warn('E (top-bar): failed', e)
			}
		}

		function audit(label) {
			const present = []
			const missing = []
			for (const id of ['A', 'B', 'C', 'D', 'E']) {
				const lookup = id === 'D' ? PROBE_PREFIX + 'D-host' : PROBE_PREFIX + id
				if (document.getElementById(lookup)) {
					present.push(id)
				} else {
					missing.push(id)
				}
			}
			dlog.log(
				`📊 AUDIT [${label}] present: [${present.join(', ') || 'none'}] | missing: [${missing.join(', ') || 'none'}]`,
			)
		}

		function mountAll() {
			tryA_Body()
			tryB_DocElement()
			tryC_YtdApp()
			tryD_Shadow()
			tryE_TopBar()
		}

		function init() {
			dlog.log('init() called — launching probes')
			mountAll()
			// Retry cadence: catches cases where body/ytd-app appear after
			// our first attempt, or where YT clobbers our mount.
			const retries = [200, 500, 1000, 2000, 4000, 7000, 10000]
			for (const delay of retries) {
				setTimeout(() => {
					mountAll()
					audit(`${delay}ms`)
				}, delay)
			}
			// Long-running audit to see if YT removes our markers later.
			setTimeout(() => audit('15s'), 15000)
			setTimeout(() => audit('30s'), 30000)
		}

		return { init, mountAll, audit }
	})()

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
			try {
				addStyle(`
				/* ── Header pill — anchored top-right below YouTube's masthead ──
				   Visual language matches ytm-desktop-handoff and ytm-data-panel:
				   subtle border, blurred dark background, muted text, pill
				   radius, accent on hover. */
				#${GEAR_ID} {
					position: fixed;
					top: 72px;
					right: 16px;
					z-index: 2147483646;
					display: inline-flex;
					align-items: center;
					gap: 4px;
					padding: 0 4px 0 14px;
					height: 36px;
					border: 1px solid rgba(255, 255, 255, 0.12);
					background: rgba(15, 15, 15, 0.88);
					backdrop-filter: blur(8px);
					-webkit-backdrop-filter: blur(8px);
					color: #cfcfcf;
					font-family: 'YouTube Sans', 'Roboto', sans-serif;
					font-size: 13px;
					font-weight: 500;
					line-height: 1;
					border-radius: 999px;
					box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
					user-select: none;
					transition: background 0.15s, color 0.15s,
						border-color 0.15s, box-shadow 0.15s;
				}
				#${GEAR_ID}:hover {
					background: rgba(62, 166, 255, 0.18);
					color: #fff;
					border-color: rgba(62, 166, 255, 0.55);
					box-shadow: 0 6px 22px rgba(62, 166, 255, 0.35);
				}
				#${GEAR_ID} .yourtube-gear-open {
					display: inline-flex;
					align-items: center;
					gap: 8px;
					background: transparent;
					color: inherit;
					border: 0;
					padding: 0;
					margin: 0;
					height: 100%;
					font: inherit;
					line-height: 1;
					cursor: pointer;
				}
				#${GEAR_ID} .yourtube-gear-open:active {
					transform: scale(0.97);
				}
				#${GEAR_ID} .yourtube-gear-icon {
					font-size: 16px;
					line-height: 1;
					flex-shrink: 0;
				}
				#${GEAR_ID} .yourtube-gear-label {
					line-height: 1;
				}
				#${GEAR_ID} .yourtube-gear-divider {
					width: 1px;
					height: 18px;
					background: rgba(255, 255, 255, 0.12);
					margin: 0 2px;
				}
				#${GEAR_ID} .yourtube-gear-close {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					width: 24px;
					height: 24px;
					border-radius: 50%;
					background: transparent;
					color: #9a9a9a;
					border: 0;
					padding: 0;
					margin: 0;
					font-size: 16px;
					font-family: inherit;
					line-height: 1;
					cursor: pointer;
					transition: background 0.12s ease-out, color 0.12s ease-out;
				}
				#${GEAR_ID} .yourtube-gear-close:hover {
					background: rgba(255, 255, 255, 0.08);
					color: #fff;
				}

				#${OVERLAY_ID} {
					position: fixed;
					inset: 0;
					background: rgba(0,0,0,0.55);
					z-index: 2147483645;
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
					z-index: 2147483647;
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
				stylesInstalled = true
				ulog.log('Styles installed')
			} catch (e) {
				ulog.warn('Style install failed, continuing with inline fallbacks:', e)
			}
		}

		// ── Gear button ────────────────────────────────────────────────

		// localStorage key that remembers whether the user dismissed the
		// header pill. When set, mountGear() is a no-op and the self-heal
		// observer won't remount — the user explicitly said "hide me". A
		// dev-exposed `__yourtube_showHeader()` clears the flag so the
		// user can recover from the console if they want the pill back.
		const HEADER_HIDDEN_KEY = 'yourtube_header_hidden_v1'

		function isHeaderHidden() {
			try {
				return localStorage.getItem(HEADER_HIDDEN_KEY) === '1'
			} catch (_) {
				return false
			}
		}

		function setHeaderHidden(hidden) {
			try {
				if (hidden) {
					localStorage.setItem(HEADER_HIDDEN_KEY, '1')
				} else {
					localStorage.removeItem(HEADER_HIDDEN_KEY)
				}
			} catch (e) {
				ulog.warn('setHeaderHidden: localStorage write failed:', e)
			}
		}

		// Critical inline styles — used as a belt-and-suspenders fallback
		// in case GM_addStyle is blocked or runs late. The CSS class is
		// the preferred path and wins over inline styles for hover /
		// transition. Visual language matches ytm-desktop-handoff and
		// ytm-data-panel: subtle border, blurred dark background, muted
		// text, pill radius. Positioned at `top: 72px` to sit below
		// YouTube's masthead rather than overlapping it.
		const GEAR_INLINE_STYLE = [
			'position: fixed',
			'top: 72px',
			'right: 16px',
			'z-index: 2147483646',
			'display: inline-flex',
			'align-items: center',
			'gap: 4px',
			'padding: 0 4px 0 14px',
			'height: 36px',
			'border: 1px solid rgba(255,255,255,0.12)',
			'background: rgba(15,15,15,0.88)',
			'color: #cfcfcf',
			'font-family: "YouTube Sans", Roboto, Arial, sans-serif',
			'font-size: 13px',
			'font-weight: 500',
			'line-height: 1',
			'border-radius: 999px',
			'box-shadow: 0 6px 20px rgba(0,0,0,0.5)',
		].join('; ')

		function mountGear() {
			if (document.getElementById(GEAR_ID)) return false
			// Respect the "dismissed" flag — if the user explicitly closed
			// the pill, don't fight them by remounting. Recovery path is
			// __yourtube_showHeader() from the devtools console.
			if (isHeaderHidden()) return false
			// Mount target is document.documentElement (the <html> element),
			// not document.body. The v1.1.2 debug probe proved that YouTube
			// wipes or replaces body-level children we add — only children
			// appended to documentElement survive YT's SPA churn on this
			// user's setup. See DebugProbe "B (html)" for the original
			// diagnosis.
			const root = document.documentElement
			if (!root) {
				ulog.warn('mountGear: document.documentElement not ready, deferring')
				return false
			}
			// The pill is a <div> container rather than a <button> so the
			// inner open-button and close-button don't nest (invalid HTML)
			// and so click events on the close-button don't bubble-fire the
			// open-button at the same time.
			//
			// Everything is built via createElement + appendChild +
			// textContent — NOT innerHTML. YouTube ships a Trusted Types
			// CSP (`require-trusted-types-for 'script'`) which throws
			// `Sink type mismatch violation` on every `.innerHTML = ...`
			// assignment. The SVG gear was also dropped in favour of the
			// ⚙ unicode glyph to avoid createElementNS ceremony and match
			// the lightweight icon approach in ytm-desktop-handoff (↗).
			const pill = document.createElement('div')
			pill.id = GEAR_ID
			pill.setAttribute('role', 'group')
			pill.setAttribute('aria-label', 'YourTube header')
			pill.setAttribute('style', GEAR_INLINE_STYLE)

			const openBtn = document.createElement('button')
			openBtn.type = 'button'
			openBtn.className = 'yourtube-gear-open'
			openBtn.setAttribute('aria-label', 'Open YourTube settings')
			openBtn.setAttribute('title', 'Open YourTube settings')

			const iconEl = document.createElement('span')
			iconEl.className = 'yourtube-gear-icon'
			iconEl.setAttribute('aria-hidden', 'true')
			iconEl.textContent = '\u2699' // ⚙

			const labelEl = document.createElement('span')
			labelEl.className = 'yourtube-gear-label'
			labelEl.textContent = 'YourTube'

			openBtn.appendChild(iconEl)
			openBtn.appendChild(labelEl)

			const divider = document.createElement('span')
			divider.className = 'yourtube-gear-divider'
			divider.setAttribute('aria-hidden', 'true')

			const closeBtn = document.createElement('button')
			closeBtn.type = 'button'
			closeBtn.className = 'yourtube-gear-close'
			closeBtn.setAttribute('aria-label', 'Hide YourTube header')
			closeBtn.setAttribute(
				'title',
				'Hide header (run __yourtube_showHeader() in console to restore)',
			)
			closeBtn.textContent = '\u00d7' // ×

			pill.appendChild(openBtn)
			pill.appendChild(divider)
			pill.appendChild(closeBtn)

			openBtn.addEventListener('click', openPanel)
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				setHeaderHidden(true)
				pill.remove()
				ulog.log('Header hidden — restore with __yourtube_showHeader()')
			})
			root.appendChild(pill)
			ulog.log('Gear mounted (header pill)')
			return true
		}

		/**
		 * Clears the hidden flag and force-remounts the pill. Used by the
		 * dev expose `__yourtube_showHeader()` for console-based recovery
		 * if the user dismissed the header and wants it back.
		 */
		function showHeader() {
			setHeaderHidden(false)
			const existing = document.getElementById(GEAR_ID)
			if (existing) existing.remove()
			mountGear()
			ulog.log('Header restored')
		}

		// ── Panel ──────────────────────────────────────────────────────

		/**
		 * Builds one labelled text-input row for the Duration Filter
		 * section (label + text input + live-preview echo). Returns the
		 * wrapping .yourtube-field element.
		 */
		function buildDurationField(inputId, labelText, placeholder) {
			const field = document.createElement('div')
			field.className = 'yourtube-field'

			const label = document.createElement('label')
			label.setAttribute('for', inputId)
			label.textContent = labelText

			const input = document.createElement('input')
			input.id = inputId
			input.type = 'text'
			input.spellcheck = false
			input.setAttribute('autocomplete', 'off')
			input.placeholder = placeholder

			const preview = document.createElement('div')
			preview.className = 'yourtube-preview'
			preview.setAttribute('data-preview-for', inputId)

			field.appendChild(label)
			field.appendChild(input)
			field.appendChild(preview)
			return field
		}

		/**
		 * Builds a circuit-breaker row as a DOM subtree. Returns the
		 * outer .yourtube-breaker element ready to be appended.
		 *
		 * Previously returned an HTML string, but YouTube's Trusted Types
		 * CSP (`require-trusted-types-for 'script'`) blocks every
		 * `.innerHTML = ...` assignment, so the whole SettingsUI builds
		 * its DOM via createElement + textContent instead.
		 */
		function buildBreaker(id, label, icon) {
			const row = document.createElement('div')
			row.className = 'yourtube-breaker'
			row.setAttribute('data-breaker-target', id)

			const labelWrap = document.createElement('div')
			labelWrap.className = 'yourtube-breaker-label'
			const iconSpan = document.createElement('span')
			iconSpan.className = 'yourtube-breaker-icon'
			iconSpan.textContent = icon
			const textSpan = document.createElement('span')
			textSpan.textContent = label
			labelWrap.appendChild(iconSpan)
			labelWrap.appendChild(textSpan)

			const sw = document.createElement('div')
			sw.className = 'yourtube-switch'
			sw.id = id
			sw.setAttribute('role', 'switch')
			sw.setAttribute('aria-checked', 'false')
			sw.setAttribute('tabindex', '0')
			const onLabel = document.createElement('span')
			onLabel.className = 'yourtube-switch-label yourtube-on-label'
			onLabel.textContent = 'ON'
			const offLabel = document.createElement('span')
			offLabel.className = 'yourtube-switch-label yourtube-off-label'
			offLabel.textContent = 'OFF'
			sw.appendChild(onLabel)
			sw.appendChild(offLabel)

			row.appendChild(labelWrap)
			row.appendChild(sw)
			return row
		}

		function buildPanel() {
			if (panelBuilt && document.getElementById(PANEL_ID)) return false
			// Same reasoning as mountGear: mount to documentElement, not
			// body. See SettingsUI.mountGear for context.
			const root = document.documentElement
			if (!root) {
				ulog.warn('buildPanel: document.documentElement not ready, deferring')
				return false
			}
			// Reset the flag if we're rebuilding after YouTube removed
			// our panel from the DOM (SPA navigation, app shell swap).
			panelBuilt = true

			const overlay = document.createElement('div')
			overlay.id = OVERLAY_ID
			overlay.addEventListener('click', closePanel)

			// Built via DOM APIs rather than innerHTML because YouTube's
			// Trusted Types CSP (`require-trusted-types-for 'script'`)
			// blocks every `.innerHTML = ...` assignment with a "Sink
			// type mismatch violation". See buildBreaker above.
			const panel = document.createElement('div')
			panel.id = PANEL_ID
			panel.setAttribute('role', 'dialog')
			panel.setAttribute('aria-label', 'YourTube settings')

			// ── Header ─────────────────────────────────────────────
			const header = document.createElement('div')
			header.className = 'yourtube-header'
			const headerTitle = document.createElement('h2')
			headerTitle.textContent = 'YourTube Settings'
			const headerClose = document.createElement('button')
			headerClose.className = 'yourtube-close'
			headerClose.type = 'button'
			headerClose.setAttribute('aria-label', 'Close settings')
			headerClose.textContent = '\u00d7' // ×
			header.appendChild(headerTitle)
			header.appendChild(headerClose)

			// ── Body ───────────────────────────────────────────────
			const body = document.createElement('div')
			body.className = 'yourtube-body'

			// Duration filter section
			const durationSection = document.createElement('section')
			durationSection.className = 'yourtube-section'
			const durationH3 = document.createElement('h3')
			durationH3.textContent = 'Duration filter'
			durationSection.appendChild(durationH3)
			durationSection.appendChild(
				buildDurationField(
					FIELD_SHORTER,
					'Hide videos shorter than',
					'e.g. 5m, 1h30m, 3m 30s — leave blank for no minimum',
				),
			)
			durationSection.appendChild(
				buildDurationField(
					FIELD_LONGER,
					'Hide videos longer than',
					'e.g. 20m, 1h — leave blank for no maximum',
				),
			)

			// Circuit-breaker section
			const breakerSection = document.createElement('section')
			breakerSection.className = 'yourtube-section'
			const breakerH3 = document.createElement('h3')
			breakerH3.textContent = 'Hide these kinds of tiles'
			breakerSection.appendChild(breakerH3)
			const toggles = document.createElement('div')
			toggles.className = 'yourtube-toggles'
			toggles.appendChild(buildBreaker(BREAKER_SHORTS, 'Shorts', '\u25b6')) // ▶
			toggles.appendChild(buildBreaker(BREAKER_LIVE, 'Live streams', '\u25cf')) // ●
			toggles.appendChild(buildBreaker(BREAKER_PREMIERES, 'Premieres', '\u25c8')) // ◈
			breakerSection.appendChild(toggles)

			body.appendChild(durationSection)
			body.appendChild(breakerSection)

			// ── Footer ─────────────────────────────────────────────
			const footer = document.createElement('div')
			footer.className = 'yourtube-footer'
			const applyBtn = document.createElement('button')
			applyBtn.className = 'yourtube-btn yourtube-primary'
			applyBtn.setAttribute('data-action', 'apply')
			applyBtn.type = 'button'
			applyBtn.textContent = 'Apply'
			const resetBtn = document.createElement('button')
			resetBtn.className = 'yourtube-btn'
			resetBtn.setAttribute('data-action', 'reset')
			resetBtn.type = 'button'
			resetBtn.textContent = 'Reset'
			const defaultsBtn = document.createElement('button')
			defaultsBtn.className = 'yourtube-btn yourtube-danger'
			defaultsBtn.setAttribute('data-action', 'defaults')
			defaultsBtn.type = 'button'
			defaultsBtn.textContent = 'Defaults'
			footer.appendChild(applyBtn)
			footer.appendChild(resetBtn)
			footer.appendChild(defaultsBtn)

			panel.appendChild(header)
			panel.appendChild(body)
			panel.appendChild(footer)

			headerClose.addEventListener('click', closePanel)

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

			root.appendChild(overlay)
			root.appendChild(panel)
			ulog.log('Panel built')
			return true
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

		// ── Mount lifecycle ────────────────────────────────────────────

		let healObserver = null
		// Debounce for heal checks — YT's DOM churns constantly; we check
		// at most once per animation frame.
		let healPending = false

		/**
		 * Verifies the gear + panel are still in the DOM and remounts them
		 * if YouTube's SPA churn has pruned them. Idempotent — cheap to
		 * call from a hot MutationObserver path.
		 */
		function ensureMounted() {
			let changed = false
			if (!document.getElementById(GEAR_ID)) {
				if (mountGear()) changed = true
			}
			if (!document.getElementById(PANEL_ID)) {
				// Reset flag so buildPanel rebuilds from scratch.
				panelBuilt = false
				if (buildPanel()) changed = true
			}
			return changed
		}

		function scheduleHealCheck() {
			if (healPending) return
			healPending = true
			requestAnimationFrame(() => {
				healPending = false
				try {
					ensureMounted()
				} catch (e) {
					ulog.warn('Heal check failed:', e)
				}
			})
		}

		/**
		 * Watches document.documentElement (not body — body itself can be
		 * swapped out by extensions) for child mutations and re-runs the
		 * heal check whenever something changes. Cheap because ensureMounted
		 * is two getElementById calls in the hot path.
		 */
		function startSelfHeal() {
			if (healObserver) return
			healObserver = new MutationObserver(scheduleHealCheck)
			healObserver.observe(document.documentElement, {
				childList: true,
				subtree: true,
			})
			ulog.log('Self-heal observer installed')
		}

		/**
		 * We mount onto document.documentElement (the <html> element),
		 * which exists essentially as soon as the page parser starts.
		 * This helper is kept for symmetry and as a safety net — in the
		 * degenerate case where documentElement isn't yet present, we
		 * schedule a microtask retry.
		 */
		function waitForRoot(cb) {
			if (document.documentElement) {
				cb()
				return
			}
			ulog.log('Waiting for document.documentElement...')
			// documentElement is parsed extremely early; if it's missing
			// we must be pre-parse. A microtask retry is enough.
			queueMicrotask(() => waitForRoot(cb))
		}

		function init() {
			try {
				waitForRoot(() => {
					installStyles()
					ensureMounted()
					startSelfHeal()
				})
			} catch (e) {
				ulog.warn('init failed:', e)
			}
		}

		return { init, openPanel, closePanel, ensureMounted, showHeader }
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTING / INIT
	// ═══════════════════════════════════════════════════════════════════

	// Opt-in flag: set `localStorage.setItem('yourtube_debug_probe_v1', '1')`
	// in the devtools console and reload to enable the DebugProbe for UI
	// mount diagnostics. Defaults to off so the markers don't clutter the
	// page in normal use.
	function isDebugProbeEnabled() {
		try {
			return localStorage.getItem('yourtube_debug_probe_v1') === '1'
		} catch (_) {
			return false
		}
	}

	function runFeatures() {
		if (isDebugProbeEnabled()) {
			// Probe runs FIRST so we see mount results even if the
			// real SettingsUI mount crashes later in the chain.
			DebugProbe.init()
		}
		SettingsUI.init()
		DurationFilter.init()
		// Future features register here.
	}

	selfTestParser()
	runFeatures()

	// YouTube is a SPA. On client-side navigation, YT can tear down
	// and rebuild large sections of the DOM — including our mounted
	// gear button and panel. We listen to every nav/page event YT
	// emits so we can re-run routing and let the features heal
	// themselves. `ensureMounted()` is idempotent and cheap.
	const SPA_EVENTS = [
		'yt-navigate-finish',
		'yt-navigate-start',
		'yt-page-data-updated',
		'yt-page-type-changed',
		'spfdone', // legacy YouTube SPA event, harmless if unused
	]
	for (const evt of SPA_EVENTS) {
		document.addEventListener(evt, () => {
			runFeatures()
		})
	}

	// Belt-and-suspenders: if all the SPA events above fail to fire
	// on some YT variant, a low-frequency poll will still notice a
	// missing gear and remount. Runs every 2s, checks a single
	// getElementById — negligible cost, high resilience payoff.
	setInterval(() => {
		try {
			SettingsUI.ensureMounted()
		} catch (e) {
			/* swallow — ensureMounted already logs internally */
		}
	}, 2000)

	log(
		`Initialized v${SCRIPT_VERSION} — look for the "YourTube" pill top-right of the page. ` +
			`Click × on the pill to hide it; run __yourtube_showHeader() in this console to restore.`,
	)

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

	// Recovery command: if the user dismissed the header pill and wants
	// it back, they can run `__yourtube_showHeader()` from the devtools
	// console. Not a "dev-only" expose — this is the only re-entry point
	// once the pill is hidden, so it ships with the script.
	devExpose('__yourtube_showHeader', () => {
		try {
			SettingsUI.showHeader()
			console.log('[YourTube] Header restored')
		} catch (e) {
			console.warn('[YourTube] Failed to restore header:', e)
		}
	})

	// Toggles for the UI-mount debug probe. Use from devtools console:
	//   __yourtube_enableDebugProbe()  then reload
	//   __yourtube_disableDebugProbe() then reload
	// The probe mounts labeled test badges using five different DOM
	// strategies so we can diagnose future UI insertion failures on
	// YouTube variants or page layouts where our current approach breaks.
	devExpose('__yourtube_enableDebugProbe', () => {
		try {
			localStorage.setItem('yourtube_debug_probe_v1', '1')
			console.log('[YourTube] Debug probe ENABLED — reload the page')
		} catch (e) {
			console.warn('[YourTube] Failed to enable debug probe:', e)
		}
	})
	devExpose('__yourtube_disableDebugProbe', () => {
		try {
			localStorage.removeItem('yourtube_debug_probe_v1')
			console.log('[YourTube] Debug probe DISABLED — reload the page')
		} catch (e) {
			console.warn('[YourTube] Failed to disable debug probe:', e)
		}
	})
	// Also allow invoking the probe one-shot without persisting the flag.
	devExpose('__yourtube_runDebugProbe', () => DebugProbe.init())
})()
