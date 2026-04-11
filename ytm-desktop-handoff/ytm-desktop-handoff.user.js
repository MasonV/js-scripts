// ==UserScript==
// @name         YTM Desktop Handoff
// @namespace    ytm-desktop-handoff
// @version      2.0.0
// @description  Top-of-page destination toggle on YouTube Music — switch playback between Song (here), Video (YouTube), or YTDesktop (the desktop app via ytmd://)
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
	const SCRIPT_VERSION = '2.0.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js'

	const UPDATE_BANNER_ID = 'ytmdh-update-banner'
	const TOGGLE_ID = 'ytmdh-toggle'
	const LAUNCHER_IFRAME_ID = 'ytmdh-launcher-frame'

	// Playback destinations for the three-way toggle. The user picks where
	// they want this track to play and the UI highlights that choice.
	const DEST_SONG = 'song' // Listen here in YT Music (this tab)
	const DEST_VIDEO = 'video' // Watch the YouTube video version (navigates away)
	const DEST_YTDESKTOP = 'ytdesktop' // Hand off to the YTMDesktop app (pauses this tab)

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

	/**
	 * Builds the equivalent youtube.com/watch URL for the current track —
	 * used when the user picks the "Video" destination and wants to watch
	 * the music video version instead of listening in YTM.
	 */
	function buildYouTubeVideoUrl() {
		const videoId = getVideoId()
		if (!videoId) return null
		const playlistId = getPlaylistId()
		const base = `https://www.youtube.com/watch?v=${videoId}`
		return playlistId ? `${base}&list=${playlistId}` : base
	}

	// ═══════════════════════════════════════════════════════════════════
	//  PLAYBACK CONTROL
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

	/**
	 * Resumes the YT Music browser player. Used when the user clicks back
	 * to the "Song" destination after a handoff — pulls playback back
	 * into this tab.
	 */
	function resumeYtmPlayback() {
		const video = document.querySelector('video')
		if (video && video.paused) {
			const p = video.play()
			if (p && typeof p.catch === 'function') {
				p.catch((e) => warn('Resume failed (likely autoplay policy):', e))
			}
			log('Resumed YT Music browser playback')
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  DESTINATION ACTIONS
	//  One function per segment on the toggle. Each does its side-effect
	//  (resume / navigate / protocol launch) and updates the active state.
	// ═══════════════════════════════════════════════════════════════════

	function goSong() {
		resumeYtmPlayback()
		setActive(DEST_SONG)
	}

	function goVideo() {
		const url = buildYouTubeVideoUrl()
		if (!url) {
			warn('No track in URL — nothing to open on YouTube')
			return
		}
		log(`Video → ${url}`)
		// Pause first so audio doesn't double-up during the brief moment
		// before YouTube takes over the tab.
		pauseYtmPlayback()
		setActive(DEST_VIDEO)
		window.location.href = url
	}

	function goYtdesktop() {
		const uri = buildHandoffUri()
		if (!uri) {
			warn('No track in URL — nothing to hand off')
			return
		}
		log(`YTDesktop → ${uri}`)
		launchProtocol(uri)
		// Small delay so the protocol handler fires before we pause —
		// avoids any race with YTM's own playback state reconciliation.
		setTimeout(pauseYtmPlayback, 120)
		setActive(DEST_YTDESKTOP)
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

			/* ── Segmented destination toggle — anchored at the top, centered ── */
			#${TOGGLE_ID} {
				position: fixed;
				top: 72px;
				left: 50%;
				transform: translateX(-50%);
				z-index: 2147483647;
				display: inline-flex;
				padding: 4px;
				background: rgba(15, 15, 15, 0.88);
				backdrop-filter: blur(8px);
				-webkit-backdrop-filter: blur(8px);
				border: 1px solid rgba(255, 255, 255, 0.12);
				border-radius: 999px;
				box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				user-select: none;
			}
			#${TOGGLE_ID} .ytmdh-segment {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				padding: 8px 18px;
				border: none;
				background: transparent;
				color: #cfcfcf;
				font-family: inherit;
				font-size: 13px;
				font-weight: 500;
				cursor: pointer;
				border-radius: 999px;
				transition: background 0.15s, color 0.15s, transform 0.1s;
			}
			#${TOGGLE_ID} .ytmdh-segment:hover {
				background: rgba(255, 255, 255, 0.08);
				color: #fff;
			}
			#${TOGGLE_ID} .ytmdh-segment:active {
				transform: scale(0.97);
			}
			#${TOGGLE_ID} .ytmdh-segment.ytmdh-active {
				background: #ff4e7a;
				color: #fff;
				box-shadow: 0 2px 10px rgba(255, 78, 122, 0.45);
			}
			#${TOGGLE_ID} .ytmdh-seg-icon {
				font-size: 15px;
				line-height: 1;
			}
			#${TOGGLE_ID} .ytmdh-seg-label {
				line-height: 1;
			}
		`
		document.head.appendChild(style)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — DESTINATION TOGGLE
	// ═══════════════════════════════════════════════════════════════════

	function buildSegment({ dest, icon, label, title, onClick }) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'ytmdh-segment'
		btn.dataset.dest = dest
		btn.title = title
		btn.setAttribute('aria-label', title)

		const iconEl = document.createElement('span')
		iconEl.className = 'ytmdh-seg-icon'
		iconEl.textContent = icon

		const labelEl = document.createElement('span')
		labelEl.className = 'ytmdh-seg-label'
		labelEl.textContent = label

		btn.appendChild(iconEl)
		btn.appendChild(labelEl)

		const wrapped = (e) => {
			e.preventDefault()
			e.stopPropagation()
			onClick()
		}
		btn.addEventListener('click', wrapped)

		return btn
	}

	function setActive(dest) {
		const toggle = document.getElementById(TOGGLE_ID)
		if (!toggle) return
		toggle.querySelectorAll('.ytmdh-segment').forEach((btn) => {
			btn.classList.toggle('ytmdh-active', btn.dataset.dest === dest)
		})
	}

	function mountToggle() {
		injectStyles()
		removeToggle()

		const toggle = document.createElement('div')
		toggle.id = TOGGLE_ID
		toggle.setAttribute('role', 'group')
		toggle.setAttribute('aria-label', 'Playback destination')

		toggle.appendChild(
			buildSegment({
				dest: DEST_SONG,
				icon: '\u266A', // ♪
				label: 'Song',
				title: 'Listen here in YT Music',
				onClick: goSong,
			}),
		)

		toggle.appendChild(
			buildSegment({
				dest: DEST_VIDEO,
				icon: '\u25B6', // ▶
				label: 'Video',
				title: 'Watch the video version on YouTube',
				onClick: goVideo,
			}),
		)

		toggle.appendChild(
			buildSegment({
				dest: DEST_YTDESKTOP,
				icon: '\u2197', // ↗
				label: 'YTDesktop',
				title: 'Hand off to YT Music Desktop (pauses this tab)',
				onClick: goYtdesktop,
			}),
		)

		document.body.appendChild(toggle)

		// Default: Song is active on mount — we're already in YT Music.
		setActive(DEST_SONG)

		log('Destination toggle mounted')
	}

	function removeToggle() {
		document.getElementById(TOGGLE_ID)?.remove()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTE HANDLING
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * The toggle only makes sense on /watch routes where the URL exposes
	 * `v` (and optionally `list`). On other YTM routes we remove it entirely.
	 */
	function handleRoute() {
		if (window.location.pathname === '/watch' && getVideoId()) {
			mountToggle()
		} else {
			removeToggle()
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
