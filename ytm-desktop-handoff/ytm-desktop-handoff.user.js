// ==UserScript==
// @name         YTM Desktop Handoff
// @namespace    ytm-desktop-handoff
// @version      4.0.1
// @description  Adds a handoff button to YouTube Music /watch pages that sends the current track to the YouTube Music Desktop App via the ytmd:// protocol (pauses this tab so the desktop app plays alone)
// @match        *://music.youtube.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[YTM Handoff]'
	const SCRIPT_VERSION = '4.0.1'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js'

	const UPDATE_BANNER_ID = 'ytmdh-update-banner'
	const PILL_ID = 'ytmdh-pill'

	// YTM Desktop companion API (ytmdesktop/ytmdesktop).
	// Default port is 9863. If you changed it in the app settings, update this.
	const API_PORT = 9863
	const APP_ID = 'ytm-desktop-handoff'
	const APP_NAME = 'YTM Desktop Handoff'

	const AUTH_TOKEN_KEY = 'ytmdh_auth_token_v1'

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

	// ═══════════════════════════════════════════════════════════════════
	//  COMPANION API
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Wraps GM_xmlhttpRequest as a Promise.
	 * Resolves with parsed JSON on 2xx, rejects with { status, body } otherwise.
	 */
	function apiRequest(method, path, body, token) {
		return new Promise((resolve, reject) => {
			const headers = { 'Content-Type': 'application/json' }
			if (token) headers['Authorization'] = token
			GM_xmlhttpRequest({
				method,
				url: `http://localhost:${API_PORT}/api/v1${path}`,
				headers,
				data: body ? JSON.stringify(body) : undefined,
				onload(resp) {
					if (resp.status >= 200 && resp.status < 300) {
						try {
							resolve(JSON.parse(resp.responseText))
						} catch {
							resolve({})
						}
					} else {
						reject({ status: resp.status, body: resp.responseText })
					}
				},
				onerror(err) {
					reject({ status: 0, err })
				},
			})
		})
	}

	function getStoredToken() {
		return localStorage.getItem(AUTH_TOKEN_KEY)
	}

	function storeToken(token) {
		localStorage.setItem(AUTH_TOKEN_KEY, token)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  HANDOFF
	// ═══════════════════════════════════════════════════════════════════

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

	// Code received from /auth/requestcode, waiting for user to approve in YTMD.
	let pendingAuthCode = null

	async function handoff() {
		const videoId = getVideoId()
		if (!videoId) {
			warn('No video ID in URL — nothing to hand off')
			return
		}

		// Phase 2: there's a pending code — user has been asked to approve in YTMD.
		if (pendingAuthCode) {
			try {
				const { token } = await apiRequest('POST', '/auth/request', {
					appId: APP_ID,
					code: pendingAuthCode,
				})
				storeToken(token)
				pendingAuthCode = null
				log('Auth token acquired')
				await sendToDesktop(videoId, getPlaylistId(), token)
			} catch (e) {
				warn(`Auth exchange failed (${e.status}) — did you approve the request in YTMDesktop?`)
				// Keep the pill in 'approve' state so the user can try clicking again.
				setPillState('approve')
			}
			return
		}

		// Phase 1a: try the existing stored token.
		const token = getStoredToken()
		if (token) {
			try {
				await sendToDesktop(videoId, getPlaylistId(), token)
				return
			} catch (e) {
				if (e.status === 401) {
					localStorage.removeItem(AUTH_TOKEN_KEY)
					log('Token expired — re-authenticating')
					// Fall through to request a new code below.
				} else if (e.status === 0) {
					warn('Could not reach YTMDesktop — is it running with companion server enabled?')
					setPillState('error')
					return
				} else {
					warn('Handoff failed:', e.status, e.body)
					setPillState('error')
					return
				}
			}
		}

		// Phase 1b: no valid token — request an auth code from YTMD.
		try {
			const { code } = await apiRequest('POST', '/auth/requestcode', {
				appId: APP_ID,
				appName: APP_NAME,
				appVersion: SCRIPT_VERSION,
			})
			pendingAuthCode = code
			setPillState('approve')
			log('Auth code requested — waiting for approval in YTMDesktop')
		} catch (e) {
			warn(`Could not reach YTMDesktop API (${e.status}) — is the companion server enabled in settings?`)
			setPillState('error')
		}
	}

	async function sendToDesktop(videoId, playlistId, token) {
		await apiRequest(
			'POST',
			'/command',
			{ command: 'changeVideo', data: { videoId, playlistId: playlistId || null } },
			token,
		)
		log(`Sent to YTMDesktop: videoId=${videoId}`)
		setPillState('success')
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

			/* ── Inline pill — sits inside .av-toggle alongside Song/Video ── */
			#${PILL_ID} {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 0 14px;
				height: 32px;
				margin-left: 8px;
				border: 1px solid rgba(255, 255, 255, 0.15);
				background: transparent;
				color: rgba(255, 255, 255, 0.7);
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 13px;
				font-weight: 500;
				line-height: 1;
				cursor: pointer;
				border-radius: 999px;
				user-select: none;
				vertical-align: middle;
				transition: background 0.15s, color 0.15s, border-color 0.15s;
				/* Reset any inherited button styles from YTM */
				outline: none;
				box-shadow: none;
				-webkit-appearance: none;
				appearance: none;
			}
			#${PILL_ID}:hover {
				background: rgba(255, 78, 122, 0.18);
				color: #ff4e7a;
				border-color: rgba(255, 78, 122, 0.5);
			}
			#${PILL_ID}:active {
				transform: scale(0.97);
			}
			#${PILL_ID} .ytmdh-pill-icon {
				font-size: 14px;
				line-height: 1;
			}
			#${PILL_ID} .ytmdh-pill-label {
				line-height: 1;
			}

			/* ── Fixed fallback — used when .av-toggle is not found ── */
			#${PILL_ID}.ytmdh-fixed {
				position: fixed;
				top: 72px;
				right: 16px;
				z-index: 2147483647;
				margin-left: 0;
				padding: 8px 18px;
				height: auto;
				background: rgba(15, 15, 15, 0.88);
				backdrop-filter: blur(8px);
				-webkit-backdrop-filter: blur(8px);
				color: #cfcfcf;
				border-radius: 999px;
				border-color: rgba(255, 255, 255, 0.12);
				box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
				transition: background 0.15s, color 0.15s, transform 0.1s,
					box-shadow 0.15s, border-color 0.15s;
			}
			#${PILL_ID}.ytmdh-fixed:hover {
				background: #ff4e7a;
				color: #fff;
				border-color: rgba(255, 255, 255, 0.24);
				box-shadow: 0 6px 22px rgba(255, 78, 122, 0.45);
			}
			#${PILL_ID}.ytmdh-fixed .ytmdh-pill-icon {
				font-size: 15px;
			}
		`
		document.head.appendChild(style)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — HANDOFF PILL
	// ═══════════════════════════════════════════════════════════════════

	function buildPillButton() {
		const btn = document.createElement('button')
		btn.id = PILL_ID
		btn.type = 'button'
		btn.title = 'Hand off to YT Music Desktop (pauses this tab)'
		btn.setAttribute('aria-label', 'Hand off to YT Music Desktop')

		const iconEl = document.createElement('span')
		iconEl.className = 'ytmdh-pill-icon'
		iconEl.textContent = '\u2197' // ↗

		const labelEl = document.createElement('span')
		labelEl.className = 'ytmdh-pill-label'
		labelEl.textContent = 'YTMDesktop'

		btn.appendChild(iconEl)
		btn.appendChild(labelEl)

		btn.addEventListener('click', (e) => {
			e.preventDefault()
			e.stopPropagation()
			handoff()
		})

		return btn
	}

	function mountPill() {
		injectStyles()
		removePill()

		const btn = buildPillButton()

		// Prefer embedding inline inside the av-toggle group (Song / Video / ↗ YTMDesktop).
		// The av-toggle renders into the regular (light) DOM even under ShadyDOM so a
		// standard querySelector finds it. If Polymer hasn't stamped it yet (race at
		// first load), we fall back to a fixed-position overlay and a MutationObserver
		// will re-try once the element appears.
		const avToggle = document.querySelector('.av-toggle')
		if (avToggle) {
			avToggle.appendChild(btn)
			log('Handoff pill mounted in av-toggle')
		} else {
			btn.classList.add('ytmdh-fixed')
			document.body.appendChild(btn)
			log('Handoff pill mounted (fixed fallback — av-toggle not found)')
		}
	}

	function removePill() {
		document.getElementById(PILL_ID)?.remove()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTE HANDLING
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * The ytmd:// scheme requires a video ID, so the button only makes sense
	 * on /watch routes where the URL exposes `v` (and optionally `list`).
	 * On other YTM routes we remove the button entirely.
	 */
	function handleRoute() {
		if (window.location.pathname === '/watch' && getVideoId()) {
			mountPill()

			// av-toggle is stamped by Polymer after the page shell renders.
			// If mountPill() fell back to fixed, watch for av-toggle to appear
			// and re-mount inline once it does.
			const existing = document.getElementById(PILL_ID)
			if (existing && existing.classList.contains('ytmdh-fixed')) {
				waitForAvToggle()
			}
		} else {
			removePill()
		}
	}

	/**
	 * Observes the DOM for .av-toggle to appear, then re-mounts the pill
	 * inline. Disconnects after the first successful re-mount or after the
	 * user navigates away.
	 */
	function waitForAvToggle() {
		const observer = new MutationObserver(() => {
			const avToggle = document.querySelector('.av-toggle')
			if (!avToggle) return
			observer.disconnect()

			// Only re-mount if the pill is still in fixed-fallback mode.
			const pill = document.getElementById(PILL_ID)
			if (pill && pill.classList.contains('ytmdh-fixed')) {
				log('av-toggle appeared — re-mounting pill inline')
				mountPill()
			}
		})

		observer.observe(document.body, { childList: true, subtree: true })

		// Bail if the user navigates away before av-toggle appears.
		document.addEventListener('yt-navigate-start', () => observer.disconnect(), { once: true })
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
