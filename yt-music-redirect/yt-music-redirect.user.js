// ==UserScript==
// @name         YT Music Redirect
// @namespace    yt-music-redirect
// @version      1.4.0
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
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'
	const MUSIC_URL_BASE = 'https://music.youtube.com/watch?v='
	const MAX_POLL_ATTEMPTS = 30
	const POLL_INTERVAL_MS = 200
	const CHANNEL_LIST_KEY = 'yt_music_redirect_channels_v1'
	const CHANNEL_BLOCKLIST_KEY = 'yt_music_redirect_blocklist_v1'

	// ═══════════════════════════════════════════════════════════════════
	//  LOGGING
	// ═══════════════════════════════════════════════════════════════════

	function log(msg, ...args) {
		console.log(`${LOG_PREFIX} ${msg}`, ...args)
	}

	function warn(msg, ...args) {
		console.warn(`${LOG_PREFIX} ${msg}`, ...args)
	}

	// <update-check>
	// ═══════════════════════════════════════════════════════════════════
	//  UPDATE CHECK
	//  Generated from tools/update-check.template.js — do not edit here.
	//  Change the template, then run: node tools/sync-update-check.mjs
	// ═══════════════════════════════════════════════════════════════════

	const UPDATE_BANNER_ID = 'yt-music-redirect-update-banner'
	const UPDATE_DISMISS_KEY = 'yt_music_redirect_update_dismissed_v'

	// Tampermonkey exposes the script's own metadata block, so these URLs
	// don't have to be hand-maintained in two places. Greasemonkey 4 does
	// not expose them, hence the literal fallbacks.
	const META_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.meta.js'
	const DOWNLOAD_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.user.js'

	// Numeric per-segment compare. True only when `remote` is strictly newer,
	// so a local build that's ahead of main never nags. Non-numeric versions
	// (e.g. a tagged pre-release) fall back to plain inequality.
	function isNewerVersion(remote, local) {
		const r = String(remote).split('.').map(Number)
		const l = String(local).split('.').map(Number)
		if (r.some(Number.isNaN) || l.some(Number.isNaN)) return remote !== local
		for (let i = 0; i < Math.max(r.length, l.length); i++) {
			const a = r[i] || 0
			const b = l[i] || 0
			if (a > b) return true
			if (a < b) return false
		}
		return false
	}

	// Dismissal is scoped to the session *and* to the version being offered,
	// so a newer release re-surfaces the banner instead of staying hidden.
	function isUpdateDismissed(remote) {
		try {
			return sessionStorage.getItem(UPDATE_DISMISS_KEY + remote) === '1'
		} catch {
			return false
		}
	}

	function dismissUpdate(remote) {
		try {
			sessionStorage.setItem(UPDATE_DISMISS_KEY + remote, '1')
		} catch {
			/* private mode — the dismissal just won't persist */
		}
	}

	function checkForUpdate() {
		// A dev install has no GM_info version to compare against, so every
		// remote version would look like an update.
		if (SCRIPT_VERSION === '__DEV__') {
			console.log(`${LOG_PREFIX} Dev build — skipping update check.`)
			return
		}
		try {
			GM_xmlhttpRequest({
				method: 'GET',
				url: META_URL + '?_=' + Date.now(),
				onload(resp) {
					if (resp.status !== 200) return
					const match = resp.responseText.match(/@version\s+(\S+)/)
					if (!match) return
					const remote = match[1]
					if (isNewerVersion(remote, SCRIPT_VERSION)) {
						console.log(`${LOG_PREFIX} Update available: v${SCRIPT_VERSION} → v${remote}`)
						showUpdateBanner(remote)
					} else {
						console.log(`${LOG_PREFIX} Up to date (v${SCRIPT_VERSION}).`)
					}
				},
				onerror() {
					console.warn(`${LOG_PREFIX} Update check failed (network error)`)
				},
			})
		} catch (e) {
			console.warn(`${LOG_PREFIX} Update check unavailable:`, e)
		}
	}

	function showUpdateBanner(remote) {
		if (isUpdateDismissed(remote)) return

		function inject() {
			if (document.getElementById(UPDATE_BANNER_ID)) return

			// Styled inline rather than via a stylesheet so the banner works
			// the same in every script, including the ones with no GM_addStyle
			// grant and the ones running at document-start.
			const banner = document.createElement('div')
			banner.id = UPDATE_BANNER_ID
			Object.assign(banner.style, {
				position: 'fixed',
				top: '0',
				left: '0',
				right: '0',
				zIndex: '2147483647',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '12px',
				padding: '8px 16px',
				background: '#3b82f6',
				color: '#fff',
				fontFamily: 'system-ui, sans-serif',
				fontSize: '13px',
				lineHeight: '1.4',
				boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
			})

			const name = LOG_PREFIX.replace(/^\[|\]$/g, '')

			const message = document.createElement('span')
			message.textContent = `⬆ ${name} v${remote} available (you have v${SCRIPT_VERSION}) — click to update`
			Object.assign(message.style, { cursor: 'pointer', textDecoration: 'underline' })
			message.addEventListener('click', () => {
				window.open(DOWNLOAD_URL, '_blank')
			})

			const dismiss = document.createElement('button')
			dismiss.type = 'button'
			dismiss.textContent = '✕ Dismiss'
			Object.assign(dismiss.style, {
				flex: '0 0 auto',
				padding: '2px 10px',
				border: '1px solid rgba(255, 255, 255, 0.6)',
				borderRadius: '4px',
				background: 'transparent',
				color: '#fff',
				font: 'inherit',
				cursor: 'pointer',
			})
			dismiss.addEventListener('click', () => {
				dismissUpdate(remote)
				banner.remove()
				console.log(`${LOG_PREFIX} Update notice dismissed for this session.`)
			})

			banner.append(message, dismiss)
			document.body.prepend(banner)
		}

		// document-start scripts run before <body> exists.
		if (document.body) inject()
		else document.addEventListener('DOMContentLoaded', inject)
	}
	// </update-check>

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
			/* ── Floating icon button (fixed, below masthead) ── */
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
				z-index: 2147483647;
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

	function positionDropdown(btn, dropdown) {
		const rect = btn.getBoundingClientRect()
		const width = dropdown.offsetWidth || 240
		dropdown.style.top = `${rect.bottom + 8}px`
		dropdown.style.left = `${Math.max(8, rect.right - width)}px`
	}

	function getOrCreateMenuBtn() {
		let btn = document.getElementById(MENU_BTN_ID)
		if (btn) return btn

		btn = document.createElement('div')
		btn.id = MENU_BTN_ID
		btn.textContent = '\u266B'
		btn.title = 'YT Music Redirect'
		btn.setAttribute('role', 'button')
		btn.setAttribute('tabindex', '0')
		btn.setAttribute('aria-label', 'YT Music Redirect menu')

		document.body.appendChild(btn)

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
		btn.addEventListener('click', onTrigger, true)
		btn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') onTrigger(e)
		})

		document.addEventListener('keydown', (e) => {
			if (e.key !== 'Escape') return
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown || !dropdown.classList.contains('ytmr-visible')) return
			dropdown.classList.remove('ytmr-visible')
			btn.classList.remove('ytmr-open')
		})

		const onOutside = (e) => {
			const dropdown = document.getElementById(DROPDOWN_ID)
			if (!dropdown) return
			if (e.target === btn || btn.contains(e.target) || dropdown.contains(e.target)) return
			dropdown.classList.remove('ytmr-visible')
			btn.classList.remove('ytmr-open')
		}
		document.addEventListener('pointerdown', onOutside, true)
		document.addEventListener('click', onOutside, true)

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

		const dropdown = document.createElement('div')
		dropdown.id = DROPDOWN_ID

		dropdown.addEventListener('pointerdown', (e) => e.stopPropagation())
		dropdown.addEventListener('click', (e) => e.stopPropagation())

		const bindItem = (el, handler) => {
			const wrapped = (e) => {
				e.preventDefault()
				e.stopPropagation()
				handler()
			}
			el.addEventListener('pointerdown', wrapped)
			el.addEventListener('click', wrapped)
		}

		const redirectItem = document.createElement('button')
		redirectItem.className = 'ytmr-menu-item ytmr-redirect-item'
		redirectItem.innerHTML = '<span class="ytmr-icon">\u266B</span> Open in YT Music'
		bindItem(redirectItem, () => redirectToMusic(videoId))
		dropdown.appendChild(redirectItem)

		if (channelId) {
			dropdown.appendChild(createDivider())

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

		const dismissItem = document.createElement('button')
		dismissItem.className = 'ytmr-menu-item'
		dismissItem.innerHTML = '<span class="ytmr-icon">\u00D7</span> Dismiss'
		bindItem(dismissItem, () => removeRedirectButton())
		dropdown.appendChild(dismissItem)

		menuBtn.appendChild(dropdown)

		log('Redirect menu injected')
	}

	function createDivider() {
		const d = document.createElement('div')
		d.className = 'ytmr-divider'
		return d
	}

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
	//  EVENT LISTENERS
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()

	// Initial page load
	if (window.location.pathname === '/watch') {
		handleWatch()
	}

	// YouTube SPA navigation — fired after client-side route changes
	document.addEventListener('yt-navigate-finish', () => {
		// Clear cache so returning to the same video recreates the dropdown
		checked.clear()
		if (window.location.pathname === '/watch') {
			handleWatch()
		} else {
			removeRedirectButton()
		}
	})

	log('Initialized')
})()
