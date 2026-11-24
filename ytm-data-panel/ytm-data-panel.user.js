// ==UserScript==
// @name         YTM Data Panel
// @namespace    ytm-data-panel
// @version      1.1.3
// @description  Shows a data-rich floating panel on YouTube Music /watch pages — description, views, publish date, tags, and auto-detected chapters parsed from the YouTube video metadata
// @match        *://music.youtube.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-data-panel/ytm-data-panel.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-data-panel/ytm-data-panel.user.js
// @grant        GM_addStyle
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

	const LOG_PREFIX = '[YTM Data]'
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'
	const PANEL_ID = 'ytmdp-panel'
	const COLLAPSED_KEY = 'ytmdp_collapsed_v1'

	// How many times to retry reading ytInitialPlayerResponse if it's stale
	// relative to the URL's video id (i.e. SPA nav happened but the global
	// hasn't caught up yet). ~1.5s total max wait.
	const STALE_RETRY_LIMIT = 15
	const STALE_RETRY_DELAY_MS = 100

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
	//  Change the template, then run: node tools/sync-blocks.mjs
	// ═══════════════════════════════════════════════════════════════════

	const UPDATE_BANNER_ID = 'ytm-data-panel-update-banner'
	const UPDATE_DISMISS_KEY = 'ytm_data_panel_update_dismissed_v'
	const UPDATE_CHECKED_AT_KEY = 'ytm_data_panel_update_checked_at'
	const UPDATE_REMOTE_VERSION_KEY = 'ytm_data_panel_update_remote_version'
	const UPDATE_COOLDOWN_MS = 6 * 60 * 60 * 1000

	// Tampermonkey exposes the script's own metadata block, so these URLs
	// don't have to be hand-maintained in two places. Greasemonkey 4 does
	// not expose them, hence the literal fallbacks.
	const META_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-data-panel/ytm-data-panel.meta.js'
	const DOWNLOAD_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-data-panel/ytm-data-panel.user.js'

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

	function getCachedUpdateState() {
		try {
			const checkedAt = Number(localStorage.getItem(UPDATE_CHECKED_AT_KEY) || 0)
			const remote = localStorage.getItem(UPDATE_REMOTE_VERSION_KEY) || ''
			return { checkedAt, remote }
		} catch {
			return { checkedAt: 0, remote: '' }
		}
	}

	function setCachedUpdateState(checkedAt, remote) {
		try {
			localStorage.setItem(UPDATE_CHECKED_AT_KEY, String(checkedAt))
			if (remote) localStorage.setItem(UPDATE_REMOTE_VERSION_KEY, String(remote))
			else localStorage.removeItem(UPDATE_REMOTE_VERSION_KEY)
		} catch {
			/* storage unavailable — fall back to uncached checks */
		}
	}

	function checkForUpdate() {
		// A dev install has no GM_info version to compare against, so every
		// remote version would look like an update.
		if (SCRIPT_VERSION === '__DEV__') {
			console.log(`${LOG_PREFIX} Dev build — skipping update check.`)
			return
		}
		const now = Date.now()
		const cached = getCachedUpdateState()
		if (cached.checkedAt > 0 && now - cached.checkedAt < UPDATE_COOLDOWN_MS) {
			if (cached.remote && isNewerVersion(cached.remote, SCRIPT_VERSION)) {
				showUpdateBanner(cached.remote)
			}
			return
		}
		try {
			GM_xmlhttpRequest({
				method: 'GET',
				url: META_URL + '?_=' + now,
				onload(resp) {
					if (resp.status !== 200) return
					const match = resp.responseText.match(/@version\s+(\S+)/)
					if (!match) return
					const remote = match[1]
					setCachedUpdateState(Date.now(), remote)
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
				window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer')
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
	//  TRACK DETECTION
	// ═══════════════════════════════════════════════════════════════════

	/** @returns {string|null} */
	function getVideoIdFromUrl() {
		return new URLSearchParams(window.location.search).get('v')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  DATA EXTRACTION
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Reads the live YTM/YT player response first (which updates across SPA
	 * navigations and queue auto-advance), falling back to the initial page-load
	 * `ytInitialPlayerResponse` blob via `unsafeWindow`.
	 */
	function readPlayerResponse(expectedVideoId) {
		try {
			const pageDoc = unsafeWindow.document || document
			const liveCandidates = [
				pageDoc.getElementById('movie_player')?.getPlayerResponse?.(),
				pageDoc.querySelector('ytmusic-player')?.playerApi?.getPlayerResponse?.(),
			]
			for (const resp of liveCandidates) {
				if (!resp || !resp.videoDetails) continue
				if (!expectedVideoId || resp.videoDetails.videoId === expectedVideoId) {
					return resp
				}
			}
			return unsafeWindow.ytInitialPlayerResponse || null
		} catch (e) {
			warn('Could not access player response:', e)
			return null
		}
	}

	/**
	 * Extracts the bits of metadata we actually render from the player
	 * response blob. Returns `null` if the response is missing the core
	 * videoDetails object, lacks a videoId, or the videoId doesn't match
	 * what's in the URL (SPA nav staleness).
	 *
	 * @returns {object|null}
	 */
	function extractTrackData(response, expectedVideoId) {
		if (!response || !response.videoDetails) return null
		const vd = response.videoDetails
		if (!vd.videoId || (expectedVideoId && vd.videoId !== expectedVideoId)) {
			// Unpopulated shell or global still pointing at the previous track —
			// caller should retry or fall back.
			return null
		}

		const mf = response.microformat && response.microformat.playerMicroformatRenderer
		const description = vd.shortDescription || (mf && mf.description && mf.description.simpleText) || ''

		return {
			videoId: vd.videoId,
			title: vd.title || '',
			author: vd.author || (mf && mf.ownerChannelName) || '',
			lengthSeconds: parseInt(vd.lengthSeconds, 10) || 0,
			viewCount: parseInt(vd.viewCount, 10) || 0,
			keywords: Array.isArray(vd.keywords) ? vd.keywords.slice() : [],
			category: (mf && mf.category) || '',
			publishDate: (mf && mf.publishDate) || '',
			description,
		}
	}

	let cancelActiveFetch = null

	/**
	 * Retry loop that waits for the player response to catch up with
	 * the current URL after SPA navigation. Resolves with the extracted
	 * data or `null` if cancelled or it never synchronizes within the retry budget.
	 *
	 * @param {() => boolean} [isCancelled]
	 * @returns {Promise<object|null>}
	 */
	function fetchTrackDataForCurrentUrl(isCancelled) {
		cancelActiveFetch?.()
		return new Promise((resolve) => {
			const videoId = getVideoIdFromUrl()
			if (!videoId || isCancelled?.()) {
				resolve(null)
				return
			}

			let attempts = 0
			let timerId = null
			let settled = false

			const finish = (result) => {
				if (settled) return
				settled = true
				if (timerId !== null) {
					clearTimeout(timerId)
					timerId = null
				}
				if (cancelActiveFetch === cancel) {
					cancelActiveFetch = null
				}
				resolve(result)
			}

			const cancel = () => finish(null)
			cancelActiveFetch = cancel

			const tick = () => {
				timerId = null
				if (settled || isCancelled?.()) {
					finish(null)
					return
				}
				const response = readPlayerResponse(videoId)
				const data = extractTrackData(response, videoId)
				if (data) {
					finish(data)
					return
				}
				attempts += 1
				if (attempts >= STALE_RETRY_LIMIT) {
					warn(
						`Gave up waiting for ytInitialPlayerResponse to sync with v=${videoId} after ${attempts} tries`
					)
					finish(null)
					return
				}
				timerId = setTimeout(tick, STALE_RETRY_DELAY_MS)
			}
			tick()
		})
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CHAPTER PARSING
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Parses chapter timestamps out of a YouTube description. Accepts lines
	 * that lead with a timestamp in H:MM:SS, M:SS, or MM:SS form and are
	 * followed by at least one non-whitespace character of title.
	 *
	 * Returns chapters sorted by start time. An empty array means "no
	 * chapters detected" — the caller should hide the chapter section.
	 *
	 * @param {string} description
	 * @returns {{ startSeconds: number, timestamp: string, title: string }[]}
	 */
	function parseChapters(description) {
		if (!description || typeof description !== 'string') return []

		const chapters = []
		const lines = description.split(/\r?\n/)
		// Matches `0:00`, `00:00`, `1:23:45`. Allows optional leading
		// punctuation (▪ • -) and a separator (space, dash, dot) before
		// the chapter title.
		const timestampRe =
			/^[\s▪•·\-*]*((?:\d{1,2}:)?\d{1,2}:\d{2})\b[\s\-–—:.|)]*(.*)$/

		for (const line of lines) {
			const m = line.match(timestampRe)
			if (!m) continue
			const timestamp = m[1]
			const title = (m[2] || '').trim()
			if (!title) continue
			const startSeconds = timestampToSeconds(timestamp)
			if (startSeconds == null) continue
			chapters.push({ startSeconds, timestamp, title })
		}

		chapters.sort((a, b) => a.startSeconds - b.startSeconds)

		// YouTube requires the first chapter to start at 0:00 to count the
		// list as a valid chapter index. Mirror that so we don't surface
		// random false positives (song-lyric timestamps, shoutouts, etc.).
		if (chapters.length < 2 || chapters[0].startSeconds !== 0) return []
		return chapters
	}

	/** @returns {number|null} */
	function timestampToSeconds(ts) {
		const parts = ts.split(':').map((p) => parseInt(p, 10))
		if (parts.some(Number.isNaN)) return null
		if (parts.length === 2) return parts[0] * 60 + parts[1]
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
		return null
	}

	// ═══════════════════════════════════════════════════════════════════
	//  FORMATTERS
	// ═══════════════════════════════════════════════════════════════════

	function formatViewCount(n) {
		if (!Number.isFinite(n) || n <= 0) return '—'
		return n.toLocaleString('en-US') + ' views'
	}

	function formatLength(seconds) {
		if (!Number.isFinite(seconds) || seconds <= 0) return '—'
		const h = Math.floor(seconds / 3600)
		const m = Math.floor((seconds % 3600) / 60)
		const s = seconds % 60
		const pad = (n) => String(n).padStart(2, '0')
		return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
	}

	function formatPublishDate(iso) {
		if (!iso) return '—'
		// YT gives us ISO like "2020-05-15" or full RFC3339; take just the
		// date portion and render it human-readable in UTC to avoid off-by-one.
		const datePart = iso.slice(0, 10)
		const d = new Date(datePart)
		if (Number.isNaN(d.getTime())) return iso
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC',
		})
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — STYLES
	// ═══════════════════════════════════════════════════════════════════

	let stylesInjected = false

	function injectStyles() {
		if (stylesInjected) return
		stylesInjected = true

		GM_addStyle(`
			/* ── Floating data panel — anchored top-right below the handoff pill ── */
			#${PANEL_ID} {
				position: fixed;
				top: 128px;
				right: 16px;
				width: 340px;
				max-height: calc(100vh - 160px);
				z-index: 2147483646;
				display: flex;
				flex-direction: column;
				border: 1px solid rgba(255, 255, 255, 0.12);
				background: rgba(15, 15, 15, 0.92);
				backdrop-filter: blur(10px);
				-webkit-backdrop-filter: blur(10px);
				color: #e0e0e0;
				font-family: 'YouTube Sans', 'Roboto', sans-serif;
				font-size: 13px;
				border-radius: 14px;
				box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
				overflow: hidden;
			}
			#${PANEL_ID}.ytmdp-collapsed {
				max-height: none;
			}
			#${PANEL_ID}.ytmdp-collapsed .ytmdp-body {
				display: none;
			}

			/* Header bar */
			#${PANEL_ID} .ytmdp-header {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 10px 14px;
				background: rgba(255, 255, 255, 0.04);
				border-bottom: 1px solid rgba(255, 255, 255, 0.08);
				cursor: pointer;
				user-select: none;
			}
			#${PANEL_ID}.ytmdp-collapsed .ytmdp-header {
				border-bottom: none;
			}
			#${PANEL_ID} .ytmdp-header-icon {
				font-size: 15px;
				line-height: 1;
			}
			#${PANEL_ID} .ytmdp-header-title {
				flex: 1;
				font-size: 13px;
				font-weight: 600;
				color: #fff;
				line-height: 1;
			}
			#${PANEL_ID} .ytmdp-header-chevron {
				font-size: 12px;
				color: #9a9a9a;
				line-height: 1;
				transition: transform 0.15s;
			}
			#${PANEL_ID}.ytmdp-collapsed .ytmdp-header-chevron {
				transform: rotate(-90deg);
			}

			/* Scrollable body */
			#${PANEL_ID} .ytmdp-body {
				flex: 1;
				overflow-y: auto;
				padding: 4px 0 12px;
			}
			#${PANEL_ID} .ytmdp-body::-webkit-scrollbar {
				width: 8px;
			}
			#${PANEL_ID} .ytmdp-body::-webkit-scrollbar-thumb {
				background: rgba(255, 255, 255, 0.12);
				border-radius: 4px;
			}

			/* Sections inside the body */
			#${PANEL_ID} .ytmdp-section {
				padding: 12px 14px 4px;
			}
			#${PANEL_ID} .ytmdp-section + .ytmdp-section {
				border-top: 1px solid rgba(255, 255, 255, 0.06);
				margin-top: 4px;
			}
			#${PANEL_ID} .ytmdp-section-label {
				font-size: 11px;
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.06em;
				color: #9a9a9a;
				margin: 0 0 8px;
			}

			/* Facts grid (views / length / date / category) */
			#${PANEL_ID} .ytmdp-facts {
				display: grid;
				grid-template-columns: auto 1fr;
				row-gap: 6px;
				column-gap: 10px;
				font-size: 13px;
			}
			#${PANEL_ID} .ytmdp-facts dt {
				color: #9a9a9a;
				margin: 0;
			}
			#${PANEL_ID} .ytmdp-facts dd {
				color: #f0f0f0;
				margin: 0;
				word-break: break-word;
			}
			#${PANEL_ID} .ytmdp-track-title {
				font-size: 14px;
				font-weight: 600;
				color: #fff;
				margin: 0 0 4px;
				line-height: 1.3;
			}
			#${PANEL_ID} .ytmdp-track-author {
				font-size: 12px;
				color: #b0b0b0;
				margin: 0;
			}

			/* Chapter list */
			#${PANEL_ID} .ytmdp-chapters {
				list-style: none;
				margin: 0;
				padding: 0;
			}
			#${PANEL_ID} .ytmdp-chapter {
				display: flex;
				gap: 10px;
				padding: 6px 0;
				font-size: 13px;
				border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
			}
			#${PANEL_ID} .ytmdp-chapter:last-child {
				border-bottom: none;
			}
			#${PANEL_ID} .ytmdp-chapter-ts {
				flex: 0 0 auto;
				color: #ff7a9c;
				font-variant-numeric: tabular-nums;
				font-weight: 500;
				min-width: 44px;
			}
			#${PANEL_ID} .ytmdp-chapter-title {
				flex: 1;
				color: #e6e6e6;
			}
			#${PANEL_ID} .ytmdp-chapter.ytmdp-chapter-link {
				cursor: pointer;
				border-radius: 4px;
				padding: 6px 6px;
				margin: 0 -6px;
			}
			#${PANEL_ID} .ytmdp-chapter.ytmdp-chapter-link:hover {
				background: rgba(255, 255, 255, 0.06);
			}

			/* Tag chips */
			#${PANEL_ID} .ytmdp-tags {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}
			#${PANEL_ID} .ytmdp-tag {
				padding: 3px 10px;
				background: rgba(255, 255, 255, 0.06);
				border: 1px solid rgba(255, 255, 255, 0.08);
				border-radius: 999px;
				color: #d0d0d0;
				font-size: 11px;
				line-height: 1.4;
			}

			/* Description */
			#${PANEL_ID} .ytmdp-description {
				margin: 0;
				white-space: pre-wrap;
				word-wrap: break-word;
				font-size: 12px;
				line-height: 1.5;
				color: #c8c8c8;
				max-height: 280px;
				overflow-y: auto;
			}
			#${PANEL_ID} .ytmdp-empty {
				font-size: 12px;
				color: #777;
				font-style: italic;
			}
		`)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI — PANEL RENDER
	// ═══════════════════════════════════════════════════════════════════

	function isCollapsed() {
		try {
			return localStorage.getItem(COLLAPSED_KEY) === '1'
		} catch (e) {
			return false
		}
	}

	function setCollapsed(value) {
		try {
			localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
		} catch (e) {
			/* ignore quota / private mode errors */
		}
	}

	function mountPanel(data) {
		injectStyles()
		removePanel()

		const panel = document.createElement('section')
		panel.id = PANEL_ID
		if (isCollapsed()) panel.classList.add('ytmdp-collapsed')
		panel.setAttribute('aria-label', 'Track data panel')

		// ── Header ────────────────────────────────────────────────────
		const header = document.createElement('header')
		header.className = 'ytmdp-header'

		const headerIcon = document.createElement('span')
		headerIcon.className = 'ytmdp-header-icon'
		headerIcon.textContent = '\u2139' // ℹ

		const headerTitle = document.createElement('span')
		headerTitle.className = 'ytmdp-header-title'
		headerTitle.textContent = 'Track Data'

		const chevron = document.createElement('span')
		chevron.className = 'ytmdp-header-chevron'
		chevron.textContent = '\u25BE' // ▾

		header.appendChild(headerIcon)
		header.appendChild(headerTitle)
		header.appendChild(chevron)
		header.addEventListener('click', () => {
			const willCollapse = !panel.classList.contains('ytmdp-collapsed')
			panel.classList.toggle('ytmdp-collapsed', willCollapse)
			setCollapsed(willCollapse)
		})

		panel.appendChild(header)

		// ── Body ──────────────────────────────────────────────────────
		const body = document.createElement('div')
		body.className = 'ytmdp-body'
		body.appendChild(renderOverviewSection(data))

		const chapters = parseChapters(data.description)
		if (chapters.length > 0) {
			body.appendChild(renderChaptersSection(chapters))
		}

		if (data.keywords.length > 0) {
			body.appendChild(renderTagsSection(data.keywords))
		}

		body.appendChild(renderDescriptionSection(data.description, chapters.length > 0))

		panel.appendChild(body)
		document.body.appendChild(panel)
		log(
			`Panel mounted — ${data.title || '(no title)'} · ${chapters.length} chapters · ${data.keywords.length} tags`
		)
	}

	function renderOverviewSection(data) {
		const section = document.createElement('div')
		section.className = 'ytmdp-section'

		if (data.title) {
			const h = document.createElement('h3')
			h.className = 'ytmdp-track-title'
			h.textContent = data.title
			section.appendChild(h)
		}

		if (data.author) {
			const a = document.createElement('p')
			a.className = 'ytmdp-track-author'
			a.textContent = data.author
			section.appendChild(a)
		}

		const facts = document.createElement('dl')
		facts.className = 'ytmdp-facts'
		facts.style.marginTop = data.title || data.author ? '10px' : '0'

		appendFact(facts, 'Views', formatViewCount(data.viewCount))
		appendFact(facts, 'Length', formatLength(data.lengthSeconds))
		appendFact(facts, 'Published', formatPublishDate(data.publishDate))
		if (data.category) appendFact(facts, 'Category', data.category)

		section.appendChild(facts)
		return section
	}

	function appendFact(dl, label, value) {
		const dt = document.createElement('dt')
		dt.textContent = label
		const dd = document.createElement('dd')
		dd.textContent = value
		dl.appendChild(dt)
		dl.appendChild(dd)
	}

	function renderChaptersSection(chapters) {
		const section = document.createElement('div')
		section.className = 'ytmdp-section'

		const label = document.createElement('p')
		label.className = 'ytmdp-section-label'
		label.textContent = `Chapters (${chapters.length})`
		section.appendChild(label)

		const list = document.createElement('ul')
		list.className = 'ytmdp-chapters'

		for (const chapter of chapters) {
			const li = document.createElement('li')
			li.className = 'ytmdp-chapter ytmdp-chapter-link'
			li.title = `Jump to ${chapter.timestamp}`

			const ts = document.createElement('span')
			ts.className = 'ytmdp-chapter-ts'
			ts.textContent = chapter.timestamp

			const title = document.createElement('span')
			title.className = 'ytmdp-chapter-title'
			title.textContent = chapter.title

			li.appendChild(ts)
			li.appendChild(title)
			li.addEventListener('click', () => seekTo(chapter.startSeconds))

			list.appendChild(li)
		}

		section.appendChild(list)
		return section
	}

	function renderTagsSection(keywords) {
		const section = document.createElement('div')
		section.className = 'ytmdp-section'

		const label = document.createElement('p')
		label.className = 'ytmdp-section-label'
		label.textContent = `Tags (${keywords.length})`
		section.appendChild(label)

		const wrap = document.createElement('div')
		wrap.className = 'ytmdp-tags'
		for (const keyword of keywords) {
			const chip = document.createElement('span')
			chip.className = 'ytmdp-tag'
			chip.textContent = keyword
			wrap.appendChild(chip)
		}
		section.appendChild(wrap)
		return section
	}

	function renderDescriptionSection(description, hasChapters) {
		const section = document.createElement('div')
		section.className = 'ytmdp-section'

		const label = document.createElement('p')
		label.className = 'ytmdp-section-label'
		label.textContent = 'Description'
		section.appendChild(label)

		const trimmed = (description || '').trim()
		if (!trimmed) {
			const empty = document.createElement('p')
			empty.className = 'ytmdp-empty'
			empty.textContent = hasChapters
				? 'No description beyond the chapter list.'
				: 'No description provided.'
			section.appendChild(empty)
			return section
		}

		const p = document.createElement('p')
		p.className = 'ytmdp-description'
		p.textContent = trimmed
		section.appendChild(p)
		return section
	}

	function removePanel() {
		document.getElementById(PANEL_ID)?.remove()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CHAPTER SEEKING
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Jumps the YTM player to the given time. YTM exposes playback via the
	 * same underlying <video> element it uses for the rest of its player
	 * bar, so setting currentTime is enough — the player UI reconciles its
	 * progress indicator automatically.
	 */
	function seekTo(seconds) {
		const video = document.querySelector('video')
		if (!video) {
			warn('Seek failed — no <video> element found')
			return
		}
		try {
			video.currentTime = seconds
			if (video.paused) {
				const p = video.play()
				if (p && typeof p.catch === 'function') {
					p.catch(() => {
						/* autoplay policy may block; ignore */
					})
				}
			}
			log(`Seeked to ${seconds}s`)
		} catch (e) {
			warn('Seek failed:', e)
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  ROUTE HANDLING
	// ═══════════════════════════════════════════════════════════════════

	let lastRenderedData = null
	let routeSeq = 0

	function isSameTrackData(a, b) {
		return (
			Boolean(a && b) &&
			a.videoId === b.videoId &&
			a.title === b.title &&
			a.author === b.author &&
			a.lengthSeconds === b.lengthSeconds &&
			a.viewCount === b.viewCount &&
			a.category === b.category &&
			a.publishDate === b.publishDate &&
			a.description === b.description &&
			a.keywords.length === b.keywords.length &&
			a.keywords.every((k, i) => k === b.keywords[i])
		)
	}

	async function handleRoute() {
		const mySeq = ++routeSeq
		cancelActiveFetch?.()
		if (window.location.pathname !== '/watch' || !getVideoIdFromUrl()) {
			removePanel()
			lastRenderedData = null
			return
		}

		const data = await fetchTrackDataForCurrentUrl(() => mySeq !== routeSeq)
		if (mySeq !== routeSeq) return
		if (!data) {
			warn('No track data available — hiding panel')
			removePanel()
			lastRenderedData = null
			return
		}

		// Avoid re-rendering the same track repeatedly if yt-navigate-finish
		// fires multiple times for one load, unless the panel was detached
		// or metadata filled in since the previous render.
		if (document.getElementById(PANEL_ID) && isSameTrackData(data, lastRenderedData)) return
		lastRenderedData = data
		mountPanel(data)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	handleRoute()

	// YTM is a Polymer/Lit SPA — listen to navigation and within-/watch queue changes.
	document.addEventListener('yt-navigate-finish', handleRoute)
	document.addEventListener('yt-page-data-updated', handleRoute)
	document.addEventListener(
		'loadeddata',
		(e) => {
			if (e.target && e.target.tagName === 'VIDEO') handleRoute()
		},
		true
	)

	log(`Initialized v${SCRIPT_VERSION}`)
})()
