// ==UserScript==
// @name         AI Chat Widescreen
// @namespace    ai-chat-widescreen
// @version      1.0.0
// @description  Widescreen mode for ChatGPT, Claude, and Gemini — widens the narrow chat column to fit your monitor, with a per-site width control
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/ai-chat-widescreen/ai-chat-widescreen.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/ai-chat-widescreen/ai-chat-widescreen.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[AI Widescreen]'
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'

	const STORAGE_KEY = 'ai_chat_widescreen_settings_v1'
	const LAUNCHER_ID = 'aiws-launcher'
	const PANEL_ID = 'aiws-panel'

	// Marks a container the script has taken over, and remembers the width
	// the site gave it. Both are re-applied after every SPA re-render.
	const WIDE_ATTR = 'data-aiws-wide'
	const STOCK_ATTR = 'data-aiws-stock'

	// A container only counts as "the readable column" if the site caps it
	// somewhere in this band. Narrower is a chip or an avatar; wider is the
	// app shell, which must keep its own width.
	const MIN_STOCK_PX = 360
	const MAX_STOCK_PX = 1400

	// Widescreen never makes the column narrower than the stock ~768px one,
	// however small the window gets.
	const FLOOR_PX = 768

	const WIDTH_MIN_PCT = 50
	const WIDTH_MAX_PCT = 100
	const WIDTH_STEP_PCT = 5

	// These pages re-render constantly while a reply streams in, so the
	// re-tag pass is debounced rather than run per mutation.
	const APPLY_DEBOUNCE_MS = 400

	const DEFAULTS = {
		enabled: true,
		widthPct: 80,
		matchComposer: true,
	}

	const PRESETS = [
		{ label: 'Comfortable', pct: 65 },
		{ label: 'Wide', pct: 80 },
		{ label: 'Full', pct: 100 },
	]

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
	//  SITE PROFILES
	// ═══════════════════════════════════════════════════════════════════

	// Each profile names elements that sit *inside* the chat column and the
	// composer. The engine walks up from those anchors and widens whatever it
	// finds capped along the way, so a class name churning (all three apps
	// ship generated Tailwind/Angular class names) costs at most one anchor,
	// not the whole script.

	const SITES = [
		{
			id: 'chatgpt',
			label: 'ChatGPT',
			hosts: ['chatgpt.com'],
			thread: [
				'[data-message-author-role]',
				'article[data-testid^="conversation-turn"]',
			],
			composer: [
				'form[data-type="unified-composer"]',
				'#composer-background',
				'main form',
			],
			// ChatGPT drives the column from a custom property, so overriding
			// it catches containers the ancestor walk never sees.
			widthVars: ['--thread-content-max-width'],
		},
		{
			id: 'claude',
			label: 'Claude',
			hosts: ['claude.ai'],
			thread: [
				'[data-testid="user-message"]',
				'.font-claude-response',
				'.font-claude-message',
				'div[data-test-render-count]',
			],
			composer: [
				'[data-testid="chat-input"]',
				'div[contenteditable="true"][translate="no"]',
				'main fieldset',
			],
			widthVars: [],
		},
		{
			id: 'gemini',
			label: 'Gemini',
			hosts: ['gemini.google.com'],
			thread: [
				'.conversation-container',
				'model-response',
				'user-query',
				'message-content',
			],
			composer: [
				'input-container',
				'.input-area-container',
				'rich-textarea',
			],
			widthVars: [],
		},
	]

	function detectSite() {
		const host = location.hostname
		return (
			SITES.find(s => s.hosts.some(h => host === h || host.endsWith(`.${h}`))) || null
		)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  SETTINGS
	// ═══════════════════════════════════════════════════════════════════

	// Settings are per site: a width that reads well on ChatGPT is not the
	// one that reads well on Gemini, and the panel only ever shows the site
	// you are actually looking at.

	function clampPct(value) {
		const n = Number(value)
		if (!Number.isFinite(n)) return DEFAULTS.widthPct
		return Math.min(WIDTH_MAX_PCT, Math.max(WIDTH_MIN_PCT, Math.round(n)))
	}

	function readAll() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (!raw) return {}
			const parsed = JSON.parse(raw)
			return parsed && typeof parsed === 'object' ? parsed : {}
		} catch (e) {
			warn('Could not read saved settings:', e)
			return {}
		}
	}

	function readSettings(siteId) {
		const stored = readAll()[siteId] || {}
		return {
			enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULTS.enabled,
			widthPct: clampPct(stored.widthPct),
			matchComposer:
				typeof stored.matchComposer === 'boolean'
					? stored.matchComposer
					: DEFAULTS.matchComposer,
		}
	}

	function writeSettings(siteId, next) {
		try {
			const all = readAll()
			all[siteId] = next
			localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
		} catch (e) {
			warn('Could not save settings (they apply for this tab only):', e)
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  WIDENING ENGINE
	// ═══════════════════════════════════════════════════════════════════

	let site = null
	let settings = { ...DEFAULTS }
	let dynamicStyle = null
	let applyTimer = null
	let reportedClaims = false

	// GM_addStyle is used for the injected sheet so a strict CSP on these
	// pages can't drop it; the returned node is reused as a live stylesheet.
	// There is exactly one of these for the life of the page — a second sheet
	// would keep applying whatever rules it was last given.
	function ensureDynamicStyle() {
		if (!dynamicStyle) {
			try {
				const node = GM_addStyle('')
				if (node && node.nodeType === 1) dynamicStyle = node
			} catch (e) {
				warn('GM_addStyle unavailable, falling back to a <style> element:', e)
			}
			if (!dynamicStyle) dynamicStyle = document.createElement('style')
			dynamicStyle.id = 'aiws-dynamic-style'
		}

		// At document-start there may be nothing to append to yet, and a few
		// of these apps re-render <head>. Either way, re-home the sheet and
		// let the next pass carry the rules in.
		if (!dynamicStyle.isConnected) {
			const root = document.head || document.documentElement
			if (root) root.appendChild(dynamicStyle)
		}

		return dynamicStyle
	}

	function widthExpr() {
		return `max(${settings.widthPct}vw, ${FLOOR_PX}px)`
	}

	function targetWidthPx() {
		return Math.round(Math.max((settings.widthPct / 100) * window.innerWidth, FLOOR_PX))
	}

	// Where a site drives its column from a custom property, that property is
	// inherited — so an unmatched composer has to be handed its own width
	// back explicitly, or the thread override widens it anyway.
	function composerStockRules() {
		if (!site.widthVars.length) return ''

		const widths = new Set()
		for (const el of document.querySelectorAll(`[${WIDE_ATTR}="composer"]`)) {
			const px = Number(el.getAttribute(STOCK_ATTR))
			if (Number.isFinite(px) && px > 0) widths.add(Math.round(px))
		}

		return [...widths]
			.map(px => {
				const vars = site.widthVars.map(name => `${name}: ${px}px !important;`).join(' ')
				return `[${WIDE_ATTR}="composer"][${STOCK_ATTR}="${px}"] { max-width: ${px}px !important; ${vars} }`
			})
			.join('\n')
	}

	// The sheet lives in the tree the observer watches, so rewriting it is a
	// mutation like any other. Writing only on a real change is what stops
	// apply → rewrite → mutation → apply from ticking forever.
	function writeStyle(css) {
		const style = ensureDynamicStyle()
		if (style.textContent !== css) style.textContent = css
	}

	function renderDynamicCss() {
		if (!settings.enabled) {
			writeStyle('')
			return
		}

		const expr = widthExpr()
		// Containers stay tagged either way; the stylesheet decides whether
		// the composer is included, so the toggle costs no DOM work.
		const scope = settings.matchComposer ? `[${WIDE_ATTR}]` : `[${WIDE_ATTR}="thread"]`
		const varRules = site.widthVars.length
			? `:root, html, body, main { ${site.widthVars
					.map(name => `${name}: ${expr} !important;`)
					.join(' ')} }`
			: ''

		writeStyle(
			[
				`${scope} { max-width: ${expr} !important; }`,
				varRules,
				settings.matchComposer ? '' : composerStockRules(),
			]
				.filter(Boolean)
				.join('\n')
		)
	}

	// Every selector in the list contributes every element it matches. Both
	// halves matter: these apps centre each turn in its own capped wrapper,
	// so one anchor would leave the rest of the thread narrow, and they mark
	// your turns and the reply's turns differently, so one selector would
	// leave every other turn narrow.
	function anchorsFor(selectors) {
		const anchors = []
		for (const selector of selectors) {
			try {
				anchors.push(...document.querySelectorAll(selector))
			} catch {
				/* a selector the browser doesn't support is just skipped */
			}
		}
		return anchors
	}

	// Walks anchor → body, claiming every container the site caps inside the
	// readable-column band. Hitting an already-claimed element ends the walk:
	// tagging runs bottom-up, so everything above it has been measured on an
	// earlier pass. That is what keeps a streaming reply cheap — only the
	// nodes that just appeared get measured.
	function tagFrom(selectors, kind) {
		let claimed = 0

		for (const anchor of anchorsFor(selectors)) {
			let el = anchor

			while (el && el !== document.body && el !== document.documentElement) {
				if (el.hasAttribute(WIDE_ATTR)) break

				const maxWidth = getComputedStyle(el).maxWidth
				const px = parseFloat(maxWidth)
				if (
					maxWidth.endsWith('px') &&
					Number.isFinite(px) &&
					px >= MIN_STOCK_PX &&
					px <= MAX_STOCK_PX
				) {
					el.setAttribute(WIDE_ATTR, kind)
					el.setAttribute(STOCK_ATTR, String(Math.round(px)))
					claimed++
				}

				el = el.parentElement
			}
		}

		return claimed
	}

	// Turning widescreen off leaves no trace of the script on the page.
	function untagAll() {
		for (const el of document.querySelectorAll(`[${WIDE_ATTR}]`)) {
			el.removeAttribute(WIDE_ATTR)
			el.removeAttribute(STOCK_ATTR)
		}
	}

	// The narrowest cap the site had put on the thread — what "site default"
	// means in the panel.
	function stockWidthPx() {
		let narrowest = null
		for (const el of document.querySelectorAll(`[${WIDE_ATTR}="thread"]`)) {
			const px = Number(el.getAttribute(STOCK_ATTR))
			if (Number.isFinite(px) && (narrowest === null || px < narrowest)) narrowest = px
		}
		return narrowest
	}

	function apply() {
		if (!settings.enabled) {
			untagAll()
			renderDynamicCss()
			renderPanelState()
			return
		}

		const claimed = tagFrom(site.thread, 'thread') + tagFrom(site.composer, 'composer')
		if (claimed && !reportedClaims) {
			reportedClaims = true
			log(`Widened ${claimed} container(s) on ${site.label}.`)
		}

		renderDynamicCss()
		renderPanelState()
	}

	function scheduleApply() {
		if (applyTimer) clearTimeout(applyTimer)
		applyTimer = setTimeout(() => {
			applyTimer = null
			apply()
		}, APPLY_DEBOUNCE_MS)
	}

	function saveAndApply() {
		writeSettings(site.id, settings)
		apply()
	}

	// ═══════════════════════════════════════════════════════════════════
	//  WATCHERS
	// ═══════════════════════════════════════════════════════════════════

	// All three apps are SPAs: opening a conversation swaps the whole thread
	// out, and the new nodes arrive untagged.
	function startWatching() {
		const observer = new MutationObserver(mutations => {
			for (const mutation of mutations) {
				const target = mutation.target
				const ours = `#${PANEL_ID}, #${LAUNCHER_ID}, #aiws-dynamic-style`
				if (target instanceof Element && target.closest(ours)) continue
				scheduleApply()
				return
			}
		})

		observer.observe(document.documentElement, { childList: true, subtree: true })

		for (const method of ['pushState', 'replaceState']) {
			const original = history[method]
			history[method] = function (...args) {
				const result = original.apply(this, args)
				scheduleApply()
				return result
			}
		}
		window.addEventListener('popstate', scheduleApply)

		// vw does the resizing on its own; only the panel's px readout has to
		// catch up.
		window.addEventListener('resize', renderPanelState)
	}

	function setupKeyboardShortcut() {
		document.addEventListener('keydown', event => {
			if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return
			if (event.code !== 'KeyW') return

			event.preventDefault()
			settings.enabled = !settings.enabled
			log(`Widescreen ${settings.enabled ? 'on' : 'off'} (Alt+Shift+W).`)
			saveAndApply()
		})
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
		launcherEl.title = 'Widescreen settings (Alt+Shift+W toggles widescreen)'
		launcherEl.innerHTML =
			'<span class="aiws-led"></span><span class="aiws-launcher-icon">⬌</span>' +
			'<span class="aiws-launcher-text">Widescreen</span>' +
			'<span class="aiws-launcher-state">On</span>'
		launcherEl.addEventListener('click', togglePanel)

		document.body.appendChild(launcherEl)
	}

	function buildPanel() {
		if (document.getElementById(PANEL_ID)) return

		panelEl = document.createElement('div')
		panelEl.id = PANEL_ID
		panelEl.hidden = true
		panelEl.innerHTML = `
			<div class="aiws-header">
				<span class="aiws-title">⬌ Widescreen — <span id="aiws-site-label"></span></span>
				<button type="button" class="aiws-close" id="aiws-close" title="Close">✕</button>
			</div>
			<div class="aiws-body">
				<div class="aiws-row">
					<span class="aiws-label">Widen the chat</span>
					<button type="button" class="aiws-switch" id="aiws-enabled"></button>
				</div>

				<div class="aiws-field">
					<label class="aiws-label" for="aiws-width">Chat width</label>
					<input type="range" id="aiws-width"
						min="${WIDTH_MIN_PCT}" max="${WIDTH_MAX_PCT}" step="${WIDTH_STEP_PCT}">
					<p class="aiws-echo">
						<strong id="aiws-echo-main"></strong>
						<span id="aiws-echo-sub"></span>
					</p>
					<div class="aiws-presets" id="aiws-presets"></div>
				</div>

				<div class="aiws-row">
					<span class="aiws-label">Match the input box</span>
					<button type="button" class="aiws-switch" id="aiws-composer"></button>
				</div>
			</div>
			<div class="aiws-footer">
				<span class="aiws-hint">Alt+Shift+W toggles widescreen</span>
				<button type="button" class="aiws-reset" id="aiws-reset">↺ Reset this site</button>
			</div>
		`

		document.body.appendChild(panelEl)

		panelEl.querySelector('#aiws-site-label').textContent = site.label
		panelEl.querySelector('#aiws-close').addEventListener('click', closePanel)

		panelEl.querySelector('#aiws-enabled').addEventListener('click', () => {
			settings.enabled = !settings.enabled
			saveAndApply()
		})

		panelEl.querySelector('#aiws-composer').addEventListener('click', () => {
			settings.matchComposer = !settings.matchComposer
			saveAndApply()
		})

		const slider = panelEl.querySelector('#aiws-width')
		// Live preview while dragging — the page resizes under the slider, so
		// the width you are choosing is the width you can see.
		slider.addEventListener('input', () => {
			settings.widthPct = clampPct(slider.value)
			renderDynamicCss()
			renderPanelState()
		})
		slider.addEventListener('change', () => {
			settings.widthPct = clampPct(slider.value)
			saveAndApply()
		})

		const presets = panelEl.querySelector('#aiws-presets')
		for (const preset of PRESETS) {
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'aiws-preset'
			button.dataset.pct = String(preset.pct)
			button.textContent = `${preset.label} ${preset.pct}%`
			button.addEventListener('click', () => {
				settings.widthPct = preset.pct
				saveAndApply()
			})
			presets.appendChild(button)
		}

		// Two-step confirm: resetting throws away a width the user tuned.
		const reset = panelEl.querySelector('#aiws-reset')
		reset.addEventListener('click', () => {
			if (!resetArmed) {
				resetArmed = true
				reset.textContent = '↺ Click again to reset'
				reset.classList.add('aiws-armed')
				setTimeout(disarmReset, 4000)
				return
			}
			disarmReset()
			settings = { ...DEFAULTS }
			log(`Settings reset to defaults for ${site.label}.`)
			saveAndApply()
		})
	}

	function disarmReset() {
		resetArmed = false
		const reset = panelEl?.querySelector('#aiws-reset')
		if (!reset) return
		reset.textContent = '↺ Reset this site'
		reset.classList.remove('aiws-armed')
	}

	function setSwitch(button, on) {
		if (!button) return
		button.textContent = on ? 'On' : 'Off'
		button.setAttribute('aria-pressed', on ? 'true' : 'false')
		button.classList.toggle('aiws-on', on)
		button.classList.toggle('aiws-off', !on)
	}

	function renderPanelState() {
		if (launcherEl) {
			launcherEl.classList.toggle('aiws-idle', !settings.enabled)
			const state = launcherEl.querySelector('.aiws-launcher-state')
			if (state) state.textContent = settings.enabled ? 'On' : 'Off'
		}

		if (!panelEl || panelEl.hidden) return

		setSwitch(panelEl.querySelector('#aiws-enabled'), settings.enabled)
		setSwitch(panelEl.querySelector('#aiws-composer'), settings.matchComposer)

		const slider = panelEl.querySelector('#aiws-width')
		if (slider && slider.value !== String(settings.widthPct)) {
			slider.value = String(settings.widthPct)
		}

		for (const preset of panelEl.querySelectorAll('.aiws-preset')) {
			preset.classList.toggle('aiws-active', Number(preset.dataset.pct) === settings.widthPct)
		}

		// The headline number is the whole point of the slider: how much chat
		// you actually get, on this window, before you commit to it.
		const stock = stockWidthPx()
		const main = panelEl.querySelector('#aiws-echo-main')
		const sub = panelEl.querySelector('#aiws-echo-sub')
		if (main && sub) {
			if (settings.enabled) {
				main.textContent = `≈ ${targetWidthPx()} px of chat`
				const detail = [`${settings.widthPct}% of this ${window.innerWidth} px window`]
				if (stock) detail.push(`site default ${stock} px`)
				sub.textContent = detail.join(' · ')
			} else {
				main.textContent = stock ? `${stock} px of chat` : 'The site’s own width'
				sub.textContent = 'Widescreen is off'
			}
		}

		panelEl.classList.toggle('aiws-disabled', !settings.enabled)
	}

	function openPanel() {
		if (!panelEl) return
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

	const UPDATE_BANNER_ID = 'ai-chat-widescreen-update-banner'
	const UPDATE_DISMISS_KEY = 'ai_chat_widescreen_update_dismissed_v'

	// Tampermonkey exposes the script's own metadata block, so these URLs
	// don't have to be hand-maintained in two places. Greasemonkey 4 does
	// not expose them, hence the literal fallbacks.
	const META_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ai-chat-widescreen/ai-chat-widescreen.meta.js'
	const DOWNLOAD_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/ai-chat-widescreen/ai-chat-widescreen.user.js'

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

	const PANEL_CSS = `
		#${LAUNCHER_ID} {
			position: fixed;
			right: 16px;
			bottom: 16px;
			z-index: 2147483646;
			display: flex;
			align-items: center;
			gap: 7px;
			padding: 6px 12px;
			border: 1px solid #16213e;
			border-radius: 999px;
			background: #1a1a2e;
			color: #e0e0e0;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			font-size: 12px;
			line-height: 1;
			cursor: pointer;
			opacity: 0.4;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
			transition: opacity 0.2s ease, transform 0.15s ease;
		}
		#${LAUNCHER_ID}:hover {
			opacity: 1;
			transform: translateY(-1px);
		}
		#${LAUNCHER_ID} .aiws-launcher-icon { font-size: 13px; }
		#${LAUNCHER_ID} .aiws-launcher-state {
			padding: 2px 6px;
			border-radius: 999px;
			background: #0f3460;
			font-size: 10px;
			font-weight: 600;
			letter-spacing: 0.03em;
		}
		#${LAUNCHER_ID}.aiws-idle .aiws-launcher-state { background: #3a2036; }

		/* The LED reads on at a glance, which is the point of a launcher that
		   sits at 40% opacity most of the time. */
		#${LAUNCHER_ID} .aiws-led {
			width: 7px;
			height: 7px;
			border-radius: 50%;
			background: #2ecc71;
			box-shadow: 0 0 6px rgba(46, 204, 113, 0.9);
			transition: background 0.2s ease, box-shadow 0.2s ease;
		}
		#${LAUNCHER_ID}.aiws-idle .aiws-led {
			background: #6b7280;
			box-shadow: none;
		}

		#${PANEL_ID} {
			position: fixed;
			right: 16px;
			bottom: 60px;
			z-index: 2147483647;
			width: 300px;
			border: 1px solid #16213e;
			border-radius: 10px;
			background: #1a1a2e;
			color: #e0e0e0;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			font-size: 13px;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
			overflow: hidden;
		}
		#${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; }
		#${PANEL_ID}[hidden] { display: none; }

		#${PANEL_ID} .aiws-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 10px 12px;
			background: #0f3460;
			border-bottom: 1px solid #16213e;
		}
		#${PANEL_ID} .aiws-title { font-weight: 600; font-size: 13px; }
		#${PANEL_ID} .aiws-close {
			border: none;
			background: none;
			color: #e0e0e0;
			font-size: 15px;
			line-height: 1;
			padding: 2px 4px;
			opacity: 0.7;
			cursor: pointer;
		}
		#${PANEL_ID} .aiws-close:hover { opacity: 1; }

		#${PANEL_ID} .aiws-body { padding: 12px; }
		#${PANEL_ID} .aiws-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 12px;
		}
		#${PANEL_ID} .aiws-field { margin-bottom: 12px; }
		#${PANEL_ID} .aiws-row:last-child,
		#${PANEL_ID} .aiws-field:last-child { margin-bottom: 0; }
		#${PANEL_ID} .aiws-label {
			display: block;
			font-size: 12px;
			color: #c7c7d1;
		}

		#${PANEL_ID} .aiws-switch {
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
		#${PANEL_ID} .aiws-switch.aiws-on { background: #2ecc71; }
		#${PANEL_ID} .aiws-switch.aiws-on:hover { background: #27ae60; }
		#${PANEL_ID} .aiws-switch.aiws-off { background: #4b5563; }
		#${PANEL_ID} .aiws-switch.aiws-off:hover { background: #374151; }

		#${PANEL_ID} #aiws-width {
			width: 100%;
			margin: 8px 0 4px;
			accent-color: #4f9cf9;
			cursor: pointer;
		}
		#${PANEL_ID} .aiws-echo {
			margin: 0 0 9px;
			font-size: 11px;
			line-height: 1.45;
		}
		#${PANEL_ID} .aiws-echo strong {
			display: block;
			font-size: 13px;
			font-weight: 600;
			color: #7ec8e3;
		}
		#${PANEL_ID} .aiws-echo span { color: #8390a5; }

		#${PANEL_ID} .aiws-presets { display: flex; gap: 6px; }
		#${PANEL_ID} .aiws-preset {
			flex: 1 1 auto;
			padding: 5px 4px;
			border: 1px solid #16213e;
			border-radius: 6px;
			background: #16213e;
			color: #c7c7d1;
			font-size: 11px;
			cursor: pointer;
			transition: background 0.15s ease, color 0.15s ease;
		}
		#${PANEL_ID} .aiws-preset:hover { background: #0f3460; color: #fff; }
		#${PANEL_ID} .aiws-preset.aiws-active {
			background: #0f3460;
			border-color: #4f9cf9;
			color: #fff;
		}

		/* Off is a state, not a dead panel: the width controls stay readable
		   but visibly inert. */
		#${PANEL_ID}.aiws-disabled .aiws-field,
		#${PANEL_ID}.aiws-disabled .aiws-row:last-of-type { opacity: 0.5; }

		#${PANEL_ID} .aiws-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 9px 12px;
			border-top: 1px solid #16213e;
			background: #15152a;
		}
		#${PANEL_ID} .aiws-hint { font-size: 10.5px; color: #7a7a8c; }
		#${PANEL_ID} .aiws-reset {
			padding: 4px 9px;
			border: 1px solid #7f1d1d;
			border-radius: 6px;
			background: transparent;
			color: #f0787a;
			font-size: 11px;
			cursor: pointer;
			transition: background 0.15s ease, color 0.15s ease;
		}
		#${PANEL_ID} .aiws-reset:hover { background: #7f1d1d; color: #fff; }
		#${PANEL_ID} .aiws-reset.aiws-armed {
			background: #b91c1c;
			border-color: #b91c1c;
			color: #fff;
		}
	`

	// ═══════════════════════════════════════════════════════════════════
	//  INITIALIZATION
	// ═══════════════════════════════════════════════════════════════════

	function mountUi() {
		GM_addStyle(PANEL_CSS)
		buildLauncher()
		buildPanel()
		renderPanelState()
	}

	// Two phases: the stylesheet goes in at document-start, so a site that
	// drives its column from a custom property is already wide by first
	// paint. Tagging containers has to wait for the app to render them.
	function bootEarly() {
		site = detectSite()
		if (!site) {
			warn(`No site profile for ${location.hostname} — nothing to widen.`)
			return false
		}

		settings = readSettings(site.id)
		log(
			`v${SCRIPT_VERSION} on ${site.label} — widescreen ${settings.enabled ? 'on' : 'off'} at ${settings.widthPct}%.`
		)
		renderDynamicCss()
		return true
	}

	// If the anchors ever stop matching, the failure is silent — the page just
	// looks stock. Say so once, where whoever has to fix it will look.
	function warnIfNothingClaimed() {
		setTimeout(() => {
			if (!settings.enabled || reportedClaims) return
			warn(
				`Found no chat column to widen on ${site.label}. The site's markup has probably ` +
					`changed — the anchor selectors in this script's SITE PROFILES need a look.`
			)
		}, 8000)
	}

	function init() {
		checkForUpdate()
		mountUi()
		apply()
		startWatching()
		setupKeyboardShortcut()
		warnIfNothingClaimed()
	}

	if (bootEarly()) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', init)
		} else {
			init()
		}
	}
})()
