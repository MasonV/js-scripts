// ==UserScript==
// @name         Lichess Declutter
// @namespace    lichess-declutter
// @version      1.1.0
// @description  Strips the lichess homepage down to essentials: quick play, puzzle, and articles in a single screen
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

	// One per speed category — nudges toward longer thinking
	const KEEP_POOLS = new Set(['2+1', '10+0', '30+0'])

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
	//  CSS — HIDE UNWANTED SECTIONS & COMPRESS LAYOUT
	// ═══════════════════════════════════════════════════════════════════

	// Injected at document-start so elements never paint
	GM_addStyle(`
		/* ─── Hidden sections ─── */

		/* Streamers */
		.lobby__streams { display: none !important; }

		/* Tournament spotlights in sidebar */
		.lobby__spotlights { display: none !important; }

		/* "About Lichess" blurb in sidebar */
		.about-side { display: none !important; }

		/* Lobby / Correspondence tabs — Quick pairing is the default */
		.lobby__app .tabs-horiz { display: none !important; }

		/* Create lobby game / Challenge a friend / Play against computer */
		.lobby__start { display: none !important; }

		/* Seekers table (the lobby hook list beneath pools) */
		.lobby__table { display: none !important; }

		/* Live game preview */
		.lobby__tv { display: none !important; }

		/* Donate + Swag Store */
		.lobby__support { display: none !important; }

		/* Announcement feed */
		.lobby__feed { display: none !important; }

		/* Open tournaments + simuls table */
		.lobby__tournaments-simuls { display: none !important; }

		/* Fallback: also catch the individual containers */
		.lobby__tournaments { display: none !important; }
		.lobby__timeline { display: none !important; }

		/* ─── Collapse the now-empty sidebar ─── */
		.lobby__side { display: none !important; }

		/* ─── Single-column compressed layout ─── */

		main.lobby {
			display: flex !important;
			flex-direction: column !important;
			align-items: center !important;
			max-width: 800px !important;
			margin: 0 auto !important;
			padding: 0.5em 1em !important;
			/* Override lichess grid so our flex takes over */
			grid-template-columns: 1fr !important;
		}

		/* Pool buttons — compact row */
		.lobby__app {
			width: 100% !important;
			max-width: 600px !important;
			order: 1 !important;
			margin-bottom: 0 !important;
		}

		.lpools {
			display: flex !important;
			justify-content: center !important;
			gap: 0.75em !important;
			flex-wrap: wrap !important;
			padding: 0.5em 0 !important;
		}

		/* Puzzle of the day — compact, right after pools */
		.lobby__puzzle {
			order: 2 !important;
			width: 100% !important;
			max-width: 600px !important;
			margin: 0.75em 0 !important;
		}

		/* Shrink the puzzle board slightly to save vertical space */
		.lobby__puzzle .mini-board {
			max-height: 200px !important;
		}

		/* Blog / articles — full width below puzzle */
		.lobby__blog {
			order: 3 !important;
			width: 100% !important;
			max-width: 800px !important;
			margin: 0.5em 0 !important;
		}

		/* Compress article card heights */
		.lobby__blog .ublog-post-card__image {
			max-height: 150px !important;
			object-fit: cover !important;
		}

		/* Footer links */
		.lobby__about {
			order: 4 !important;
			width: 100% !important;
			margin-top: 0.5em !important;
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
	 *
	 * Tries two selector strategies:
	 *  1. [data-id] attributes (lichess's pool button format)
	 *  2. Text content matching "X+Y" patterns as fallback
	 */
	function filterPools(container) {
		let pools = container.querySelectorAll('[data-id]')

		if (pools.length > 0) {
			filterByDataId(pools)
			return
		}

		// Fallback: lichess may render pools as divs/buttons without data-id
		filterByTextContent(container)
	}

	function filterByDataId(pools) {
		let kept = 0
		let hidden = 0

		pools.forEach((pool) => {
			const id = pool.getAttribute('data-id')
			if (!KEEP_POOLS.has(id)) {
				pool.style.display = 'none'
				hidden++
			} else {
				pool.style.display = ''
				kept++
			}
		})

		if (kept > 0 || hidden > 0) {
			log(`Pool filter (data-id): kept ${kept}, hidden ${hidden}`)
		}
	}

	function filterByTextContent(container) {
		// Each pool button shows text like "2+1\nBullet" — match the time control part
		const timePattern = /^(\d+\+\d+)$/
		const children = container.children
		let kept = 0
		let hidden = 0

		for (const child of children) {
			const text = child.textContent.trim()
			const lines = text.split('\n').map((l) => l.trim())
			const timeControl = lines.find((l) => timePattern.test(l))

			if (timeControl) {
				if (!KEEP_POOLS.has(timeControl)) {
					child.style.display = 'none'
					hidden++
				} else {
					child.style.display = ''
					kept++
				}
			}
		}

		if (kept > 0 || hidden > 0) {
			log(`Pool filter (text): kept ${kept}, hidden ${hidden}`)
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
