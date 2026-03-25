// ==UserScript==
// @name         Lichess Declutter
// @namespace    lichess-declutter
// @version      1.2.0
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
	const SCRIPT_VERSION = '1.2.0'
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
	//  CSS — HIDE, FILTER, AND RELAYOUT
	// ═══════════════════════════════════════════════════════════════════

	// All hiding and layout done via CSS so it survives lichess's
	// virtual DOM redraws (snabbdom patches wipe inline styles).
	GM_addStyle(`
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
		/* Lichess renders pools as div.lpool[data-id="X+Y"] via snabbdom.
		   CSS attribute selectors survive virtual DOM patches; JS won't. */

		/* Hide every pool by default, then whitelist the keepers */
		.lpool { display: none !important; }
		.lpool[data-id="2+1"]  { display: flex !important; }
		.lpool[data-id="10+0"] { display: flex !important; }
		.lpool[data-id="30+0"] { display: flex !important; }

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

		/* Make the 3 kept pool buttons larger and more prominent */
		.lpool[data-id="2+1"],
		.lpool[data-id="10+0"],
		.lpool[data-id="30+0"] {
			font-size: 1.3em !important;
			padding: 0.75em 1em !important;
			justify-content: center !important;
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
	`)

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
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	function init() {
		moveCounterToHeader()
		checkForUpdate()
		log('Initialized — pool filtering via CSS, layout via grid')
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init)
	} else {
		init()
	}
})()
