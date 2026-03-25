// ==UserScript==
// @name         Lichess Declutter
// @namespace    lichess-declutter
// @version      1.0.0
// @description  Strips the lichess homepage down to essentials: one bullet, one blitz, puzzle, and articles
// @match        *://lichess.org/
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.user.js
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Lichess Declutter]'

	// Only these two time controls survive the cull
	const KEEP_POOLS = new Set(['2+1', '3+2'])

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
	//  CSS — HIDE UNWANTED SECTIONS
	// ═══════════════════════════════════════════════════════════════════

	// Injected at document-start so elements never paint
	GM_addStyle(`
		/* Streamers */
		.lobby__streams { display: none !important; }

		/* Tournament spotlights in sidebar */
		.lobby__spotlights { display: none !important; }

		/* "About Lichess" blurb in sidebar */
		.about-side { display: none !important; }

		/* Lobby / Correspondence tabs — keep only Quick pairing visible */
		.lobby__app .tabs-horiz { display: none !important; }

		/* Create lobby game / Challenge a friend / Play against computer */
		.lobby__start { display: none !important; }

		/* Live game preview */
		.lobby__tv { display: none !important; }

		/* Donate + Swag Store */
		.lobby__support { display: none !important; }

		/* Announcement feed */
		.lobby__feed { display: none !important; }

		/* Open tournaments table */
		.lobby__timeline { display: none !important; }

		/* ─── Layout adjustments ─── */

		/* Collapse the now-empty sidebar so content can breathe */
		.lobby__side {
			display: none !important;
		}

		/* Let the main lobby fill width without the sidebar */
		main.lobby {
			display: flex !important;
			flex-direction: column !important;
			align-items: center !important;
			max-width: 900px !important;
			margin: 0 auto !important;
		}

		/* Pool buttons — center them and give them room */
		.lobby__app {
			width: 100% !important;
			max-width: 600px !important;
			order: 1 !important;
		}

		.lpools {
			display: flex !important;
			justify-content: center !important;
			gap: 1em !important;
			flex-wrap: wrap !important;
		}

		/* Puzzle of the day — bring it up right after the pool buttons */
		.lobby__puzzle {
			order: 2 !important;
			width: 100% !important;
			max-width: 600px !important;
			margin-top: 1.5em !important;
		}

		/* Blog / articles — prominent placement below puzzle */
		.lobby__blog {
			order: 3 !important;
			width: 100% !important;
			max-width: 900px !important;
			margin-top: 1.5em !important;
		}

		/* Footer links */
		.lobby__about {
			order: 4 !important;
			width: 100% !important;
		}

		/* Player counter injected into the header */
		#declutter-player-count {
			color: #bababa;
			font-size: 0.85em;
			margin-right: 1em;
			white-space: nowrap;
		}
	`)

	// ═══════════════════════════════════════════════════════════════════
	//  POOL BUTTON FILTER
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Hides pool buttons that aren't in KEEP_POOLS.
	 * Pool buttons are rendered async by the lobby JS module,
	 * so we observe the container and filter when children appear.
	 */
	function filterPools(container) {
		const pools = container.querySelectorAll('[data-id]')
		let kept = 0
		let hidden = 0

		pools.forEach((pool) => {
			const id = pool.getAttribute('data-id')
			if (!KEEP_POOLS.has(id)) {
				pool.style.display = 'none'
				hidden++
			} else {
				kept++
			}
		})

		if (kept > 0 || hidden > 0) {
			log(`Pool filter: kept ${kept}, hidden ${hidden}`)
		}
	}

	function observePools() {
		const container = document.querySelector('.lpools')
		if (!container) {
			// Pools container isn't in the DOM yet — wait for it
			const appObserver = new MutationObserver(() => {
				const el = document.querySelector('.lpools')
				if (el) {
					appObserver.disconnect()
					setupPoolObserver(el)
				}
			})
			appObserver.observe(document.documentElement, {
				childList: true,
				subtree: true,
			})
			return
		}
		setupPoolObserver(container)
	}

	function setupPoolObserver(container) {
		// Filter any already-rendered pools
		filterPools(container)

		// Watch for dynamic re-renders (lichess recreates pool buttons on tab switch)
		const observer = new MutationObserver(() => filterPools(container))
		observer.observe(container, { childList: true, subtree: true })
	}

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

		// Insert before the site-buttons div in the header
		const siteButtons = document.querySelector('.site-buttons')
		if (siteButtons) {
			siteButtons.parentNode.insertBefore(el, siteButtons)
			log(`Counter placed in header: ${players} online, ${games} games`)
		} else {
			warn('Could not find .site-buttons to place counter')
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	// CSS hides are already active from GM_addStyle above.
	// JS work needs the DOM — run at DOMContentLoaded or immediately if ready.
	function init() {
		observePools()
		moveCounterToHeader()
		log('Initialized')
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init)
	} else {
		init()
	}
})()
