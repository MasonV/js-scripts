// ==UserScript==
// @name         YT Music Redirect
// @namespace    yt-music-redirect
// @version      1.3.8
// @description  Automatically redirects YouTube music videos to YouTube Music
// @match        *://www.youtube.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.user.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[YT Music Redirect]'
	const SCRIPT_VERSION = '1.3.8'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.user.js'
	const MUSIC_URL_BASE = 'https://music.youtube.com/watch?v='
	const MAX_POLL_ATTEMPTS = 30
	const POLL_INTERVAL_MS = 200
	const CHANNEL_LIST_KEY = 'yt_music_redirect_channels_v1'
	const CHANNEL_BLOCKLIST_KEY = 'yt_music_redirect_blocklist_v1'
	const UPDATE_BANNER_ID = 'ytmr-update-banner'

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
		banner.id = UPDATE_BANNER_ID
		banner.textContent = `YT Music Redirect v${remote} available (current: v${SCRIPT_VERSION}) — click to update`
		banner.addEventListener('click', () => {
			window.open(DOWNLOAD_URL, '_blank')
		})
		document.body.prepend(banner)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CHANNEL LIST
	// ═══════════════════════════════════════════════════════════════════

	/** @returns {Object<string, {name: string, addedAt: number}>} */
	function getChannelList() {
		try {
			return JSON.parse(localStorage.getItem(CHANNEL_LIST_KEY)) || {}
		} catch {
			return {}
		}
	}

	function saveChannelList(list) {
		localStorage.setItem(CHANNEL_LIST_KEY, JSON.stringify(list))
	}

	function isChannelInList(channelId) {
		return channelId in getChannelList()
	}

	function addChannel(channelId, channelName) {
		const list = getChannelList()
		list[channelId] = { name: channelName, addedAt: Date.now() }
		saveChannelList(list)
		log(`Added channel "${channelName}" (${channelId}) to auto-redirect list`)
	}

	function removeChannel(channelId) {
		const list = getChannelList()
		const name = list[channelId]?.name
		delete list[channelId]
		saveChannelList(list)
		log(`Removed channel "${name}" (${channelId}) from auto-redirect list`)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CHANNEL BLOCKLIST (not-music channels)
	// ═══════════════════════════════════════════════════════════════════

	function getBlocklist() {
		try {
			return JSON.parse(localStorage.getItem(CHANNEL_BLOCKLIST_KEY)) || {}
		} catch {
			return {}
		}
	}

	function saveBlocklist(list) {
		localStorage.setItem(CHANNEL_BLOCKLIST_KEY, JSON.stringify(list))
	}

	function isChannelBlocked(channelId) {
		return channelId in getBlocklist()
	}

	function blockChannel(channelId, channelName) {
		const list = getBlocklist()
		list[channelId] = { name: channelName, addedAt: Date.now() }
		saveBlocklist(list)
		log(`Blocked channel "${channelName}" (${channelId}) — will not show redirect`)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  VIDEO DETECTION
	// ═══════════════════════════════════════════════════════════════════

	/** @returns {string|null} Video ID from the current URL */
	function getVideoId() {
		const params = new URLSearchParams(window.location.search)
		return params.get('v')
	}

	/**
	 * Reads video details from YouTube's embedded player response.
	 * Returns details only when the response matches the requested video ID
	 * (guards against stale data during SPA navigation).
	 */
	function getVideoDetails(videoId) {
		// unsafeWindow needed because GM_xmlhttpRequest grant puts us in sandbox
		const resp = unsafeWindow.ytInitialPlayerResponse
		if (resp?.videoDetails?.videoId === videoId) {
			// YouTube moved category out of videoDetails into microformat at some point;
			// fall back through both locations.
			const category =
				resp.microformat?.playerMicroformatRenderer?.category ||
				resp.videoDetails.category ||
				null
			return {
				category,
				channelId: resp.videoDetails.channelId || null,
				channelName: resp.videoDetails.author || null,
			}
		}
		return null
	}

	/**
	 * Fallback: fetches the watch page HTML and extracts video details.
	 * Used when ytInitialPlayerResponse is stale after SPA navigation.
	 */
	async function fetchVideoDetails(videoId) {
		try {
			const resp = await fetch(`/watch?v=${videoId}`, { credentials: 'omit' })
			const html = await resp.text()
			return {
				category: html.match(/"category":"([^"]+)"/)?.[1] || null,
				channelId: html.match(/"channelId":"([^"]+)"/)?.[1] || null,
				channelName: html.match(/"author":"([^"]+)"/)?.[1] || null,
			}
		} catch (e) {
			warn('Failed to fetch video details:', e)
			return { category: null, channelId: null, channelName: null }
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  REDIRECT LOGIC
	// ═══════════════════════════════════════════════════════════════════

	// Tracks video IDs already evaluated this session to avoid repeat work
	const checked = new Set()

	function redirectToMusic(videoId) {
		log(`Redirecting ${videoId} to YouTube Music`)
		window.location.replace(`${MUSIC_URL_BASE}${videoId}`)
	}

	/**
	 * Decides whether to auto-redirect or show the manual redirect button.
	 * Channel list takes priority, then category check, then manual UI.
	 */
	function processVideoDetails(videoId, { category, channelId, channelName }) {
		if (!category && !channelId) {
			warn(`Could not determine details for ${videoId}`)
			injectRedirectButton(videoId, null, null)
			return
		}

		log(`${videoId} — category: "${category}", channel: "${channelName}"`)

		if (channelId && isChannelBlocked(channelId)) {
			log(`Channel "${channelName}" is blocked — skipping redirect UI`)
			return
		}

		if (channelId && isChannelInList(channelId)) {
			log(`Channel "${channelName}" is in auto-redirect list`)
			redirectToMusic(videoId)
			return
		}

		if (category === 'Music') {
			redirectToMusic(videoId)
			return
		}

		// Not auto-redirecting — show manual button
		injectRedirectButton(videoId, channelId, channelName)
	}

	function handleWatch() {
		const videoId = getVideoId()
		if (!videoId || checked.has(videoId)) return

		log(`Checking details for ${videoId}`)
		pollForDetails(videoId, MAX_POLL_ATTEMPTS)
	}

	/**
	 * Polls ytInitialPlayerResponse until it reflects the current video.
	 * Falls back to a page fetch if polling times out — this covers SPA
	 * navigations where YouTube doesn't update the global.
	 */
	function pollForDetails(videoId, remaining) {
		if (remaining <= 0) {
			log(`Player response stale for ${videoId}, fetching page as fallback`)
			fetchVideoDetails(videoId).then((details) => {
				checked.add(videoId)
				processVideoDetails(videoId, details)
			})
			return
		}

		const details = getVideoDetails(videoId)
		if (details) {
			checked.add(videoId)
			processVideoDetails(videoId, details)
			return
		}

		setTimeout(() => pollForDetails(videoId, remaining - 1), POLL_INTERVAL_MS)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI
	// ═══════════════════════════════════════════════════════════════════

	const MENU_BTN_ID = 'ytmr-menu-btn'
	const DROPDOWN_ID = 'ytmr-dropdown'

	function injectStyles() {
		if (document.getElementById('ytmr-styles')) return

		const style = document.createElement('style')
		style.id = 'ytmr-styles'
		style.textContent = `
			#${UPDATE_BANNER_ID} {
				position: fixed;
				top: 0;
				left: 0;
				right: 0;
				z-index: 10000;
				padding: 8px 16px;
				background: #1565c0;
				color: white;
				text-align: center;
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 13px;
				cursor: pointer;
			}
			#${UPDATE_BANNER_ID}:hover {
				background: #1976d2;
			}

			/* ── Floating icon button (fixed, below masthead) ── */
			#${MENU_BTN_ID} {
				position: fixed;
				top: 72px;
				right: 16px;
				z-index: 2147483000;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 40px;
				height: 40px;
				border: none;
				border-radius: 50%;
				background: rgba(0, 0, 0, 0.55);
				color: #fff;
				font-size: 20px;
				line-height: 1;
				cursor: pointer;
				transition: background 0.15s;
				user-select: none;
			}
			#${MENU_BTN_ID}:hover {
				background: rgba(0, 0, 0, 0.75);
			}
			#${MENU_BTN_ID}.ytmr-open {
				background: rgba(0, 0, 0, 0.85);
			}

			/* ── Dropdown menu (body-level, fixed positioned) ── */
			#${DROPDOWN_ID} {
				display: none;
				position: fixed;
				min-width: 240px;
				background: #282828;
				border: 1px solid #444;
				border-radius: 12px;
				padding: 8px 0;
				box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 14px;
				color: #e0e0e0;
				z-index: 10001;
			}
			#${DROPDOWN_ID}.ytmr-visible {
				display: block;
			}
			#${DROPDOWN_ID} .ytmr-menu-item {
				display: flex;
				align-items: center;
				gap: 12px;
				width: 100%;
				padding: 10px 16px;
				border: none;
				background: transparent;
				color: #e0e0e0;
				font-size: 14px;
				font-family: inherit;
				cursor: pointer;
				text-align: left;
				transition: background 0.1s;
				box-sizing: border-box;
			}
			#${DROPDOWN_ID} .ytmr-menu-item:hover {
				background: rgba(255, 255, 255, 0.1);
			}
			#${DROPDOWN_ID} .ytmr-menu-item .ytmr-icon {
				flex-shrink: 0;
				width: 20px;
				text-align: center;
				font-size: 16px;
			}
			#${DROPDOWN_ID} .ytmr-menu-item.ytmr-redirect-item {
				color: #ff4e7a;
			}
			#${DROPDOWN_ID} .ytmr-menu-item.ytmr-active {
				color: #90ee90;
			}
			#${DROPDOWN_ID} .ytmr-divider {
				height: 1px;
				background: #444;
				margin: 4px 0;
			}
		`
		document.head.appendChild(style)
	}

	/**
	 * Injects the ♫ icon button into the YouTube masthead, right before
	 * the Create button / avatar area.
	 */
	function positionDropdown(btn, dropdown) {
		const rect = btn.getBoundingClientRect()
		const width = dropdown.offsetWidth || 240
		dropdown.style.top = `${rect.bottom + 8}px`
		dropdown.style.left = `${Math.max(8, rect.right - width)}px`
	}

	function getOrCreateMenuBtn() {
		let btn = document.getElementById(MENU_BTN_ID)
		if (btn) return btn

		// Use a <div role=button> rather than <button> so we can safely host
		// (or be adjacent to) other interactive content, and so YouTube's
		// masthead button delegation doesn't interfere with our click handling.
		btn = document.createElement('div')
		btn.id = MENU_BTN_ID
		btn.textContent = '\u266B'
		btn.title = 'YT Music Redirect'
		btn.setAttribute('role', 'button')
		btn.setAttribute('tabindex', '0')
		btn.setAttribute('aria-label', 'YT Music Redirect menu')

		// Append to body — fixed positioning means we don't need to live in
		// YouTube's masthead, which keeps us safe from SPA re-renders.
		document.body.appendChild(btn)

		// Toggle dropdown. Use pointerdown (not click) because YouTube's masthead
		// has delegated handlers that can suppress synthesized click events on
		// elements overlapping its area. pointerdown fires earlier and isn't
		// subject to that suppression. Also use capture phase + preventDefault
		// so nothing upstream can steal the event.
		const onTrigger = (e) => {
			e.preventDefault()
			e.stopPropagation()
			e.stopImmediatePropagation()
			log('Menu button triggered')
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown) {
				warn('Menu clicked but dropdown is missing')
				return
			}
			const willOpen = !dropdown.classList.contains('ytmr-visible')
			dropdown.classList.toggle('ytmr-visible', willOpen)
			btn.classList.toggle('ytmr-open', willOpen)
			if (willOpen) positionDropdown(btn, dropdown)
		}
		btn.addEventListener('pointerdown', onTrigger, true)
		// Fallback for environments where pointerdown isn't available
		btn.addEventListener('click', onTrigger, true)
		btn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') onTrigger(e)
		})

		// Close on Escape when the dropdown is open
		document.addEventListener('keydown', (e) => {
			if (e.key !== 'Escape') return
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown || !dropdown.classList.contains('ytmr-visible')) return
			dropdown.classList.remove('ytmr-visible')
			btn.classList.remove('ytmr-open')
		})

		// Close dropdown when clicking outside
		const onOutside = (e) => {
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown) return
			if (e.target === btn || btn.contains(e.target) || dropdown.contains(e.target)) return
			dropdown.classList.remove('ytmr-visible')
			btn.classList.remove('ytmr-open')
		}
		document.addEventListener('pointerdown', onOutside, true)
		document.addEventListener('click', onOutside, true)

		// Reposition on scroll/resize while open
		const reposition = () => {
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (dropdown && dropdown.classList.contains('ytmr-visible')) {
				positionDropdown(btn, dropdown)
			}
		}
		window.addEventListener('scroll', reposition, true)
		window.addEventListener('resize', reposition)

		return btn
	}

	function injectRedirectButton(videoId, channelId, channelName) {
		removeDropdown()
		injectStyles()

		const menuBtn = getOrCreateMenuBtn()

		// ── Build dropdown ──
		const dropdown = document.createElement('div')
		dropdown.id = DROPDOWN_ID

		// Prevent pointer events inside dropdown from closing it
		dropdown.addEventListener('pointerdown', (e) => e.stopPropagation())
		dropdown.addEventListener('click', (e) => e.stopPropagation())

		// Helper: bind a menu item to a handler using pointerdown (for the
		// same reason we use pointerdown on the trigger) with click fallback.
		const bindItem = (el, handler) => {
			const wrapped = (e) => {
				e.preventDefault()
				e.stopPropagation()
				handler()
			}
			el.addEventListener('pointerdown', wrapped)
			el.addEventListener('click', wrapped)
		}

		// Open in YT Music
		const redirectItem = document.createElement('button')
		redirectItem.className = 'ytmr-menu-item ytmr-redirect-item'
		redirectItem.innerHTML = '<span class="ytmr-icon">\u266B</span> Open in YT Music'
		bindItem(redirectItem, () => redirectToMusic(videoId))
		dropdown.appendChild(redirectItem)

		if (channelId) {
			dropdown.appendChild(createDivider())

			// Auto-redirect toggle
			const displayName = channelName || 'this channel'
			const channelItem = document.createElement('button')
			const inList = isChannelInList(channelId)

			function updateChannelItem(active) {
				channelItem.className = `ytmr-menu-item${active ? ' ytmr-active' : ''}`
				channelItem.innerHTML = active
					? `<span class="ytmr-icon">\u2713</span> Auto-redirecting ${esc(displayName)}`
					: `<span class="ytmr-icon">\u21BB</span> Auto-redirect ${esc(displayName)}`
			}

			updateChannelItem(inList)
			bindItem(channelItem, () => {
				if (isChannelInList(channelId)) {
					removeChannel(channelId)
					updateChannelItem(false)
				} else {
					addChannel(channelId, channelName)
					updateChannelItem(true)
				}
			})
			dropdown.appendChild(channelItem)

			// Not music — blocklist
			const blockItem = document.createElement('button')
			blockItem.className = 'ytmr-menu-item'
			blockItem.innerHTML = `<span class="ytmr-icon">\u2715</span> Not a music channel`
			blockItem.title = `Never show redirect for ${displayName}`
			bindItem(blockItem, () => {
				blockChannel(channelId, channelName)
				removeRedirectButton()
				log(`Blocked "${displayName}" — redirect UI removed`)
			})
			dropdown.appendChild(blockItem)
		}

		dropdown.appendChild(createDivider())

		// Dismiss for this video
		const dismissItem = document.createElement('button')
		dismissItem.className = 'ytmr-menu-item'
		dismissItem.innerHTML = '<span class="ytmr-icon">\u00D7</span> Dismiss'
		bindItem(dismissItem, () => removeRedirectButton())
		dropdown.appendChild(dismissItem)

		// Attach dropdown inside the trigger div. The trigger is a <div> (not a
		// <button>), so nesting interactive controls is fine, and this keeps
		// the dropdown bound to the trigger lifecycle — some YouTube SPA cleanup
		// was removing body-level children, leaving the button orphaned.
		menuBtn.appendChild(dropdown)

		log('Redirect menu injected')
	}

	function createDivider() {
		const d = document.createElement('div')
		d.className = 'ytmr-divider'
		return d
	}

	/** Escapes HTML entities in user-supplied text */
	function esc(str) {
		const el = document.createElement('span')
		el.textContent = str
		return el.innerHTML
	}

	function removeDropdown() {
		document.getElementById(DROPDOWN_ID)?.remove()
	}

	function removeRedirectButton() {
		removeDropdown()
		const btn = document.getElementById(MENU_BTN_ID)
		if (btn) btn.remove()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON CLICKABILITY DIAGNOSTIC (temporary — remove after testing)
	// ═══════════════════════════════════════════════════════════════════

	function injectClickabilityTest() {
		const BASE = `
			position: fixed;
			left: 260px;
			z-index: 2147483647;
			width: 190px;
			padding: 6px 10px;
			border-radius: 6px;
			font: bold 11px monospace;
			text-align: center;
			cursor: pointer;
			box-shadow: 0 2px 8px rgba(0,0,0,0.6);
			pointer-events: all !important;
			border: none;
			color: #fff;
		`
		const COLORS = ['#b71c1c','#e65100','#f57f17','#1b5e20','#0d47a1','#4a148c','#880e4f','#006064','#37474f','#4e342e']

		function topPx(i) { return 72 + i * 58 }

		function markHit(n, method) {
			log(`DIAGNOSTIC btn ${n} fired — ${method}`)
			const s = document.getElementById(`ytbt-s-${n}`)
			if (s) { s.textContent = 'CLICKED!'; s.style.background = '#00c853' }
		}

		function status(n) {
			const s = document.createElement('span')
			s.id = `ytbt-s-${n}`
			s.style.cssText = 'display:block;margin-top:3px;padding:2px 4px;border-radius:3px;font-size:10px;background:rgba(0,0,0,0.4)'
			s.textContent = 'waiting...'
			return s
		}

		// 1. <button> + click, body
		;(function() {
			const n = 1, btn = document.createElement('button')
			btn.style.cssText = BASE + `top:${topPx(0)}px;background:${COLORS[0]}`
			btn.textContent = `${n}. <button> click`
			btn.appendChild(status(n))
			btn.addEventListener('click', () => markHit(n, '<button> click, body'))
			document.body.appendChild(btn)
		})()

		// 2. <button> + pointerdown capture, body
		;(function() {
			const n = 2, btn = document.createElement('button')
			btn.style.cssText = BASE + `top:${topPx(1)}px;background:${COLORS[1]}`
			btn.textContent = `${n}. <button> pointerdown`
			btn.appendChild(status(n))
			btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); markHit(n, '<button> pointerdown capture, body') }, true)
			document.body.appendChild(btn)
		})()

		// 3. <div role=button> + pointerdown capture (mirrors current broken approach)
		;(function() {
			const n = 3, btn = document.createElement('div')
			btn.setAttribute('role', 'button')
			btn.setAttribute('tabindex', '0')
			btn.style.cssText = BASE + `top:${topPx(2)}px;background:${COLORS[2]}`
			btn.textContent = `${n}. <div> pointerdown`
			btn.appendChild(status(n))
			btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); markHit(n, '<div role=button> pointerdown capture') }, true)
			document.body.appendChild(btn)
		})()

		// 4. <button> appended to <html> not <body>
		;(function() {
			const n = 4, btn = document.createElement('button')
			btn.style.cssText = BASE + `top:${topPx(3)}px;background:${COLORS[3]}`
			btn.textContent = `${n}. <button> on <html>`
			btn.appendChild(status(n))
			btn.addEventListener('click', () => markHit(n, '<button> click, documentElement'))
			document.documentElement.appendChild(btn)
		})()

		// 5. Shadow DOM
		;(function() {
			const n = 5
			const host = document.createElement('div')
			host.style.cssText = `position:fixed;top:${topPx(4)}px;left:260px;z-index:2147483647;pointer-events:all !important`
			const shadow = host.attachShadow({ mode: 'open' })
			const styleEl = document.createElement('style')
			styleEl.textContent = `button { ${BASE.replace('position: fixed;','')} background:${COLORS[4]};display:block;width:190px }`
			const btn = document.createElement('button')
			btn.textContent = `${n}. Shadow DOM`
			btn.appendChild(status(n))
			btn.addEventListener('click', () => markHit(n, 'Shadow DOM <button> click'))
			shadow.appendChild(styleEl)
			shadow.appendChild(btn)
			document.body.appendChild(host)
		})()

		// 6. <button> + mousedown capture
		;(function() {
			const n = 6, btn = document.createElement('button')
			btn.style.cssText = BASE + `top:${topPx(5)}px;background:${COLORS[5]}`
			btn.textContent = `${n}. mousedown capture`
			btn.appendChild(status(n))
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); markHit(n, '<button> mousedown capture') }, true)
			document.body.appendChild(btn)
		})()

		// 7. inline .onclick property
		;(function() {
			const n = 7, btn = document.createElement('button')
			btn.style.cssText = BASE + `top:${topPx(6)}px;background:${COLORS[6]}`
			btn.textContent = `${n}. inline onclick`
			btn.appendChild(status(n))
			btn.onclick = (e) => { e.stopPropagation(); markHit(n, 'inline .onclick property') }
			document.body.appendChild(btn)
		})()

		// 8. <a> tag
		;(function() {
			const n = 8, btn = document.createElement('a')
			btn.style.cssText = BASE + `top:${topPx(7)}px;background:${COLORS[7]};text-decoration:none;display:block`
			btn.textContent = `${n}. <a> click`
			btn.href = '#'
			btn.appendChild(status(n))
			btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); markHit(n, '<a href="#"> click') })
			document.body.appendChild(btn)
		})()

		// 9. Listener on window watching for hits on the element
		;(function() {
			const n = 9, btn = document.createElement('button')
			btn.id = 'ytbt-btn-9'
			btn.style.cssText = BASE + `top:${topPx(8)}px;background:${COLORS[8]}`
			btn.textContent = `${n}. window capture`
			btn.appendChild(status(n))
			document.body.appendChild(btn)
			window.addEventListener('pointerdown', (e) => {
				if (e.target === btn || btn.contains(e.target)) {
					e.preventDefault(); e.stopImmediatePropagation()
					markHit(n, 'window pointerdown capture + target check')
				}
			}, true)
		})()

		// 10. <input type=button>
		;(function() {
			const n = 10
			const wrap = document.createElement('div')
			wrap.style.cssText = `position:fixed;top:${topPx(9)}px;left:260px;z-index:2147483647`
			const btn = document.createElement('input')
			btn.type = 'button'
			btn.value = `${n}. <input type=button>`
			btn.style.cssText = BASE.replace('position: fixed;','') + `background:${COLORS[9]};width:190px`
			btn.addEventListener('click', () => markHit(n, '<input type=button> click'))
			wrap.appendChild(btn)
			wrap.appendChild(status(n))
			document.body.appendChild(wrap)
		})()

		log('Diagnostic: 10 test buttons injected (left side)')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  REPLICA VARIANTS (v1.3.7) — isolate which real-button factor is broken
	// ═══════════════════════════════════════════════════════════════════
	//
	//  The original 10 diagnostic buttons all worked (except shadow-DOM), yet
	//  the real menu button — which uses the exact same technique as button #3
	//  — still doesn't click. These variants reproduce the real button's
	//  specific conditions and change ONE variable at a time.
	//
	//  Each variant is a 40x40 rgba circle at right:16px, matching the real
	//  button, so whatever is specific to that *location* is constant across
	//  them. The "baseline" (V11) should fail if the intrinsic conditions at
	//  that spot are the problem.

	function injectReplicaVariants() {
		const REAL_Z = 2147483000
		const MAX_Z = 2147483647

		function markHitV(n, method) {
			log(`REPLICA V${n} fired — ${method}`)
			const el = document.getElementById(`ytmr-v-${n}`)
			if (el) {
				el.style.background = '#00c853'
				el.style.color = '#000'
			}
			const label = document.getElementById(`ytmr-v-${n}-label`)
			if (label) {
				label.textContent = 'CLICKED'
				label.style.background = '#00c853'
				label.style.color = '#000'
			}
		}

		function makeReplica(opts) {
			const el = document.createElement('div')
			el.id = `ytmr-v-${opts.n}`
			el.setAttribute('role', 'button')
			el.setAttribute('tabindex', '0')
			el.textContent = opts.label || `V${opts.n}`
			el.title = opts.desc
			el.style.cssText = `
				position: fixed;
				top: ${opts.top}px;
				right: ${opts.right || 16}px;
				z-index: ${opts.zIndex || REAL_Z};
				width: ${opts.width || 40}px;
				height: ${opts.height || 40}px;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				border: none;
				border-radius: ${opts.borderRadius || '50%'};
				background: ${opts.bg || 'rgba(0, 0, 0, 0.55)'};
				color: #fff;
				font: bold 11px monospace;
				cursor: pointer;
				user-select: none;
				pointer-events: all !important;
			`
			return el
		}

		/** Creates the sidebar label describing each variant */
		function makeLabel(n, top, text) {
			const lbl = document.createElement('div')
			lbl.id = `ytmr-v-${n}-label`
			lbl.textContent = text
			lbl.style.cssText = `
				position: fixed;
				top: ${top + 10}px;
				right: 64px;
				z-index: ${MAX_Z};
				padding: 3px 6px;
				background: rgba(0, 0, 0, 0.75);
				color: #fff;
				font: 10px monospace;
				border-radius: 3px;
				pointer-events: none;
				white-space: nowrap;
			`
			return lbl
		}

		/** Builds and returns a hidden dropdown clone to append as child */
		function makeDropdownChild() {
			const d = document.createElement('div')
			d.style.cssText = `
				display: none;
				position: fixed;
				min-width: 240px;
				background: #282828;
				border: 1px solid #444;
				border-radius: 12px;
				padding: 8px 0;
				box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
				z-index: 10001;
			`
			d.textContent = 'dropdown stub'
			return d
		}

		function attachListener(el, n, method) {
			el.addEventListener('pointerdown', (e) => {
				e.preventDefault()
				e.stopPropagation()
				e.stopImmediatePropagation()
				markHitV(n, method)
			}, true)
		}

		// ── V11: BARE REPLICA at the real button's exact location ──
		//    (40x40 circle, z-idx 2147483000, rgba bg, pointerdown capture)
		//    If this WORKS: the intrinsic replica is fine — something else
		//    (dropdown child / timing / extra listeners) is killing the real one.
		//    If this FAILS: the real button's location/size/z-index combination
		//    is intrinsically broken on YouTube.
		;(function () {
			const n = 11, top = 72
			const btn = makeReplica({ n, top, desc: 'V11 bare replica at real location' })
			attachListener(btn, n, 'bare replica')
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V11 bare replica'))
		})()

		// ── V12: REPLICA + hidden dropdown child ──
		//    Tests whether appending the dropdown as a child breaks clicks.
		;(function () {
			const n = 12, top = 130
			const btn = makeReplica({ n, top, desc: 'V12 + hidden dropdown child' })
			attachListener(btn, n, 'with dropdown child')
			btn.appendChild(makeDropdownChild())
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V12 +dropdown'))
		})()

		// ── V13: REPLICA + delayed injection (setTimeout 2s) ──
		//    Simulates the real button's post-poll/SPA-nav timing. YouTube may
		//    be mounting overlays between document-idle and 2 seconds later.
		setTimeout(() => {
			const n = 13, top = 188
			const btn = makeReplica({ n, top, desc: 'V13 injected after 2s delay' })
			attachListener(btn, n, 'delayed injection')
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V13 setTimeout 2s'))
			log('V13 injected after 2s delay')
		}, 2000)

		// ── V14: REPLICA with max z-index (2147483647) ──
		//    Tests if something is sitting on top at z-index between 2147483000
		//    and 2147483647.
		;(function () {
			const n = 14, top = 246
			const btn = makeReplica({ n, top, desc: 'V14 max z-index', zIndex: MAX_Z })
			attachListener(btn, n, 'max z-index')
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V14 z-idx max'))
		})()

		// ── V15: REPLICA with larger 120x40 hit area ──
		//    Tests if the 40x40 target is too small (e.g., sub-pixel issue).
		;(function () {
			const n = 15, top = 304
			const btn = makeReplica({
				n, top, desc: 'V15 larger 120x40 target',
				width: 120, borderRadius: '20px',
			})
			attachListener(btn, n, 'larger 120x40')
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V15 120x40'))
		})()

		// ── V16: REPLICA with extra event listeners (click + mousedown + keydown) ──
		//    Real button binds all these. Tests if they interfere with pointerdown.
		;(function () {
			const n = 16, top = 362
			const btn = makeReplica({ n, top, desc: 'V16 + click/mousedown/keydown' })
			attachListener(btn, n, 'extra listeners')
			btn.addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				markHitV(n, 'click also fired')
			}, true)
			btn.addEventListener('mousedown', () => log('V16 mousedown also fired'), true)
			btn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') markHitV(n, 'keydown')
			})
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V16 multi-listener'))
		})()

		// ── V17: REPLICA safely below the masthead zone (top: 420) ──
		//    Controls for position. Should WORK regardless — tells us the
		//    element itself is fine and the issue is location-specific.
		;(function () {
			const n = 17, top = 420
			const btn = makeReplica({ n, top, desc: 'V17 below masthead zone' })
			attachListener(btn, n, 'safe position')
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V17 safe pos'))
		})()

		// ── V18: FULL REPRODUCTION of the real broken button ──
		//    Every known condition combined: 40x40 circle, rgba, z-idx 2147483000,
		//    dropdown-child, click+mousedown+keydown listeners, delayed injection.
		//    This SHOULD fail like the real one. If it doesn't, we're missing a
		//    variable the real button has that we haven't replicated.
		setTimeout(() => {
			const n = 18, top = 478
			const btn = makeReplica({ n, top, desc: 'V18 FULL REPRODUCTION — should fail' })
			attachListener(btn, n, 'FULL REPRO pointerdown')
			btn.addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				markHitV(n, 'FULL REPRO click')
			}, true)
			btn.addEventListener('mousedown', () => log('V18 mousedown fired'), true)
			btn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') markHitV(n, 'FULL REPRO keydown')
			})
			btn.appendChild(makeDropdownChild())
			document.body.appendChild(btn)
			document.body.appendChild(makeLabel(n, top, 'V18 FULL REPRO'))
			log('V18 FULL REPRODUCTION injected — this should fail like the real button')
		}, 2000)

		// ═══════════════════════════════════════════════════════════════════
		//  v1.3.8 — V11 is blocked by the real menu button. These prove it.
		// ═══════════════════════════════════════════════════════════════════
		//
		//  v1.3.7 result: V11 is the only failing variant. V18 (full reproduction)
		//  works. The only thing unique to V11 is that it sits at the EXACT same
		//  spot as the real #ytmr-menu-btn (top:72px right:16px) with the same
		//  z-index (2147483000). Since the real button is appended LATER in the
		//  DOM, it wins the stacking fight and swallows all clicks at that spot.

		// ── V19: V11 + MAX z-index — beats the real button at stacking ──
		//    If this works, the problem was just z-order / DOM order.
		;(function () {
			const n = 19, top = 72
			const btn = makeReplica({ n, top, desc: 'V19 same as V11 but MAX z-index', zIndex: MAX_Z })
			attachListener(btn, n, 'max z-index over real button')
			document.body.appendChild(btn)
			// Label shifted down-left so it doesn't overlap with V11's label
			const lbl = makeLabel(n, top - 20, 'V19 max z over real')
			lbl.style.right = '180px'
			document.body.appendChild(lbl)
		})()

		// ── V20: V11 shifted horizontally — same row, different column ──
		//    At right:80 so it clears the real button (which spans right:16-56).
		//    Isolates whether the top:72 row itself has something weird, or
		//    whether the issue is strictly the column the real button occupies.
		;(function () {
			const n = 20, top = 72
			const btn = makeReplica({ n, top, desc: 'V20 same top but right:80', right: 80 })
			attachListener(btn, n, 'offset to right:80')
			document.body.appendChild(btn)
			const lbl = makeLabel(n, top + 20, 'V20 right:80')
			lbl.style.right = '130px'
			document.body.appendChild(lbl)
		})()

		// ── V21: Delete the real menu button, then inject V11 at its spot ──
		//    Waits 3s for handleWatch() to create the real button, nukes it,
		//    then drops V21 in its place. If THIS works, the real button was
		//    the sole blocker.
		setTimeout(() => {
			const realBtn = document.getElementById('ytmr-menu-btn')
			if (realBtn) {
				log(`V21: removing real menu button before injecting (was at ${realBtn.getBoundingClientRect().top}, ${realBtn.getBoundingClientRect().right})`)
				realBtn.remove()
			} else {
				log('V21: real menu button was not present at injection time')
			}
			const n = 21, top = 72
			const btn = makeReplica({ n, top, desc: 'V21 after deleting #ytmr-menu-btn' })
			attachListener(btn, n, 'after removing real button')
			document.body.appendChild(btn)
			const lbl = makeLabel(n, top + 40, 'V21 real btn deleted')
			lbl.style.right = '80px'
			document.body.appendChild(lbl)
		}, 3000)

		// ── V22: Outline the real #ytmr-menu-btn so it's visually obvious ──
		//    Not a clickable variant — just adds a bright red outline + label
		//    to the real button after 3s so you can SEE exactly where it is
		//    relative to V11 and confirm the overlap.
		setTimeout(() => {
			const realBtn = document.getElementById('ytmr-menu-btn')
			if (!realBtn) {
				log('V22 highlight: real menu button is NOT in the DOM — nothing to overlap V11')
				return
			}
			realBtn.style.outline = '3px solid #ff1744'
			realBtn.style.outlineOffset = '2px'
			const rect = realBtn.getBoundingClientRect()
			log(`V22 highlight: real menu button present at top:${rect.top} right:${window.innerWidth - rect.right} (z-index ${getComputedStyle(realBtn).zIndex})`)
			const marker = document.createElement('div')
			marker.textContent = 'REAL BTN ↑'
			marker.style.cssText = `
				position: fixed;
				top: ${rect.bottom + 4}px;
				right: 4px;
				z-index: ${MAX_Z};
				padding: 2px 4px;
				background: #ff1744;
				color: #fff;
				font: bold 9px monospace;
				border-radius: 2px;
				pointer-events: none;
			`
			document.body.appendChild(marker)
		}, 3000)

		log('Replica variants V11–V22 injected. V13/V18/V21/V22 appear after 2–3s.')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  EVENT LISTENERS
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	injectClickabilityTest()
	injectReplicaVariants()

	// Initial page load
	if (window.location.pathname === '/watch') {
		handleWatch()
	}

	// YouTube SPA navigation — fired after client-side route changes
	document.addEventListener('yt-navigate-finish', () => {
		if (window.location.pathname === '/watch') {
			handleWatch()
		} else {
			removeRedirectButton()
		}
	})

	log('Initialized')
})()
