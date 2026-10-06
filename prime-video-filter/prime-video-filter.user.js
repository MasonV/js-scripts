// ==UserScript==
// @name         Prime Video Filter
// @namespace    prime-video-filter
// @version      0.2.1
// @description  Hide Prime Video titles you can't watch with Prime, titles you've already watched, and titles below an IMDb rating you choose
// @match        https://www.primevideo.com/*
// @match        https://www.amazon.com/gp/video/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/prime-video-filter/prime-video-filter.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/prime-video-filter/prime-video-filter.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Prime Video Filter]'
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'

	const STORAGE_KEY = 'prime_video_filter_settings_v1'
	const RATING_CACHE_KEY = 'prime_video_filter_ratings_v1'
	const LAUNCHER_ID = 'pvf-launcher'
	const PANEL_ID = 'pvf-panel'

	// Set on the element that gets collapsed (the card's <li>, or its row).
	// The value is the reason, which makes a hidden card easy to explain
	// from DevTools.
	const HIDDEN_ATTR = 'data-pvf-hidden'
	const ROW_HIDDEN_ATTR = 'data-pvf-row-hidden'

	// On <html> while "not included" is on: lets a CSS rule hide paid cards
	// the instant Prime Video renders them, before any script runs.
	const HIDE_PAID_CLASS = 'pvf-hide-paid'
	const INTRO_KEY = 'prime_video_filter_intro_seen_v1'

	// A pass slower than this gets logged, so a slow page can be diagnosed.
	const SLOW_PASS_MS = 50

	// A title card. Prime Video tags its cards with a test id; the
	// data-card-title fallback covers layouts that drop it.
	const CARD_SELECTOR =
		'article[data-testid="card"], article[data-card-title], article[data-card-entitlement], ' +
		'[data-testid="card"][data-card-title], [data-testid="card"][data-card-entitlement]'

	const DEFAULTS = {
		enabled: true,
		hideNotIncluded: false,
		hideWatched: false,
		watchedPct: 90,
		hideLowRated: false,
		minRating: 7,
		hideUnrated: false,
		hideEmptyRows: true,
	}

	const WATCHED_MIN_PCT = 50
	const WATCHED_MAX_PCT = 100
	const RATING_MIN = 1
	const RATING_MAX = 9.5

	// Detail-page lookups for IMDb ratings: few at a time, spaced out, and
	// remembered, so browsing a storefront doesn't hammer Amazon.
	const RATING_FETCH_CONCURRENCY = 4
	const RATING_FETCH_GAP_MS = 100
	const RATING_TTL_MS = 14 * 24 * 60 * 60 * 1000
	const NO_RATING_TTL_MS = 2 * 24 * 60 * 60 * 1000
	const RATING_CACHE_MAX = 3000

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
	//  PURE LOGIC
	// ═══════════════════════════════════════════════════════════════════

	// Everything in this section is free of DOM and storage access.
	// prime-video-filter/logic.test.js evaluates this section's source text
	// directly, so keep it self-contained.

	function clampNumber(value, min, max, fallback) {
		const n = Number(value)
		if (!Number.isFinite(n)) return fallback
		return Math.min(max, Math.max(min, n))
	}

	// toFixed trims float noise, so a 6.9 threshold is exactly 6.9 and a
	// title rated 6.9 isn't hidden by 6.9000000000000004.
	function roundTo(value, step) {
		return Number((Math.round(value / step) * step).toFixed(10))
	}

	// Reads an IMDb score out of either a text snippet ("IMDb 7.4",
	// "IMDb rating 7.4") or a page's HTML (a JSON "imdbRating" field, or a
	// badge whose number sits in its own tag). Returns null when there is
	// nothing that looks like a 1–10 score.
	function extractImdbRating(source) {
		if (!source) return null
		const text = String(source)

		const json = text.match(/"imdbRating"\s*:\s*"?(\d{1,2}(?:\.\d)?)/i)
		if (json) return validRating(json[1])

		const flat = text
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;|&#160;/gi, ' ')
			.replace(/\s+/g, ' ')
		const badge = flat.match(/\bIMDb(?:\s+rating)?\s*:?\s*(\d{1,2}(?:\.\d)?)(?!\d)/i)
		if (badge) return validRating(badge[1])

		return null
	}

	// Detail pages are large; flattening the whole thing to text is slow.
	// Look at a short window after each "IMDb" mention instead.
	function findImdbRatingInHtml(html) {
		const text = String(html || '')
		const json = text.match(/"imdbRating"\s*:\s*"?(\d{1,2}(?:\.\d)?)/i)
		if (json) return validRating(json[1])
		const mention = /imdb/gi
		let m
		let tries = 0
		while ((m = mention.exec(text)) && tries++ < 50) {
			const rating = extractImdbRating(text.slice(m.index, m.index + 400))
			if (rating != null) return rating
		}
		return null
	}

	function validRating(raw) {
		const n = Number(raw)
		return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null
	}

	// Maps the labels Prime Video puts on a card to whether it plays with
	// Prime. "Included with Prime" wins over anything else on the card, so
	// a title that is both included and buyable in 4K stays visible.
	// Returns 'included', 'paid', or null when the labels say neither.
	function classifyEntitlement(labels) {
		const text = String(labels || '').replace(/\s+/g, ' ')
		if (!text.trim()) return null
		if (/(?<!\bnot )\bincluded with (?:your )?(?:amazon )?prime\b/i.test(text)) return 'included'
		if (/\bwatch (?:now )?with prime\b/i.test(text)) return 'included'
		if (
			/\b(?:rent or buy|buy or rent|available to (?:rent|buy)|rent\b.{0,12}\$|buy\b.{0,12}\$)/i.test(
				text
			) ||
			/\b(?:free trial|start your (?:free )?trial|subscribe(?: now)?|add .{1,40} to (?:your )?prime|requires? (?:a )?subscription|channel subscription)\b/i.test(
				text
			) ||
			/\bnot included (?:with|in) (?:your )?(?:prime|plan)\b/i.test(text)
		) {
			return 'paid'
		}
		return null
	}

	// Card entitlement attribute: "Entitled" means you can play it with what
	// you already pay for; anything else ("Unentitled", "…Channel") doesn't.
	function entitlementFromAttr(value) {
		if (value == null || value === '') return null
		return /^entitled$/i.test(String(value).trim()) ? 'included' : 'paid'
	}

	// Watch progress from a progressbar's aria values. Prime Video reports
	// either 0–100 or 0–1 depending on the component; aria-valuemax settles it.
	function progressFromAria(now, max) {
		const value = Number(now)
		if (now == null || now === '' || !Number.isFinite(value)) return null
		const top = max == null || max === '' ? 100 : Number(max)
		if (!Number.isFinite(top) || top <= 0) return null
		return clampNumber((value / top) * 100, 0, 100, null)
	}

	// Watch progress from a filled bar's inline width ("73%", "73.5%").
	function progressFromWidth(width) {
		const m = String(width || '').match(/^\s*(\d+(?:\.\d+)?)%\s*$/)
		return m ? clampNumber(Number(m[1]), 0, 100, null) : null
	}

	// The one decision the whole script exists for. `facts` is what we could
	// read off a card; any fact we couldn't read is null, and an unknown
	// fact never hides a card — except the one filter that is explicitly
	// about unknowns (hideUnrated), and only once the lookup has finished.
	// Returns the reason the card is hidden, or null to keep it.
	function hideReason(facts, settings) {
		if (!settings.enabled) return null

		if (settings.hideNotIncluded && facts.entitlement === 'paid') return 'not-included'

		if (
			settings.hideWatched &&
			facts.progress != null &&
			facts.progress >= settings.watchedPct
		) {
			return 'watched'
		}

		if (settings.hideLowRated) {
			if (facts.rating != null) {
				if (facts.rating < settings.minRating) return 'low-rated'
			} else if (settings.hideUnrated && facts.ratingSettled) {
				return 'unrated'
			}
		}

		return null
	}

	// Rating cache entries are { r: number|null, t: savedAt }. A miss is
	// retried sooner than a hit, since "no rating yet" is often temporary.
	function isRatingFresh(entry, now) {
		if (!entry || typeof entry.t !== 'number') return false
		const ttl = entry.r == null ? NO_RATING_TTL_MS : RATING_TTL_MS
		return now - entry.t < ttl
	}

	// "/detail/0ABC123/ref=…" → "0ABC123". Same title, same key, whichever
	// row or storefront the card came from.
	function detailKey(href) {
		const m = String(href || '').match(/\/detail\/([A-Za-z0-9._-]+)/)
		return m ? m[1] : null
	}

	function formatRating(n) {
		return Number(n).toFixed(1)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  SETTINGS
	// ═══════════════════════════════════════════════════════════════════

	let settings = { ...DEFAULTS }

	function normalizeSettings(stored) {
		const s = stored && typeof stored === 'object' ? stored : {}
		const bool = (key) => (typeof s[key] === 'boolean' ? s[key] : DEFAULTS[key])
		return {
			enabled: bool('enabled'),
			hideNotIncluded: bool('hideNotIncluded'),
			hideWatched: bool('hideWatched'),
			watchedPct: Math.round(
				clampNumber(s.watchedPct, WATCHED_MIN_PCT, WATCHED_MAX_PCT, DEFAULTS.watchedPct)
			),
			hideLowRated: bool('hideLowRated'),
			minRating: roundTo(clampNumber(s.minRating, RATING_MIN, RATING_MAX, DEFAULTS.minRating), 0.1),
			hideUnrated: bool('hideUnrated'),
			hideEmptyRows: bool('hideEmptyRows'),
		}
	}

	function readSettings() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			return normalizeSettings(raw ? JSON.parse(raw) : null)
		} catch (e) {
			warn('Could not read saved settings:', e)
			return { ...DEFAULTS }
		}
	}

	function writeSettings() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
		} catch (e) {
			warn('Could not save settings (they apply for this tab only):', e)
		}
	}

	function anyFilterOn() {
		return settings.hideNotIncluded || settings.hideWatched || settings.hideLowRated
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CARD READING
	// ═══════════════════════════════════════════════════════════════════

	// Everything below reads Prime Video's markup, which Amazon changes
	// without notice. Each reader tries the structured signal first and
	// falls back to labels, and returns null rather than guess.

	function cardHost(card) {
		return card.closest('li') || card
	}

	// Only labels and badges — never the card's full text, where a film
	// called "Rent" would read as a price tag.
	function cardLabels(card) {
		const parts = []
		const push = (v) => {
			if (v) parts.push(v)
		}
		push(card.getAttribute('aria-label'))
		for (const el of card.querySelectorAll('[aria-label], [title], svg title')) {
			push(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent)
		}
		for (const el of card.querySelectorAll(
			'[data-testid*="entitlement" i], [data-testid*="badge" i], [class*="entitlement" i]'
		)) {
			push(el.textContent)
		}
		return parts.join(' | ')
	}

	// Reading labels walks the whole card, so remember what a card said.
	// The attribute is cheap and can change, so it is always re-read.
	const labelEntitlement = new WeakMap()

	function readEntitlement(card) {
		const attrHolder = card.hasAttribute('data-card-entitlement')
			? card
			: card.querySelector('[data-card-entitlement]')
		const fromAttr = entitlementFromAttr(attrHolder?.getAttribute('data-card-entitlement'))
		if (fromAttr) return fromAttr
		if (labelEntitlement.has(card)) return labelEntitlement.get(card)
		const fromLabels = classifyEntitlement(cardLabels(card))
		if (fromLabels) labelEntitlement.set(card, fromLabels)
		return fromLabels
	}

	function readProgress(card) {
		const bar = card.querySelector('[role="progressbar"]')
		if (bar) {
			const p = progressFromAria(bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'))
			if (p != null) return p
		}
		const fill = card.querySelector(
			'[data-testid*="progress" i][style*="width"], [data-testid*="progress" i] [style*="width"], [class*="progress" i] [style*="width"]'
		)
		return fill ? progressFromWidth(fill.style.width) : null
	}

	function readCardHref(card) {
		const link = card.querySelector('a[href*="/detail/"]') || card.closest('a[href*="/detail/"]')
		return link ? link.href : null
	}

	// ═══════════════════════════════════════════════════════════════════
	//  IMDB RATINGS
	// ═══════════════════════════════════════════════════════════════════

	// Storefront cards rarely carry the rating; the title's detail page
	// does. Look there only for cards near the screen, one title once.

	let ratingCache = null
	const ratingQueue = []
	const ratingInFlight = new Set()
	let ratingActive = 0
	let ratingCacheDirty = false

	function loadRatingCache() {
		if (ratingCache) return ratingCache
		try {
			const raw = localStorage.getItem(RATING_CACHE_KEY)
			const parsed = raw ? JSON.parse(raw) : null
			ratingCache = parsed && typeof parsed === 'object' ? parsed : {}
		} catch (e) {
			warn('Could not read the IMDb rating cache; starting fresh:', e)
			ratingCache = {}
		}
		return ratingCache
	}

	function saveRatingCacheSoon() {
		if (ratingCacheDirty) return
		ratingCacheDirty = true
		setTimeout(() => {
			ratingCacheDirty = false
			try {
				const entries = Object.entries(ratingCache)
				if (entries.length > RATING_CACHE_MAX) {
					entries.sort((a, b) => b[1].t - a[1].t)
					ratingCache = Object.fromEntries(entries.slice(0, RATING_CACHE_MAX))
				}
				localStorage.setItem(RATING_CACHE_KEY, JSON.stringify(ratingCache))
			} catch (e) {
				warn('Could not save the IMDb rating cache:', e)
			}
		}, 1000)
	}

	// { rating, settled } — settled means we looked and there's nothing
	// more to learn this session.
	function readRating(card) {
		const onCard = extractImdbRating(cardLabels(card)) ?? extractImdbRating(card.textContent)
		if (onCard != null) return { rating: onCard, settled: true }

		const href = readCardHref(card)
		const key = detailKey(href)
		if (!key) return { rating: null, settled: true }

		const entry = loadRatingCache()[key]
		if (isRatingFresh(entry, Date.now())) return { rating: entry.r, settled: true }
		return { rating: null, settled: false, key, href }
	}

	function queueRatingLookup(key, href) {
		if (ratingInFlight.has(key) || ratingQueue.some((job) => job.key === key)) return
		ratingQueue.push({ key, href })
		pumpRatingQueue()
	}

	function pumpRatingQueue() {
		while (ratingActive < RATING_FETCH_CONCURRENCY && ratingQueue.length) {
			// Newest first: the cards you just scrolled to matter more than
			// the ones you scrolled past.
			const job = ratingQueue.pop()
			ratingActive++
			ratingInFlight.add(job.key)
			lookupRating(job)
				.catch((e) => warn(`Rating lookup failed for ${job.key}:`, e))
				.finally(() => {
					ratingInFlight.delete(job.key)
					setTimeout(() => {
						ratingActive--
						pumpRatingQueue()
					}, RATING_FETCH_GAP_MS)
				})
		}
	}

	async function lookupRating({ key, href }) {
		const res = await fetch(href, { credentials: 'include' })
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		// Searched as text, not parsed: building a DOM for a whole detail page
		// blocked the main thread for every title looked up.
		const rating = findImdbRatingInHtml(await res.text())

		loadRatingCache()[key] = { r: rating, t: Date.now() }
		saveRatingCacheSoon()
		console.log(`[PVF] ${key}: IMDb ${rating == null ? 'none' : formatRating(rating)}`)
		scheduleApply()
	}

	// Cards near the viewport get their rating looked up; the rest wait
	// until they scroll into view.
	const nearScreen = new WeakSet()
	let ratingObserver = null

	function watchForRating(card) {
		if (!ratingObserver) {
			ratingObserver = new IntersectionObserver(
				(entries) => {
					let changed = false
					for (const entry of entries) {
						if (!entry.isIntersecting) continue
						nearScreen.add(entry.target)
						ratingObserver.unobserve(entry.target)
						changed = true
					}
					if (changed) scheduleApply()
				},
				// Wide sideways margin: rows scroll horizontally, so the next
				// few cards along are looked up before you reach them.
				{ rootMargin: '800px 2000px' }
			)
		}
		ratingObserver.observe(card)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  FILTERING
	// ═══════════════════════════════════════════════════════════════════

	let lastCounts = null
	let everSawCards = false
	let everReadEntitlement = false

	function setHidden(el, attr, reason) {
		if (reason) {
			if (el.getAttribute(attr) !== reason) el.setAttribute(attr, reason)
		} else if (el.hasAttribute(attr)) {
			el.removeAttribute(attr)
		}
	}

	function apply() {
		const started = performance.now()
		document.documentElement.classList.toggle(
			HIDE_PAID_CLASS,
			settings.enabled && settings.hideNotIncluded
		)
		const cards = document.querySelectorAll(CARD_SELECTOR)
		const rows = new Map()
		const counts = {
			total: 0,
			hidden: 0,
			'not-included': 0,
			watched: 0,
			'low-rated': 0,
			unrated: 0,
			ratingPending: 0,
			entitlementUnknown: 0,
		}
		const needRatings = settings.enabled && settings.hideLowRated
		const seenHosts = new Set()

		for (const card of cards) {
			const host = cardHost(card)
			// Nested matches (a hover card inside a card) count once.
			if (seenHosts.has(host)) continue
			seenHosts.add(host)
			counts.total++

			const list = host.parentElement
			const row = list && (list.closest('section') || list.parentElement)
			if (row) {
				if (!rows.has(row)) rows.set(row, [])
				rows.get(row).push(host)
			}

			const facts = { entitlement: null, progress: null, rating: null, ratingSettled: false }

			if (settings.hideNotIncluded) {
				facts.entitlement = readEntitlement(card)
				if (facts.entitlement) everReadEntitlement = true
				else counts.entitlementUnknown++
			}
			if (settings.hideWatched) facts.progress = readProgress(card)

			// A card already on its way out for another reason doesn't need a
			// detail-page fetch to confirm it.
			let reason = hideReason(facts, { ...settings, hideLowRated: false })
			if (!reason && needRatings) {
				const r = readRating(card)
				facts.rating = r.rating
				facts.ratingSettled = r.settled
				if (!r.settled) {
					counts.ratingPending++
					if (nearScreen.has(card)) queueRatingLookup(r.key, r.href)
					else watchForRating(card)
				}
				reason = hideReason(facts, settings)
			}

			setHidden(host, HIDDEN_ATTR, reason)
			if (reason) {
				counts.hidden++
				counts[reason]++
			}
		}

		if (counts.total) everSawCards = true
		applyRows(rows)
		lastCounts = counts
		renderPanelState()

		const ms = performance.now() - started
		if (ms > SLOW_PASS_MS) console.log(`[PVF] Slow pass: ${counts.total} cards in ${Math.round(ms)} ms.`)
	}

	// A row whose every title is filtered out leaves a bare heading behind.
	// Collapse it too — but only a row we can see all the cards of.
	function applyRows(rows) {
		const active = settings.enabled && settings.hideEmptyRows && anyFilterOn()
		for (const [row, hosts] of rows) {
			const hide = active && hosts.every((h) => h.hasAttribute(HIDDEN_ATTR))
			setHidden(row, ROW_HIDDEN_ATTR, hide ? 'empty' : null)
		}
		// A row that has since lost all its cards gets its heading back.
		for (const row of document.querySelectorAll(`[${ROW_HIDDEN_ATTR}]`)) {
			if (!rows.has(row)) setHidden(row, ROW_HIDDEN_ATTR, null)
		}
	}

	let applyTimer = null

	function scheduleApply() {
		if (applyTimer) return
		applyTimer = setTimeout(() => {
			applyTimer = null
			apply()
		}, 150)
	}

	function saveAndApply() {
		writeSettings()
		apply()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  PAGE WATCHING
	// ═══════════════════════════════════════════════════════════════════

	// Prime Video is a single-page app that streams rows in as you scroll,
	// so re-run when cards arrive. Only childList, and never for our own
	// panel: v0.1.0 re-ran on its own counter updates, which kept the
	// script filtering the whole page several times a second.
	function isOwnUi(node) {
		const el = node.nodeType === 1 ? node : node.parentElement
		return !!el?.closest(`#${LAUNCHER_ID}, #${PANEL_ID}, #${UPDATE_BANNER_ID}`)
	}

	function mayAffectCards(node) {
		if (node.nodeType !== 1) return false
		if (node.matches(CARD_SELECTOR) || node.closest(CARD_SELECTOR)) return true
		return !!node.querySelector(CARD_SELECTOR)
	}

	function startWatching() {
		new MutationObserver((mutations) => {
			for (const m of mutations) {
				if (isOwnUi(m.target)) continue
				for (const node of m.addedNodes) {
					if (mayAffectCards(node)) {
						scheduleApply()
						return
					}
				}
			}
		}).observe(document.body, { childList: true, subtree: true })
	}

	function setupKeyboardShortcut() {
		document.addEventListener('keydown', (e) => {
			if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return
			if (e.code !== 'KeyF') return
			e.preventDefault()
			settings.enabled = !settings.enabled
			log(`Filtering ${settings.enabled ? 'on' : 'paused'} (Alt+Shift+F).`)
			saveAndApply()
		})
	}

	// If the card markup ever changes, the failure is silent — nothing gets
	// hidden. Say so once, where whoever has to fix it will look.
	function warnIfBlind() {
		setTimeout(() => {
			if (!everSawCards) {
				warn(
					'Found no title cards on this page. If this is a storefront, Prime Video’s markup ' +
						'has probably changed — CARD_SELECTOR needs a look.'
				)
			} else if (settings.hideNotIncluded && !everReadEntitlement) {
				warn(
					'Found title cards but could not tell which are included with Prime. The entitlement ' +
						'markup has probably changed — readEntitlement() needs a look.'
				)
			}
		}, 10000)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CONTROL PANEL
	// ═══════════════════════════════════════════════════════════════════

	let launcherEl = null
	let panelEl = null
	let resetArmed = false

	function buildLauncher() {
		if (document.getElementById(LAUNCHER_ID)) return

		launcherEl = document.createElement('button')
		launcherEl.id = LAUNCHER_ID
		launcherEl.type = 'button'
		launcherEl.title = 'Prime Video Filter — open settings (Alt+Shift+F pauses filtering)'
		launcherEl.innerHTML =
			'<span class="pvf-led"></span><span class="pvf-launcher-icon">⧩</span>' +
			'<span class="pvf-launcher-text">Filter titles</span>' +
			'<span class="pvf-launcher-state">Off</span>'
		launcherEl.addEventListener('click', togglePanel)
		if (!introSeen()) launcherEl.classList.add('pvf-intro')
		document.body.appendChild(launcherEl)
	}

	function buildPanel() {
		if (document.getElementById(PANEL_ID)) return

		panelEl = document.createElement('div')
		panelEl.id = PANEL_ID
		panelEl.hidden = true
		panelEl.innerHTML = `
			<div class="pvf-header">
				<span class="pvf-title">⧩ Prime Video Filter</span>
				<button type="button" class="pvf-close" id="pvf-close" title="Close">✕ Close</button>
			</div>
			<div class="pvf-body">
				<div class="pvf-row pvf-master">
					<span class="pvf-label">Filtering</span>
					<button type="button" class="pvf-switch" id="pvf-enabled"></button>
				</div>
				<p class="pvf-echo pvf-summary" id="pvf-summary"></p>

				<div class="pvf-group">
					<div class="pvf-row">
						<span class="pvf-label">Hide titles not included with Prime</span>
						<button type="button" class="pvf-switch" id="pvf-not-included"></button>
					</div>
					<p class="pvf-note">Rent, buy, and paid-channel titles.</p>
				</div>

				<div class="pvf-group">
					<div class="pvf-row">
						<span class="pvf-label">Hide titles I’ve watched</span>
						<button type="button" class="pvf-switch" id="pvf-watched"></button>
					</div>
					<div class="pvf-sub" data-for="watched">
						<label class="pvf-label" for="pvf-watched-pct">Counts as watched at</label>
						<input type="range" id="pvf-watched-pct"
							min="${WATCHED_MIN_PCT}" max="${WATCHED_MAX_PCT}" step="5">
						<p class="pvf-echo" id="pvf-watched-echo"></p>
					</div>
				</div>

				<div class="pvf-group">
					<div class="pvf-row">
						<span class="pvf-label">Hide low-rated titles</span>
						<button type="button" class="pvf-switch" id="pvf-rated"></button>
					</div>
					<div class="pvf-sub" data-for="rated">
						<label class="pvf-label" for="pvf-min-rating">Lowest IMDb rating to keep</label>
						<input type="range" id="pvf-min-rating"
							min="${RATING_MIN}" max="${RATING_MAX}" step="0.1">
						<p class="pvf-echo" id="pvf-rating-echo"></p>
						<div class="pvf-row pvf-row-sm">
							<span class="pvf-label">Hide titles with no IMDb rating</span>
							<button type="button" class="pvf-switch" id="pvf-unrated"></button>
						</div>
					</div>
				</div>

				<div class="pvf-row">
					<span class="pvf-label">Hide rows with nothing left</span>
					<button type="button" class="pvf-switch" id="pvf-rows"></button>
				</div>
			</div>
			<div class="pvf-footer">
				<span class="pvf-hint">Alt+Shift+F pauses filtering</span>
				<button type="button" class="pvf-reset" id="pvf-reset">↺ Reset to defaults</button>
			</div>
		`
		document.body.appendChild(panelEl)

		panelEl.querySelector('#pvf-close').addEventListener('click', closePanel)

		const toggles = {
			'#pvf-enabled': 'enabled',
			'#pvf-not-included': 'hideNotIncluded',
			'#pvf-watched': 'hideWatched',
			'#pvf-rated': 'hideLowRated',
			'#pvf-unrated': 'hideUnrated',
			'#pvf-rows': 'hideEmptyRows',
		}
		for (const [selector, key] of Object.entries(toggles)) {
			panelEl.querySelector(selector).addEventListener('click', () => {
				settings[key] = !settings[key]
				saveAndApply()
			})
		}

		bindSlider('#pvf-watched-pct', (v) => {
			settings.watchedPct = Math.round(clampNumber(v, WATCHED_MIN_PCT, WATCHED_MAX_PCT, DEFAULTS.watchedPct))
		})
		bindSlider('#pvf-min-rating', (v) => {
			settings.minRating = roundTo(clampNumber(v, RATING_MIN, RATING_MAX, DEFAULTS.minRating), 0.1)
		})

		// Two-step confirm: a reset throws away thresholds the user tuned.
		const reset = panelEl.querySelector('#pvf-reset')
		reset.addEventListener('click', () => {
			if (!resetArmed) {
				resetArmed = true
				reset.textContent = '↺ Click again to reset'
				reset.classList.add('pvf-armed')
				setTimeout(disarmReset, 4000)
				return
			}
			disarmReset()
			settings = { ...DEFAULTS }
			log('Settings reset to defaults.')
			saveAndApply()
		})
	}

	// Echo while dragging, filter on release — re-filtering a storefront on
	// every slider tick would stutter.
	function bindSlider(selector, assign) {
		const slider = panelEl.querySelector(selector)
		slider.addEventListener('input', () => {
			assign(slider.value)
			renderPanelState()
		})
		slider.addEventListener('change', () => {
			assign(slider.value)
			saveAndApply()
		})
	}

	function disarmReset() {
		resetArmed = false
		const reset = panelEl?.querySelector('#pvf-reset')
		if (!reset) return
		reset.textContent = '↺ Reset to defaults'
		reset.classList.remove('pvf-armed')
	}

	function setText(el, text) {
		if (el && el.textContent !== text) el.textContent = text
	}

	function setSwitch(button, on) {
		if (!button) return
		setText(button, on ? 'On' : 'Off')
		button.setAttribute('aria-pressed', on ? 'true' : 'false')
		button.classList.toggle('pvf-on', on)
		button.classList.toggle('pvf-off', !on)
	}

	function summaryText() {
		if (!settings.enabled) return 'Paused — showing everything.'
		if (!anyFilterOn()) return 'No filters on — showing everything.'
		const c = lastCounts
		if (!c || !c.total) return 'Waiting for titles on this page…'

		const parts = []
		if (c['not-included']) parts.push(`${c['not-included']} not included`)
		if (c.watched) parts.push(`${c.watched} watched`)
		if (c['low-rated']) parts.push(`${c['low-rated']} rated below ${formatRating(settings.minRating)}`)
		if (c.unrated) parts.push(`${c.unrated} with no rating`)

		let text = `Hiding ${c.hidden} of ${c.total} titles`
		if (parts.length) text += ` — ${parts.join(', ')}`
		text += '.'
		if (c.ratingPending) text += ` Looking up ${c.ratingPending} IMDb ratings as you scroll.`
		if (settings.hideNotIncluded && c.entitlementUnknown) {
			text += ` ${c.entitlementUnknown} couldn’t be checked for Prime, so they stay.`
		}
		return text
	}

	function renderPanelState() {
		if (launcherEl) {
			const active = settings.enabled && anyFilterOn()
			launcherEl.classList.toggle('pvf-idle', !active)
			const state = launcherEl.querySelector('.pvf-launcher-state')
			if (state) {
				if (!settings.enabled) setText(state, 'Paused')
				else if (!anyFilterOn()) setText(state, 'Off')
				else setText(state, `${lastCounts?.hidden ?? 0} hidden`)
			}
		}

		if (!panelEl || panelEl.hidden) return

		setSwitch(panelEl.querySelector('#pvf-enabled'), settings.enabled)
		setSwitch(panelEl.querySelector('#pvf-not-included'), settings.hideNotIncluded)
		setSwitch(panelEl.querySelector('#pvf-watched'), settings.hideWatched)
		setSwitch(panelEl.querySelector('#pvf-rated'), settings.hideLowRated)
		setSwitch(panelEl.querySelector('#pvf-unrated'), settings.hideUnrated)
		setSwitch(panelEl.querySelector('#pvf-rows'), settings.hideEmptyRows)

		const pct = panelEl.querySelector('#pvf-watched-pct')
		if (pct.value !== String(settings.watchedPct)) pct.value = String(settings.watchedPct)
		const rating = panelEl.querySelector('#pvf-min-rating')
		if (Number(rating.value) !== settings.minRating) rating.value = String(settings.minRating)

		setText(
			panelEl.querySelector('#pvf-watched-echo'),
			settings.watchedPct >= 100
				? 'Watched = played to the very end (100%)'
				: `Watched = ${settings.watchedPct}% or more played`
		)
		setText(
			panelEl.querySelector('#pvf-rating-echo'),
			`Keeps IMDb ${formatRating(settings.minRating)} and up; hides anything lower`
		)

		setText(panelEl.querySelector('#pvf-summary'), summaryText())

		panelEl.querySelector('[data-for="watched"]').classList.toggle('pvf-inert', !settings.hideWatched)
		panelEl.querySelector('[data-for="rated"]').classList.toggle('pvf-inert', !settings.hideLowRated)
		panelEl.classList.toggle('pvf-disabled', !settings.enabled)
	}

	// The launcher glows until the panel has been opened once, so a fresh
	// install is easy to spot; after that it sits quietly in the corner.
	function introSeen() {
		try {
			return localStorage.getItem(INTRO_KEY) === '1'
		} catch {
			return false
		}
	}

	function markIntroSeen() {
		launcherEl?.classList.remove('pvf-intro')
		try {
			localStorage.setItem(INTRO_KEY, '1')
		} catch {
			// Worst case the glow comes back next visit.
		}
	}

	function openPanel() {
		if (!panelEl) return
		markIntroSeen()
		panelEl.hidden = false
		renderPanelState()
	}

	function closePanel() {
		if (!panelEl) return
		disarmReset()
		panelEl.hidden = true
	}

	function togglePanel() {
		if (!panelEl) return
		if (panelEl.hidden) openPanel()
		else closePanel()
	}

	// <update-check>
	// ═══════════════════════════════════════════════════════════════════
	//  UPDATE CHECK
	//  Generated from tools/update-check.template.js — do not edit here.
	//  Change the template, then run: node tools/sync-update-check.mjs
	// ═══════════════════════════════════════════════════════════════════

	const UPDATE_BANNER_ID = 'prime-video-filter-update-banner'
	const UPDATE_DISMISS_KEY = 'prime_video_filter_update_dismissed_v'

	// Tampermonkey exposes the script's own metadata block, so these URLs
	// don't have to be hand-maintained in two places. Greasemonkey 4 does
	// not expose them, hence the literal fallbacks.
	const META_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/prime-video-filter/prime-video-filter.meta.js'
	const DOWNLOAD_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/prime-video-filter/prime-video-filter.user.js'

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
	//  CSS
	// ═══════════════════════════════════════════════════════════════════

	const PAGE_CSS = `
		[${HIDDEN_ATTR}], [${ROW_HIDDEN_ATTR}] { display: none !important; }

		/* Fast path: the browser hides a paid card as it renders, with no
		   wait for the script. Cards without the attribute go through the
		   script's label check instead. */
		html.${HIDE_PAID_CLASS} li:has(> article[data-card-entitlement]:not([data-card-entitlement="Entitled" i])) {
			display: none !important;
		}
	`

	const PANEL_CSS = `
		#${LAUNCHER_ID} {
			position: fixed;
			right: 20px;
			bottom: 20px;
			z-index: 2147483646;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 9px 14px 9px 12px;
			border: 1px solid #00a8e1;
			border-radius: 999px;
			background: #0f171e;
			color: #fff;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			font-size: 14px;
			font-weight: 600;
			line-height: 1;
			cursor: pointer;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55), 0 0 0 3px rgba(0, 168, 225, 0.18);
			transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease;
		}
		#${LAUNCHER_ID}:hover {
			transform: translateY(-2px);
			background: #13212c;
			box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6), 0 0 0 4px rgba(0, 168, 225, 0.35);
		}
		#${LAUNCHER_ID} .pvf-launcher-icon { font-size: 15px; color: #00a8e1; }
		#${LAUNCHER_ID} .pvf-launcher-state {
			padding: 3px 8px;
			border-radius: 999px;
			background: #00a8e1;
			color: #0f171e;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.02em;
		}
		#${LAUNCHER_ID}.pvf-idle { border-color: #4b5d6b; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55); }
		#${LAUNCHER_ID}.pvf-idle .pvf-launcher-icon { color: #c5d0d9; }
		#${LAUNCHER_ID}.pvf-idle .pvf-launcher-state { background: #3a4854; color: #e6edf2; }

		/* The LED says "something is being hidden" at a glance. */
		#${LAUNCHER_ID} .pvf-led {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #00a8e1;
			box-shadow: 0 0 7px rgba(0, 168, 225, 0.95);
			animation: pvf-pulse 2.4s ease-in-out infinite;
		}
		#${LAUNCHER_ID}.pvf-idle .pvf-led {
			background: #6b7280;
			box-shadow: none;
			animation: none;
		}
		@keyframes pvf-pulse {
			0%, 100% { box-shadow: 0 0 4px rgba(0, 168, 225, 0.6); }
			50% { box-shadow: 0 0 10px rgba(0, 168, 225, 1); }
		}

		/* First visit: a ripple that keeps going until the panel is opened. */
		#${LAUNCHER_ID}.pvf-intro { animation: pvf-ripple 1.8s ease-out infinite; }
		@keyframes pvf-ripple {
			0% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55), 0 0 0 0 rgba(0, 168, 225, 0.7); }
			100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55), 0 0 0 18px rgba(0, 168, 225, 0); }
		}
		@media (prefers-reduced-motion: reduce) {
			#${LAUNCHER_ID}, #${LAUNCHER_ID} .pvf-led { animation: none !important; }
		}

		#${PANEL_ID} {
			position: fixed;
			right: 20px;
			bottom: 72px;
			z-index: 2147483647;
			width: 320px;
			max-height: calc(100vh - 80px);
			overflow-y: auto;
			border: 1px solid #25323d;
			border-radius: 10px;
			background: #0f171e;
			color: #e6edf2;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			font-size: 13px;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
		}
		#${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; }
		#${PANEL_ID}[hidden] { display: none; }

		#${PANEL_ID} .pvf-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 10px 12px;
			background: #1a242f;
			border-bottom: 1px solid #25323d;
		}
		#${PANEL_ID} .pvf-title { font-weight: 600; font-size: 13px; }
		#${PANEL_ID} .pvf-close {
			border: none;
			background: none;
			color: #e6edf2;
			font-size: 11px;
			padding: 2px 4px;
			opacity: 0.7;
			cursor: pointer;
		}
		#${PANEL_ID} .pvf-close:hover { opacity: 1; }

		#${PANEL_ID} .pvf-body { padding: 12px; }
		#${PANEL_ID} .pvf-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 10px;
		}
		#${PANEL_ID} .pvf-row-sm { margin: 8px 0 0; }
		#${PANEL_ID} .pvf-body > .pvf-row:last-child { margin-bottom: 0; }
		#${PANEL_ID} .pvf-master { margin-bottom: 4px; }
		#${PANEL_ID} .pvf-master .pvf-label { font-size: 13px; font-weight: 600; color: #fff; }
		#${PANEL_ID} .pvf-label { display: block; font-size: 12px; color: #c5d0d9; }

		#${PANEL_ID} .pvf-group {
			margin-bottom: 12px;
			padding-bottom: 12px;
			border-bottom: 1px solid #1f2a35;
		}
		#${PANEL_ID} .pvf-group .pvf-row { margin-bottom: 4px; }
		#${PANEL_ID} .pvf-note { margin: 0; font-size: 11px; color: #8595a3; }
		#${PANEL_ID} .pvf-sub { margin-top: 6px; transition: opacity 0.15s ease; }
		#${PANEL_ID} .pvf-sub.pvf-inert { opacity: 0.45; }

		#${PANEL_ID} .pvf-switch {
			flex: 0 0 auto;
			min-width: 52px;
			padding: 5px 12px;
			border: none;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.03em;
			color: #fff;
			cursor: pointer;
			transition: background 0.15s ease;
		}
		#${PANEL_ID} .pvf-switch.pvf-on { background: #00a8e1; }
		#${PANEL_ID} .pvf-switch.pvf-on:hover { background: #0090c2; }
		#${PANEL_ID} .pvf-switch.pvf-off { background: #4b5563; }
		#${PANEL_ID} .pvf-switch.pvf-off:hover { background: #374151; }

		#${PANEL_ID} input[type="range"] {
			width: 100%;
			margin: 6px 0 2px;
			accent-color: #00a8e1;
			cursor: pointer;
		}
		#${PANEL_ID} .pvf-echo {
			margin: 0;
			font-size: 11.5px;
			line-height: 1.45;
			color: #7fd3f0;
		}
		#${PANEL_ID} .pvf-summary {
			margin-bottom: 12px;
			padding: 7px 9px;
			border-radius: 6px;
			background: #13202b;
			color: #a9dff2;
		}

		#${PANEL_ID}.pvf-disabled .pvf-group,
		#${PANEL_ID}.pvf-disabled .pvf-body > .pvf-row:last-child { opacity: 0.5; }

		#${PANEL_ID} .pvf-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 9px 12px;
			border-top: 1px solid #25323d;
			background: #0b1218;
		}
		#${PANEL_ID} .pvf-hint { font-size: 10.5px; color: #71808c; }
		#${PANEL_ID} .pvf-reset {
			padding: 4px 9px;
			border: 1px solid #7f1d1d;
			border-radius: 6px;
			background: transparent;
			color: #f0787a;
			font-size: 11px;
			cursor: pointer;
			transition: background 0.15s ease, color 0.15s ease;
		}
		#${PANEL_ID} .pvf-reset:hover { background: #7f1d1d; color: #fff; }
		#${PANEL_ID} .pvf-reset.pvf-armed {
			background: #b91c1c;
			border-color: #b91c1c;
			color: #fff;
		}
	`

	// ═══════════════════════════════════════════════════════════════════
	//  INITIALIZATION
	// ═══════════════════════════════════════════════════════════════════

	function init() {
		// One failing step must not stop the rest: a thrown error in the first
		// pass used to leave the page unwatched, and nothing on screen said why.
		const step = (name, fn) => {
			try {
				fn()
			} catch (e) {
				console.error(`${LOG_PREFIX} ${name} failed:`, e)
			}
		}
		checkForUpdate()
		settings = readSettings()
		log(
			`v${SCRIPT_VERSION} — filtering ${settings.enabled ? 'on' : 'paused'}; ` +
				`not-included ${settings.hideNotIncluded ? 'hidden' : 'shown'}, ` +
				`watched ${settings.hideWatched ? `hidden at ${settings.watchedPct}%` : 'shown'}, ` +
				`rating ${settings.hideLowRated ? `below ${formatRating(settings.minRating)} hidden` : 'ignored'}.`
		)
		step('Styles', () => GM_addStyle(PAGE_CSS + PANEL_CSS))
		step('Launcher', buildLauncher)
		step('Panel', buildPanel)
		step('First filter pass', apply)
		step('Page watching', startWatching)
		step('Keyboard shortcut', setupKeyboardShortcut)
		step('Blindness check', warnIfBlind)
	}

	init()
})()
