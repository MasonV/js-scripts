// ==UserScript==
// @name         YT Music Redirect
// @namespace    yt-music-redirect
// @version      1.0.0
// @description  Automatically redirects YouTube music videos to YouTube Music
// @match        *://www.youtube.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[YT Music Redirect]'
	const MUSIC_URL_BASE = 'https://music.youtube.com/watch?v='
	const MAX_POLL_ATTEMPTS = 30
	const POLL_INTERVAL_MS = 200

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
	//  VIDEO DETECTION
	// ═══════════════════════════════════════════════════════════════════

	/** @returns {string|null} Video ID from the current URL */
	function getVideoId() {
		const params = new URLSearchParams(window.location.search)
		return params.get('v')
	}

	/**
	 * Reads category from YouTube's embedded player response.
	 * Returns the category string only when the response matches the
	 * requested video ID (guards against stale data during SPA nav).
	 */
	function getCategoryFromPlayerResponse(videoId) {
		const resp = window.ytInitialPlayerResponse
		if (resp?.videoDetails?.videoId === videoId) {
			return resp.videoDetails.category || null
		}
		return null
	}

	/**
	 * Fallback: fetches the watch page HTML and extracts the category.
	 * Used when ytInitialPlayerResponse is stale after SPA navigation.
	 */
	async function fetchCategory(videoId) {
		try {
			const resp = await fetch(`/watch?v=${videoId}`, { credentials: 'omit' })
			const html = await resp.text()
			const match = html.match(/"category":"([^"]+)"/)
			if (match) {
				return match[1]
			}
		} catch (e) {
			warn('Failed to fetch category:', e)
		}
		return null
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

	function handleWatch() {
		const videoId = getVideoId()
		if (!videoId || checked.has(videoId)) return

		log(`Checking category for ${videoId}`)
		pollForCategory(videoId, MAX_POLL_ATTEMPTS)
	}

	/**
	 * Polls ytInitialPlayerResponse until it reflects the current video.
	 * Falls back to a page fetch if polling times out — this covers SPA
	 * navigations where YouTube doesn't update the global.
	 */
	function pollForCategory(videoId, remaining) {
		if (remaining <= 0) {
			log(`Player response stale for ${videoId}, fetching page as fallback`)
			fetchCategory(videoId).then((category) => {
				checked.add(videoId)
				if (!category) {
					warn(`Could not determine category for ${videoId}`)
					return
				}
				log(`${videoId} category: "${category}" (via fetch)`)
				if (category === 'Music') {
					redirectToMusic(videoId)
				}
			})
			return
		}

		const category = getCategoryFromPlayerResponse(videoId)
		if (category !== null) {
			checked.add(videoId)
			log(`${videoId} category: "${category}"`)
			if (category === 'Music') {
				redirectToMusic(videoId)
			}
			return
		}

		setTimeout(() => pollForCategory(videoId, remaining - 1), POLL_INTERVAL_MS)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  EVENT LISTENERS
	// ═══════════════════════════════════════════════════════════════════

	// Initial page load
	if (window.location.pathname === '/watch') {
		handleWatch()
	}

	// YouTube SPA navigation — fired after client-side route changes
	document.addEventListener('yt-navigate-finish', () => {
		if (window.location.pathname === '/watch') {
			handleWatch()
		}
	})

	log('Initialized')
})()
