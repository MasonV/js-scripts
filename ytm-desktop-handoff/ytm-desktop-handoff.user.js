// ==UserScript==
// @name         YTM Desktop Handoff
// @namespace    ytm-desktop-handoff
// @version      1.0.0
// @description  Adds a button on YouTube Music to open the current track/playlist in YouTube Music Desktop App via the ytmd:// protocol
// @match        *://music.youtube.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[YTM Handoff]'
	const SCRIPT_VERSION = '1.0.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js'

	const UPDATE_BANNER_ID = 'ytmdh-update-banner'
	const MENU_BTN_ID = 'ytmdh-menu-btn'
	const DROPDOWN_ID = 'ytmdh-dropdown'
	const LAUNCHER_IFRAME_ID = 'ytmdh-launcher-frame'

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
		banner.textContent = `YTM Desktop Handoff v${remote} available (current: v${SCRIPT_VERSION}) — click to update`
		banner.addEventListener('click', () => {
			window.open(DOWNLOAD_URL, '_blank')
		})
		document.body.prepend(banner)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TRACK DETECTION
	// ═══════════════════════════════════════════════════════════════════

	/** @returns {string|null} */
	function getVideoId() {
		return new URLSearchParams(window.location.search).get('v')
	}

	/** @returns {string|null} */
	function getPlaylistId() {
		return new URLSearchParams(window.location.search).get('list')
	}

	/**
	 * Builds the ytmd:// URI for the currently-watched track.
	 * Format per YTMDesktop wiki: ytmd://play/<VideoId>[/<PlaylistId>]
	 */
	function buildHandoffUri() {
		const videoId = getVideoId()
		if (!videoId) return null
		const playlistId = getPlaylistId()
		return playlistId ? `ytmd://play/${videoId}/${playlistId}` : `ytmd://play/${videoId}`
	}

	// ═══════════════════════════════════════════════════════════════════
	//  HANDOFF
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Launches a custom protocol URI without navigating the current tab.
	 * A hidden iframe is the most reliable cross-browser way to trigger a
	 * protocol handler — window.location.href risks replacing the tab in
	 * some browser/protocol combinations.
	 */
	function launchProtocol(uri) {
		let iframe = document.getElementById(LAUNCHER_IFRAME_ID)
		if (!iframe) {
			iframe = document.createElement('iframe')
			iframe.id = LAUNCHER_IFRAME_ID
			iframe.style.display = 'none'
			document.body.appendChild(iframe)
		}
		iframe.src = uri
	}

	/**
	 * Pauses the YT Music browser player. Pausing the underlying <video>
	 * element is sufficient — YTM's player bar listens to the element's
	 * events and updates its own UI state automatically.
	 */
	function pauseYtmPlayback() {
		const video = document.querySelector('video')
		if (video && !video.paused) {
			video.pause()
			log('Paused YT Music browser playback')
		}
	}

	function handoff({ pauseHere }) {
		const uri = buildHandoffUri()
		if (!uri) {
			warn('No track in URL — nothing to hand off')
			return
		}
		log(`Handoff → ${uri} (pauseHere=${pauseHere})`)
		launchProtocol(uri)
		if (pauseHere) {
			// Small delay so the protocol handler fires before we pause —
			// avoids any race with YTM's own playback state reconciliation.
			setTimeout(pauseYtmPlayback, 120)
		}
		closeDropdown()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — STYLES
	// ═══════════════════════════════════════════════════════════════════

	function injectStyles() {
		if (document.getElementById('ytmdh-styles')) return

		const style = document.createElement('style')
		style.id = 'ytmdh-styles'
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

			/* ── Floating icon button (fixed, top-right) ── */
			#${MENU_BTN_ID} {
				position: fixed;
				top: 72px;
				right: 16px;
				z-index: 2147483647;
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
				background: rgba(0, 0, 0, 0.85);
			}
			#${MENU_BTN_ID}.ytmdh-open {
				background: rgba(0, 0, 0, 0.9);
			}

			/* ── Dropdown menu ── */
			#${DROPDOWN_ID} {
				display: none;
				position: fixed;
				min-width: 280px;
				background: #282828;
				border: 1px solid #444;
				border-radius: 12px;
				padding: 8px 0;
				box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 14px;
				color: #e0e0e0;
				z-index: 2147483647;
			}
			#${DROPDOWN_ID}.ytmdh-visible {
				display: block;
			}
			#${DROPDOWN_ID} .ytmdh-menu-item {
				display: flex;
				align-items: flex-start;
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
			#${DROPDOWN_ID} .ytmdh-menu-item:hover {
				background: rgba(255, 255, 255, 0.1);
			}
			#${DROPDOWN_ID} .ytmdh-menu-item .ytmdh-icon {
				flex-shrink: 0;
				width: 20px;
				text-align: center;
				font-size: 16px;
				margin-top: 1px;
			}
			#${DROPDOWN_ID} .ytmdh-menu-item.ytmdh-primary .ytmdh-label {
				color: #ff4e7a;
			}
			#${DROPDOWN_ID} .ytmdh-col {
				display: flex;
				flex-direction: column;
				flex: 1;
			}
			#${DROPDOWN_ID} .ytmdh-label {
				font-weight: 500;
			}
			#${DROPDOWN_ID} .ytmdh-sub {
				display: block;
				font-size: 11px;
				color: #999;
				margin-top: 2px;
			}
			#${DROPDOWN_ID} .ytmdh-divider {
				height: 1px;
				background: #444;
				margin: 4px 0;
			}
		`
		document.head.appendChild(style)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — BUTTON & DROPDOWN
	// ═══════════════════════════════════════════════════════════════════

	function positionDropdown(btn, dropdown) {
		const rect = btn.getBoundingClientRect()
		const width = dropdown.offsetWidth || 280
		dropdown.style.top = `${rect.bottom + 8}px`
		dropdown.style.left = `${Math.max(8, rect.right - width)}px`
	}

	function closeDropdown() {
		document.getElementById(DROPDOWN_ID)?.classList.remove('ytmdh-visible')
		document.getElementById(MENU_BTN_ID)?.classList.remove('ytmdh-open')
	}

	function getOrCreateMenuBtn() {
		let btn = document.getElementById(MENU_BTN_ID)
		if (btn) return btn

		btn = document.createElement('div')
		btn.id = MENU_BTN_ID
		btn.textContent = '\u2197' // ↗ north-east arrow = "open externally"
		btn.title = 'Open in YT Music Desktop'
		btn.setAttribute('role', 'button')
		btn.setAttribute('tabindex', '0')
		btn.setAttribute('aria-label', 'Open in YT Music Desktop')

		document.body.appendChild(btn)

		const onTrigger = (e) => {
			e.preventDefault()
			e.stopPropagation()
			e.stopImmediatePropagation()
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown) {
				warn('Menu clicked but dropdown is missing')
				return
			}
			const willOpen = !dropdown.classList.contains('ytmdh-visible')
			dropdown.classList.toggle('ytmdh-visible', willOpen)
			btn.classList.toggle('ytmdh-open', willOpen)
			if (willOpen) positionDropdown(btn, dropdown)
		}
		btn.addEventListener('pointerdown', onTrigger, true)
		btn.addEventListener('click', onTrigger, true)
		btn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') onTrigger(e)
		})

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') closeDropdown()
		})

		const onOutside = (e) => {
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown) return
			if (e.target === btn || btn.contains(e.target) || dropdown.contains(e.target)) return
			closeDropdown()
		}
		document.addEventListener('pointerdown', onOutside, true)
		document.addEventListener('click', onOutside, true)

		const reposition = () => {
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (dropdown?.classList.contains('ytmdh-visible')) {
				positionDropdown(btn, dropdown)
			}
		}
		window.addEventListener('scroll', reposition, true)
		window.addEventListener('resize', reposition)

		return btn
	}

	function buildMenuItem({ icon, label, sub, primary, onClick }) {
		const item = document.createElement('button')
		item.className = 'ytmdh-menu-item' + (primary ? ' ytmdh-primary' : '')

		const iconEl = document.createElement('span')
		iconEl.className = 'ytmdh-icon'
		iconEl.textContent = icon

		const col = document.createElement('span')
		col.className = 'ytmdh-col'

		const labelEl = document.createElement('span')
		labelEl.className = 'ytmdh-label'
		labelEl.textContent = label
		col.appendChild(labelEl)

		if (sub) {
			const subEl = document.createElement('span')
			subEl.className = 'ytmdh-sub'
			subEl.textContent = sub
			col.appendChild(subEl)
		}

		item.appendChild(iconEl)
		item.appendChild(col)

		const wrapped = (e) => {
			e.preventDefault()
			e.stopPropagation()
			onClick()
		}
		item.addEventListener('pointerdown', wrapped)
		item.addEventListener('click', wrapped)

		return item
	}

	function createDivider() {
		const d = document.createElement('div')
		d.className = 'ytmdh-divider'
		return d
	}

	function mountButton() {
		injectStyles()
		removeDropdown()

		const menuBtn = getOrCreateMenuBtn()

		const dropdown = document.createElement('div')
		dropdown.id = DROPDOWN_ID
		dropdown.addEventListener('pointerdown', (e) => e.stopPropagation())
		dropdown.addEventListener('click', (e) => e.stopPropagation())

		// Primary: full handoff — opens in desktop AND pauses the browser.
		// One click moves playback entirely to YTMDesktop.
		dropdown.appendChild(
			buildMenuItem({
				icon: '\u2197', // ↗
				label: 'Hand off to YTMDesktop',
				sub: 'Pauses this tab — plays in desktop only',
				primary: true,
				onClick: () => handoff({ pauseHere: true }),
			}),
		)

		// Secondary: open in desktop but leave the browser alone. Useful
		// when the user wants to keep listening here and just mirror the
		// track in the desktop app (e.g. to queue into a desktop playlist).
		dropdown.appendChild(
			buildMenuItem({
				icon: '\u29C9', // ⧉ two overlapping squares
				label: 'Open in YTMDesktop',
				sub: 'Keeps this tab playing — desktop opens alongside',
				onClick: () => handoff({ pauseHere: false }),
			}),
		)

		dropdown.appendChild(createDivider())

		dropdown.appendChild(
			buildMenuItem({
				icon: '\u00D7', // ×
				label: 'Dismiss',
				onClick: removeButton,
			}),
		)

		menuBtn.appendChild(dropdown)
		log('Handoff menu mounted')
	}

	function removeDropdown() {
		document.getElementById(DROPDOWN_ID)?.remove()
	}

	function removeButton() {
		removeDropdown()
		document.getElementById(MENU_BTN_ID)?.remove()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTE HANDLING
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * The ytmd:// scheme requires a video ID, so the button only makes
	 * sense on /watch routes where the URL exposes `v` (and optionally
	 * `list`). On other YTM routes we remove the button entirely.
	 */
	function handleRoute() {
		if (window.location.pathname === '/watch' && getVideoId()) {
			mountButton()
		} else {
			removeButton()
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	handleRoute()

	// YTM is a Polymer/Lit SPA — same navigation event as youtube.com.
	document.addEventListener('yt-navigate-finish', handleRoute)

	log('Initialized')
})()
