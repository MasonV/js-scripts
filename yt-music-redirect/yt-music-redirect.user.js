// ==UserScript==
// @name         YT Music Redirect
// @namespace    yt-music-redirect
// @version      1.2.0
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
	const SCRIPT_VERSION = '1.2.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.user.js'
	const MUSIC_URL_BASE = 'https://music.youtube.com/watch?v='
	const MAX_POLL_ATTEMPTS = 30
	const POLL_INTERVAL_MS = 200
	const CHANNEL_LIST_KEY = 'yt_music_redirect_channels_v1'
	const CHANNEL_BLOCKLIST_KEY = 'yt_music_redirect_blocklist_v1'
	const CONTAINER_ID = 'ytmr-redirect-bar'
	const UPDATE_BANNER_ID = 'ytmr-update-banner'
	const COLLAPSE_DELAY_MS = 5000

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
			return {
				category: resp.videoDetails.category || null,
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

	let collapseTimer = null

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

			/* ── Expanded bar ── */
			#${CONTAINER_ID} {
				z-index: 9999;
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 6px 12px;
				background: #1a1a2e;
				border: 1px solid #333;
				border-radius: 8px;
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 13px;
				color: #e0e0e0;
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
				transition: opacity 0.2s, transform 0.2s;
				margin-top: 8px;
				margin-bottom: 4px;
			}
			#${CONTAINER_ID}.ytmr-collapsed {
				display: none;
			}
			#${CONTAINER_ID} button {
				border: none;
				border-radius: 6px;
				padding: 6px 12px;
				font-size: 13px;
				cursor: pointer;
				font-family: inherit;
				transition: background 0.15s;
			}
			.ytmr-redirect-btn {
				background: #ff0050;
				color: white;
			}
			.ytmr-redirect-btn:hover {
				background: #e00048;
			}
			.ytmr-channel-btn {
				background: #333;
				color: #e0e0e0;
			}
			.ytmr-channel-btn:hover {
				background: #444;
			}
			.ytmr-channel-btn.ytmr-active {
				background: #2d5a27;
				color: #90ee90;
			}
			.ytmr-channel-btn.ytmr-active:hover {
				background: #3a6a33;
			}
			.ytmr-block-btn {
				background: #555;
				color: #e0e0e0;
			}
			.ytmr-block-btn:hover {
				background: #666;
			}
			.ytmr-close-btn {
				background: transparent;
				color: #888;
				padding: 4px 6px;
				font-size: 16px;
				line-height: 1;
			}
			.ytmr-close-btn:hover {
				color: #fff;
			}

			/* ── Collapsed pill ── */
			#ytmr-pill {
				display: none;
				z-index: 9999;
				padding: 6px 10px;
				background: #1a1a2e;
				border: 1px solid #333;
				border-radius: 8px;
				font-size: 16px;
				cursor: pointer;
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
				transition: background 0.15s;
				margin-top: 8px;
				margin-bottom: 4px;
			}
			#ytmr-pill:hover {
				background: #2a2a4e;
			}
			#ytmr-pill.ytmr-visible {
				display: inline-block;
			}

			/* ── Wrapper anchored below player ── */
			#ytmr-wrapper {
				display: flex;
				align-items: center;
				gap: 8px;
			}
		`
		document.head.appendChild(style)
	}

	/**
	 * Finds a suitable anchor point below the video player and inserts
	 * the wrapper there. Falls back to fixed positioning if the anchor
	 * element isn't found.
	 */
	function getOrCreateWrapper() {
		let wrapper = document.getElementById('ytmr-wrapper')
		if (wrapper) return wrapper

		wrapper = document.createElement('div')
		wrapper.id = 'ytmr-wrapper'

		// Insert above the #below element (info/comments) so it sits
		// between the player and the video metadata
		const below = document.querySelector('#below')
		if (below && below.parentNode) {
			below.parentNode.insertBefore(wrapper, below)
		} else {
			// Fallback: fixed position if page structure isn't as expected
			wrapper.style.cssText = 'position:fixed;top:56px;right:16px;'
			document.body.appendChild(wrapper)
		}

		return wrapper
	}

	function injectRedirectButton(videoId, channelId, channelName) {
		removeRedirectButton()
		injectStyles()

		const wrapper = getOrCreateWrapper()

		// ── Expanded bar ──
		const container = document.createElement('div')
		container.id = CONTAINER_ID

		const redirectBtn = document.createElement('button')
		redirectBtn.className = 'ytmr-redirect-btn'
		redirectBtn.textContent = '\u266B Open in YT Music'
		redirectBtn.addEventListener('click', () => redirectToMusic(videoId))
		container.appendChild(redirectBtn)

		// Channel auto-redirect toggle
		if (channelId) {
			const displayName = channelName || 'this channel'
			const channelBtn = document.createElement('button')
			const inList = isChannelInList(channelId)

			function updateChannelBtn(active) {
				channelBtn.className = `ytmr-channel-btn${active ? ' ytmr-active' : ''}`
				channelBtn.textContent = active
					? `\u2713 Auto-redirecting ${displayName}`
					: `Auto-redirect ${displayName}`
			}

			updateChannelBtn(inList)

			channelBtn.addEventListener('click', () => {
				if (isChannelInList(channelId)) {
					removeChannel(channelId)
					updateChannelBtn(false)
				} else {
					addChannel(channelId, channelName)
					updateChannelBtn(true)
				}
			})

			container.appendChild(channelBtn)
		}

		// "Not music" blocklist button
		if (channelId) {
			const displayName = channelName || 'this channel'
			const blockBtn = document.createElement('button')
			blockBtn.className = 'ytmr-block-btn'
			blockBtn.textContent = `\u2715 Not music`
			blockBtn.title = `Never show redirect for ${displayName}`
			blockBtn.addEventListener('click', () => {
				blockChannel(channelId, channelName)
				removeRedirectButton()
				log(`Blocked "${displayName}" — redirect UI removed`)
			})
			container.appendChild(blockBtn)
		}

		// Close / dismiss button (current video only)
		const closeBtn = document.createElement('button')
		closeBtn.className = 'ytmr-close-btn'
		closeBtn.textContent = '\u00D7'
		closeBtn.title = 'Dismiss for this video'
		closeBtn.addEventListener('click', () => removeRedirectButton())
		container.appendChild(closeBtn)

		wrapper.appendChild(container)

		// ── Collapsed pill ──
		const pill = document.createElement('div')
		pill.id = 'ytmr-pill'
		pill.textContent = '\u266B'
		pill.title = 'YT Music Redirect'
		pill.addEventListener('click', () => {
			container.classList.remove('ytmr-collapsed')
			pill.classList.remove('ytmr-visible')
			resetCollapseTimer(container, pill)
		})
		wrapper.appendChild(pill)

		// Start collapse timer
		resetCollapseTimer(container, pill)

		log('Redirect button injected')
	}

	function resetCollapseTimer(container, pill) {
		if (collapseTimer) clearTimeout(collapseTimer)
		collapseTimer = setTimeout(() => {
			container.classList.add('ytmr-collapsed')
			pill.classList.add('ytmr-visible')
		}, COLLAPSE_DELAY_MS)
	}

	function removeRedirectButton() {
		if (collapseTimer) clearTimeout(collapseTimer)
		collapseTimer = null
		document.getElementById('ytmr-wrapper')?.remove()
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
		if (window.location.pathname === '/watch') {
			handleWatch()
		} else {
			removeRedirectButton()
		}
	})

	log('Initialized')
})()
