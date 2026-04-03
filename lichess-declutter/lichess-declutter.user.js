// ==UserScript==
// @name         Lichess Declutter
// @namespace    lichess-declutter
// @version      1.4.0
// @description  Strips the lichess homepage down to essentials: quick play, puzzle, and articles in a single screen
// @match        *://lichess.org/
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Lichess Declutter]'
	const SCRIPT_VERSION = '1.4.0'
	const STORAGE_KEY = 'lichess_declutter_hidden_pools_v1'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.user.js'

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
	//  DOM HELPERS
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Waits for an element matching `selector` to appear in the DOM.
	 * Uses MutationObserver so it works regardless of render timing
	 * (fixes Brave / Chromium MV3 where DOMContentLoaded fires before
	 * Lichess's Snabbdom has rendered the lobby).
	 */
	function waitForElement(selector, timeoutMs = 10000) {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector(selector)
			if (existing) return resolve(existing)

			const observer = new MutationObserver(() => {
				const el = document.querySelector(selector)
				if (el) {
					observer.disconnect()
					clearTimeout(timer)
					resolve(el)
				}
			})

			observer.observe(document.documentElement, {
				childList: true,
				subtree: true,
			})

			const timer = setTimeout(() => {
				observer.disconnect()
				reject(new Error(`Timed out waiting for ${selector}`))
			}, timeoutMs)
		})
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CSS — HIDE, FILTER, AND RELAYOUT
	// ═══════════════════════════════════════════════════════════════════

	// All hiding and layout done via CSS so it survives lichess's
	// virtual DOM redraws (snabbdom patches wipe inline styles).

	const DECLUTTER_CSS = `
		/* ─── Hidden sections ─── */

		.lobby__streams { display: none !important; }
		.lobby__spotlights { display: none !important; }
		.about-side { display: none !important; }
		.lobby__app .tabs-horiz { display: none !important; }
		.lobby__start { display: none !important; }
		.lobby__table { display: none !important; }
		.lobby__tv { display: none !important; }
		.lobby__support { display: none !important; }
		.lobby__feed { display: none !important; }
		.lobby__tournaments-simuls { display: none !important; }
		.lobby__tournaments { display: none !important; }
		.lobby__timeline { display: none !important; }
		.lobby__side { display: none !important; }

		/* ─── Pool button filter ─── */
		/* Pool visibility is controlled dynamically via #declutter-pool-styles.
		   Hidden pools are injected as CSS rules from localStorage prefs. */

		/* ─── Two-column layout: pools+news left, puzzle right ─── */

		main.lobby {
			display: grid !important;
			grid-template-columns: 1fr 1fr !important;
			grid-template-rows: auto auto auto !important;
			grid-template-areas:
				"pools  puzzle"
				"blog   blog"
				"footer footer" !important;
			max-width: 960px !important;
			margin: 0 auto !important;
			padding: 0.75em 1em !important;
			gap: 0.75em !important;
		}

		/* Pool buttons — left column */
		.lobby__app {
			grid-area: pools !important;
			width: 100% !important;
		}

		.lpools {
			display: flex !important;
			flex-direction: column !important;
			align-items: stretch !important;
			gap: 0.5em !important;
			padding: 0.5em 0 !important;
		}

		/* Make visible pool buttons larger and more prominent */
		.lpool {
			font-size: 1.3em !important;
			padding: 0.75em 1em !important;
			justify-content: center !important;
		}

		/* ─── Pool config gear ─── */

		.lobby__app {
			position: relative !important;
		}

		#declutter-pool-config-btn {
			position: absolute;
			top: 0.25em;
			right: 0.25em;
			background: none;
			border: none;
			color: #999;
			cursor: pointer;
			font-size: 1.1em;
			padding: 0.2em 0.4em;
			z-index: 10;
			line-height: 1;
		}
		#declutter-pool-config-btn:hover {
			color: #fff;
		}

		#declutter-pool-config {
			position: absolute;
			top: 2em;
			right: 0;
			background: #262421;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 0.6em 0.8em;
			z-index: 100;
			min-width: 140px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.4);
		}

		#declutter-pool-config label {
			display: flex;
			align-items: center;
			gap: 0.4em;
			padding: 0.25em 0;
			color: #bababa;
			font-size: 0.85em;
			cursor: pointer;
			white-space: nowrap;
		}
		#declutter-pool-config label:hover {
			color: #fff;
		}

		/* Puzzle of the day — right column */
		.lobby__puzzle {
			grid-area: puzzle !important;
			width: 100% !important;
			margin: 0 !important;
		}

		/* Blog / articles — full width below both columns */
		.lobby__blog {
			grid-area: blog !important;
			width: 100% !important;
			margin: 0 !important;
		}

		/* Compress article card images to save vertical space */
		.lobby__blog .ublog-post-card__image {
			max-height: 140px !important;
			object-fit: cover !important;
		}

		/* Footer links */
		.lobby__about {
			grid-area: footer !important;
			width: 100% !important;
		}

		/* Player counter injected into the header */
		#declutter-player-count {
			color: #bababa;
			font-size: 0.85em;
			margin-right: 1em;
			white-space: nowrap;
		}

		/* Update banner */
		#declutter-update-banner {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			z-index: 9999;
			background: #3b82f6;
			color: #fff;
			text-align: center;
			padding: 0.5em 1em;
			font-size: 0.9em;
			cursor: pointer;
		}
		#declutter-update-banner:hover {
			background: #2563eb;
		}
	`

	/**
	 * Injects the main stylesheet. Uses GM_addStyle when available,
	 * falls back to a <style> element for Chromium MV3 environments
	 * where GM_addStyle may silently fail at document-start.
	 */
	function injectCSS() {
		try {
			GM_addStyle(DECLUTTER_CSS)
			log('CSS injected via GM_addStyle')
		} catch (e) {
			warn('GM_addStyle failed, using fallback:', e)
			injectCSSFallback()
		}

		// Verify CSS actually applied — Brave/Chromium MV3 can silently
		// swallow GM_addStyle if <head> doesn't exist yet at document-start.
		function verify() {
			const el = document.querySelector('.lobby__streams')
			if (!el) return // element not in DOM yet, CSS will apply when it arrives
			const style = getComputedStyle(el)
			if (style.display !== 'none') {
				warn('CSS did not apply, re-injecting via fallback')
				injectCSSFallback()
			}
		}

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', verify)
		} else {
			verify()
		}
	}

	function injectCSSFallback() {
		const waitForHead = () => {
			if (document.head) {
				const style = document.createElement('style')
				style.textContent = DECLUTTER_CSS
				document.head.appendChild(style)
				log('CSS injected via fallback <style> element')
			} else {
				requestAnimationFrame(waitForHead)
			}
		}
		waitForHead()
	}

	injectCSS()

	// ═══════════════════════════════════════════════════════════════════
	//  PLAYER COUNTER IN HEADER
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Reads initial counters from the embedded JSON and places
	 * a compact player count in the top navigation bar.
	 */
	function moveCounterToHeader() {
		const initData = document.getElementById('page-init-data')
		if (!initData) {
			warn('No page-init-data found, skipping counter')
			return
		}

		let counters
		try {
			const parsed = JSON.parse(initData.textContent)
			counters = parsed.data?.counters
		} catch (e) {
			warn('Failed to parse page-init-data:', e)
			return
		}

		if (!counters) return

		const players = counters.members?.toLocaleString() ?? '?'
		const games = counters.rounds?.toLocaleString() ?? '?'

		const el = document.createElement('span')
		el.id = 'declutter-player-count'
		el.textContent = `${players} online \u2022 ${games} games`

		const siteButtons = document.querySelector('.site-buttons')
		if (siteButtons) {
			siteButtons.parentNode.insertBefore(el, siteButtons)
			log(`Counter placed in header: ${players} online, ${games} games`)
		} else {
			warn('Could not find .site-buttons to place counter')
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UPDATE CHECK
	// ═══════════════════════════════════════════════════════════════════

	function checkForUpdate() {
		try {
			GM_xmlhttpRequest({
				method: 'GET',
				url: META_URL + '?_=' + Date.now(),
				onload(resp) {
					if (resp.status !== 200) return
					const match = resp.responseText.match(/@version\s+(\S+)/)
					if (!match) return
					const remote = match[1]
					if (remote !== SCRIPT_VERSION) {
						log(`Update available: v${SCRIPT_VERSION} → v${remote}`)
						showUpdateBanner(remote)
					} else {
						log(`Up to date (v${SCRIPT_VERSION})`)
					}
				},
				onerror() {
					warn('Update check failed (network error)')
				},
			})
		} catch (e) {
			warn('Update check unavailable:', e)
		}
	}

	function showUpdateBanner(remote) {
		const banner = document.createElement('div')
		banner.id = 'declutter-update-banner'
		banner.textContent = `Lichess Declutter v${remote} available (current: v${SCRIPT_VERSION}) — click to update`
		banner.addEventListener('click', () => {
			window.open(DOWNLOAD_URL, '_blank')
		})
		document.body.prepend(banner)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  POOL VISIBILITY CONFIG
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Reads hidden pool IDs from localStorage.
	 * Returns a Set of data-id values (e.g. "1+0", "5+3") to hide.
	 */
	function getHiddenPools() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (!raw) return new Set()
			return new Set(JSON.parse(raw))
		} catch {
			return new Set()
		}
	}

	function saveHiddenPools(hiddenSet) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...hiddenSet]))
	}

	/**
	 * Injects or updates a <style> element that hides pools the user
	 * has toggled off. CSS attribute selectors survive snabbdom patches.
	 */
	function applyPoolStyles(hiddenSet) {
		let styleEl = document.getElementById('declutter-pool-styles')
		if (!styleEl) {
			styleEl = document.createElement('style')
			styleEl.id = 'declutter-pool-styles'
			document.head.appendChild(styleEl)
		}

		const rules = [...hiddenSet]
			.map((id) => `.lpool[data-id="${id}"] { display: none !important; }`)
			.join('\n')
		styleEl.textContent = rules

		log('Pool visibility updated, hidden:', [...hiddenSet])
	}

	/**
	 * Builds the gear button and config dropdown for toggling pool
	 * visibility. Reads available pools directly from the DOM so it
	 * adapts if lichess adds or removes time controls.
	 */
	function setupPoolConfig() {
		const poolContainer = document.querySelector('.lpools')
		const appEl = document.querySelector('.lobby__app')
		if (!poolContainer || !appEl) {
			warn('Pool container not found, skipping config UI')
			return
		}

		const hiddenSet = getHiddenPools()
		applyPoolStyles(hiddenSet)

		// Discover available pools from the DOM
		const poolEls = poolContainer.querySelectorAll('.lpool[data-id]')
		if (poolEls.length === 0) {
			warn('No pool elements found in DOM')
			return
		}

		// Gear button
		const gearBtn = document.createElement('button')
		gearBtn.id = 'declutter-pool-config-btn'
		gearBtn.textContent = '\u2699'
		gearBtn.title = 'Configure visible time controls'
		appEl.appendChild(gearBtn)

		// Config panel (hidden by default)
		const panel = document.createElement('div')
		panel.id = 'declutter-pool-config'
		panel.style.display = 'none'
		appEl.appendChild(panel)

		poolEls.forEach((el) => {
			const poolId = el.getAttribute('data-id')
			const label = document.createElement('label')
			const checkbox = document.createElement('input')
			checkbox.type = 'checkbox'
			checkbox.checked = !hiddenSet.has(poolId)

			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					hiddenSet.delete(poolId)
				} else {
					hiddenSet.add(poolId)
				}
				saveHiddenPools(hiddenSet)
				applyPoolStyles(hiddenSet)
			})

			label.appendChild(checkbox)
			label.appendChild(document.createTextNode(poolId))
			panel.appendChild(label)
		})

		// Toggle panel on gear click
		gearBtn.addEventListener('click', (e) => {
			e.stopPropagation()
			const open = panel.style.display !== 'none'
			panel.style.display = open ? 'none' : 'block'
		})

		// Close panel when clicking outside
		document.addEventListener('click', (e) => {
			if (!panel.contains(e.target) && e.target !== gearBtn) {
				panel.style.display = 'none'
			}
		})

		log(`Pool config ready, ${poolEls.length} pools discovered`)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Waits for Lichess's lobby to be rendered before wiring up the
	 * interactive parts. On Brave/Chromium MV3 the Snabbdom render can
	 * finish well after DOMContentLoaded, so we use MutationObserver.
	 */
	async function init() {
		checkForUpdate()

		try {
			await waitForElement('main.lobby')
			log('Lobby element found, initializing UI')
		} catch {
			warn('Lobby element never appeared — is this the Lichess homepage?')
			return
		}

		moveCounterToHeader()
		setupPoolConfig()
		log('Initialized — configurable pool filtering, layout via grid')
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init)
	} else {
		init()
	}
})()
