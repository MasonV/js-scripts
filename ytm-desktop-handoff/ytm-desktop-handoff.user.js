// ==UserScript==
// @name         YTM Desktop Handoff
// @namespace    ytm-desktop-handoff
// @version      3.0.0
// @description  Adds a pill button to YouTube Music /watch pages that hands off the current track to the YouTube Music Desktop App via the ytmd:// protocol (pauses this tab so the desktop app plays alone)
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
	const SCRIPT_VERSION = '3.0.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js'

	const UPDATE_BANNER_ID = 'ytmdh-update-banner'
	const PILL_ID = 'ytmdh-pill'
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

	function handoff() {
		const uri = buildHandoffUri()
		if (!uri) {
			warn('No track in URL — nothing to hand off')
			return
		}
		log(`Handoff → ${uri}`)
		launchProtocol(uri)
		// Small delay so the protocol handler fires before we pause —
		// avoids any race with YTM's own playback state reconciliation.
		setTimeout(pauseYtmPlayback, 120)
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

			/* ── Single-click handoff pill — anchored in the top-right ── */
			#${PILL_ID} {
				position: fixed;
				top: 72px;
				right: 16px;
				z-index: 2147483647;
				display: inline-flex;
				align-items: center;
				gap: 8px;
				padding: 8px 18px;
				border: 1px solid rgba(255, 255, 255, 0.12);
				background: rgba(15, 15, 15, 0.88);
				backdrop-filter: blur(8px);
				-webkit-backdrop-filter: blur(8px);
				color: #cfcfcf;
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 13px;
				font-weight: 500;
				line-height: 1;
				cursor: pointer;
				border-radius: 999px;
				box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
				user-select: none;
				transition: background 0.15s, color 0.15s, transform 0.1s,
					box-shadow 0.15s, border-color 0.15s;
			}
			#${PILL_ID}:hover {
				background: #ff4e7a;
				color: #fff;
				border-color: rgba(255, 255, 255, 0.24);
				box-shadow: 0 6px 22px rgba(255, 78, 122, 0.45);
			}
			#${PILL_ID}:active {
				transform: scale(0.97);
			}
			#${PILL_ID} .ytmdh-pill-icon {
				font-size: 15px;
				line-height: 1;
			}
			#${PILL_ID} .ytmdh-pill-label {
				line-height: 1;
			}
		`
		document.head.appendChild(style)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — HANDOFF PILL
	// ═══════════════════════════════════════════════════════════════════

	function mountPill() {
		injectStyles()
		removePill()

		const btn = document.createElement('button')
		btn.id = PILL_ID
		btn.type = 'button'
		btn.title = 'Hand off to YT Music Desktop (pauses this tab)'
		btn.setAttribute('aria-label', 'Hand off to YT Music Desktop')

		const iconEl = document.createElement('span')
		iconEl.className = 'ytmdh-pill-icon'
		iconEl.textContent = '\u2197' // ↗ north-east arrow = "open externally"

		const labelEl = document.createElement('span')
		labelEl.className = 'ytmdh-pill-label'
		labelEl.textContent = 'YTMDesktop'

		btn.appendChild(iconEl)
		btn.appendChild(labelEl)

		const onClick = (e) => {
			e.preventDefault()
			e.stopPropagation()
			handoff()
		}
		btn.addEventListener('click', onClick)

		document.body.appendChild(btn)
		log('Handoff pill mounted')
	}

	function removePill() {
		document.getElementById(PILL_ID)?.remove()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTE HANDLING
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * The ytmd:// scheme requires a video ID, so the pill only makes sense
	 * on /watch routes where the URL exposes `v` (and optionally `list`).
	 * On other YTM routes we remove the pill entirely.
	 */
	function handleRoute() {
		if (window.location.pathname === '/watch' && getVideoId()) {
			mountPill()
		} else {
			removePill()
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	handleRoute()

	// YTM is a Polymer/Lit SPA — same navigation event as youtube.com.
	document.addEventListener('yt-navigate-finish', handleRoute)

	log(`Initialized v${SCRIPT_VERSION}`)
})()
