// ==UserScript==
// @name         Bonjourr Quick Add
// @namespace    bonjourr-quick-add
// @version      1.0.0
// @description  Quickly add shortcuts to Bonjourr with automatic title fetching
// @match        chrome-extension://*/index.html
// @match        moz-extension://*/index.html
// @match        *://online.bonjourr.fr/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/bonjourr-quick-add/bonjourr-quick-add.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/bonjourr-quick-add/bonjourr-quick-add.user.js
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

;(function () {
	'use strict'

	const LOGGER_PREFIX = '[BonjourrQuickAdd]'

	function log(msg, ...args) {
		console.log(`${LOGGER_PREFIX} ${msg}`, ...args)
	}

	function logError(msg, ...args) {
		console.error(`${LOGGER_PREFIX} ${msg}`, ...args)
	}

	// --- Title Fetcher ---

	function fetchPageTitle(url) {
		return new Promise((resolve) => {
			const normalized = normalizeUrl(url)

			GM_xmlhttpRequest({
				method: 'GET',
				url: normalized,
				timeout: 8000,
				onload(response) {
					const title = parseTitleFromHtml(response.responseText)
					if (title) {
						log('Fetched title:', title)
						resolve(title)
					} else {
						log('No title found, falling back to hostname')
						resolve(fallbackTitle(normalized))
					}
				},
				onerror() {
					logError('Failed to fetch URL:', normalized)
					resolve(fallbackTitle(normalized))
				},
				ontimeout() {
					logError('Timeout fetching URL:', normalized)
					resolve(fallbackTitle(normalized))
				},
			})
		})
	}

	function parseTitleFromHtml(html) {
		if (!html) return null

		// Prefer og:title for cleaner names
		const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
			|| html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
		if (ogMatch) return decodeHtmlEntities(ogMatch[1].trim())

		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
		if (titleMatch) return decodeHtmlEntities(titleMatch[1].trim())

		return null
	}

	function decodeHtmlEntities(text) {
		const textarea = document.createElement('textarea')
		textarea.innerHTML = text
		return textarea.value
	}

	function normalizeUrl(url) {
		url = url.trim()
		if (!/^https?:\/\//i.test(url)) {
			url = 'https://' + url
		}
		return url
	}

	function fallbackTitle(url) {
		try {
			const hostname = new URL(url).hostname.replace(/^www\./, '')
			// Capitalize first letter of domain name
			const name = hostname.split('.')[0]
			return name.charAt(0).toUpperCase() + name.slice(1)
		} catch {
			return url
		}
	}

	// --- Bonjourr Form Bridge ---

	function ensureSettingsReady() {
		// Settings form elements exist in the DOM but event listeners
		// are only attached after the settings panel opens once.
		// Check if the form has been initialized by looking for the submit handler.
		const form = document.getElementById('f_addlink')
		if (!form) return false
		return true
	}

	function openSettingsIfNeeded() {
		const settingsPanel = document.getElementById('settings')
		if (!settingsPanel) return false

		const isOpen = settingsPanel.classList.contains('shown')
			|| settingsPanel.style.display !== 'none'
			|| document.body.classList.contains('settings-open')

		if (!isOpen) {
			// Trigger settings open via the settings button
			const settingsBtn = document.getElementById('settings-btn')
				|| document.querySelector('[aria-label="settings"]')
				|| document.getElementById('skiptosettings')
			if (settingsBtn) {
				settingsBtn.click()
				return true // we opened it
			}
		}
		return false // already open or couldn't open
	}

	function closeSettings() {
		const settingsPanel = document.getElementById('settings')
		if (!settingsPanel) return

		// Press Escape to close cleanly
		document.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Escape',
			code: 'Escape',
			bubbles: true,
		}))
	}

	async function addLinkToBonjourr(url, title) {
		const form = document.getElementById('f_addlink')
		const urlInput = document.getElementById('i_addlink-url')
		const titleInput = document.getElementById('i_addlink-title')

		if (!form || !urlInput || !titleInput) {
			logError('Bonjourr form elements not found. Opening settings to initialize...')

			openSettingsIfNeeded()
			// Wait for settings to initialize
			await delay(500)

			return addLinkToBonjourrDirect(url, title)
		}

		urlInput.value = url
		titleInput.value = title

		// Dispatch input events so Bonjourr's validation runs
		urlInput.dispatchEvent(new Event('input', { bubbles: true }))
		titleInput.dispatchEvent(new Event('input', { bubbles: true }))

		// Brief delay for validation
		await delay(50)

		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
		log('Link submitted:', { url, title })
	}

	async function addLinkToBonjourrDirect(url, title) {
		// Retry after settings initialization
		const form = document.getElementById('f_addlink')
		const urlInput = document.getElementById('i_addlink-url')
		const titleInput = document.getElementById('i_addlink-title')

		if (!form || !urlInput || !titleInput) {
			logError('Form still not found after opening settings')
			showNotification('Failed to add link - form not found', true)
			return
		}

		urlInput.value = url
		titleInput.value = title
		urlInput.dispatchEvent(new Event('input', { bubbles: true }))
		titleInput.dispatchEvent(new Event('input', { bubbles: true }))
		await delay(50)

		form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))

		// Close settings if we opened them
		await delay(300)
		closeSettings()
		log('Link submitted (via settings open):', { url, title })
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	// --- UI ---

	function injectStyles() {
		const style = document.createElement('style')
		style.textContent = /* css */ `
			#bqa-fab {
				position: fixed;
				bottom: 24px;
				right: 24px;
				width: 48px;
				height: 48px;
				border-radius: 50%;
				border: none;
				background: rgba(255, 255, 255, 0.15);
				backdrop-filter: blur(12px);
				-webkit-backdrop-filter: blur(12px);
				color: white;
				font-size: 24px;
				cursor: pointer;
				z-index: 9999;
				display: flex;
				align-items: center;
				justify-content: center;
				transition: transform 0.2s, background 0.2s, opacity 0.2s;
				opacity: 0.6;
				box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
			}

			#bqa-fab:hover {
				transform: scale(1.1);
				background: rgba(255, 255, 255, 0.25);
				opacity: 1;
			}

			#bqa-fab:active {
				transform: scale(0.95);
			}

			#bqa-overlay {
				position: fixed;
				inset: 0;
				background: rgba(0, 0, 0, 0.5);
				backdrop-filter: blur(4px);
				-webkit-backdrop-filter: blur(4px);
				z-index: 10000;
				display: flex;
				align-items: center;
				justify-content: center;
				opacity: 0;
				visibility: hidden;
				transition: opacity 0.2s, visibility 0.2s;
			}

			#bqa-overlay.open {
				opacity: 1;
				visibility: visible;
			}

			#bqa-modal {
				background: rgba(30, 30, 30, 0.9);
				backdrop-filter: blur(20px);
				-webkit-backdrop-filter: blur(20px);
				border: 1px solid rgba(255, 255, 255, 0.1);
				border-radius: 16px;
				padding: 28px;
				width: 400px;
				max-width: 90vw;
				color: white;
				transform: translateY(10px);
				transition: transform 0.2s;
			}

			#bqa-overlay.open #bqa-modal {
				transform: translateY(0);
			}

			#bqa-modal h3 {
				margin: 0 0 20px;
				font-size: 16px;
				font-weight: 500;
				opacity: 0.9;
			}

			.bqa-field {
				margin-bottom: 14px;
			}

			.bqa-field label {
				display: block;
				font-size: 12px;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				opacity: 0.5;
				margin-bottom: 6px;
			}

			.bqa-field input {
				width: 100%;
				padding: 10px 12px;
				border: 1px solid rgba(255, 255, 255, 0.15);
				border-radius: 8px;
				background: rgba(255, 255, 255, 0.08);
				color: white;
				font-size: 14px;
				outline: none;
				transition: border-color 0.2s;
				box-sizing: border-box;
			}

			.bqa-field input:focus {
				border-color: rgba(255, 255, 255, 0.35);
			}

			.bqa-field input::placeholder {
				color: rgba(255, 255, 255, 0.3);
			}

			.bqa-status {
				font-size: 12px;
				opacity: 0.5;
				margin-bottom: 16px;
				min-height: 18px;
			}

			.bqa-status.fetching {
				opacity: 0.7;
			}

			.bqa-actions {
				display: flex;
				justify-content: flex-end;
				gap: 10px;
			}

			.bqa-actions button {
				padding: 8px 20px;
				border-radius: 8px;
				border: none;
				font-size: 14px;
				cursor: pointer;
				transition: background 0.2s, opacity 0.2s;
			}

			#bqa-cancel {
				background: rgba(255, 255, 255, 0.1);
				color: white;
			}

			#bqa-cancel:hover {
				background: rgba(255, 255, 255, 0.18);
			}

			#bqa-submit {
				background: rgba(255, 255, 255, 0.2);
				color: white;
				font-weight: 500;
			}

			#bqa-submit:hover {
				background: rgba(255, 255, 255, 0.3);
			}

			#bqa-submit:disabled {
				opacity: 0.3;
				cursor: not-allowed;
			}

			#bqa-notification {
				position: fixed;
				bottom: 84px;
				right: 24px;
				background: rgba(30, 30, 30, 0.9);
				backdrop-filter: blur(12px);
				-webkit-backdrop-filter: blur(12px);
				border: 1px solid rgba(255, 255, 255, 0.1);
				color: white;
				padding: 10px 16px;
				border-radius: 10px;
				font-size: 13px;
				z-index: 10001;
				opacity: 0;
				transform: translateY(8px);
				transition: opacity 0.3s, transform 0.3s;
				pointer-events: none;
			}

			#bqa-notification.show {
				opacity: 1;
				transform: translateY(0);
			}

			#bqa-notification.error {
				border-color: rgba(255, 80, 80, 0.3);
			}
		`
		document.head.appendChild(style)
	}

	function createFab() {
		const fab = document.createElement('button')
		fab.id = 'bqa-fab'
		fab.title = 'Quick add shortcut (Alt+A)'
		fab.innerHTML = '+'
		fab.addEventListener('click', openModal)
		document.body.appendChild(fab)
	}

	function createOverlay() {
		const overlay = document.createElement('div')
		overlay.id = 'bqa-overlay'
		overlay.innerHTML = `
			<div id="bqa-modal">
				<h3>Add Shortcut</h3>
				<div class="bqa-field">
					<label>URL</label>
					<input type="text" id="bqa-url" placeholder="example.com" spellcheck="false" />
				</div>
				<div class="bqa-field">
					<label>Title</label>
					<input type="text" id="bqa-title" placeholder="Auto-detected from page" maxlength="64" spellcheck="false" />
				</div>
				<div class="bqa-status" id="bqa-status"></div>
				<div class="bqa-actions">
					<button id="bqa-cancel">Cancel</button>
					<button id="bqa-submit" disabled>Add</button>
				</div>
			</div>
		`

		// Close on backdrop click
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeModal()
		})

		document.body.appendChild(overlay)

		const urlInput = document.getElementById('bqa-url')
		const titleInput = document.getElementById('bqa-title')
		const submitBtn = document.getElementById('bqa-submit')

		// Auto-fetch title on URL blur or Enter in URL field
		let fetchDebounce = null
		urlInput.addEventListener('input', () => {
			const url = urlInput.value.trim()
			submitBtn.disabled = url.length < 3

			clearTimeout(fetchDebounce)
			if (url.length >= 4 && !titleInput.dataset.manual) {
				fetchDebounce = setTimeout(() => autoFetchTitle(url), 600)
			}
		})

		urlInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				const url = urlInput.value.trim()
				if (url.length >= 3) {
					if (!titleInput.value.trim()) {
						autoFetchTitle(url)
					}
					titleInput.focus()
				}
			}
		})

		// Track if user manually set a title
		titleInput.addEventListener('input', () => {
			titleInput.dataset.manual = titleInput.value.trim() ? 'true' : ''
		})

		titleInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				handleSubmit()
			}
		})

		document.getElementById('bqa-cancel').addEventListener('click', closeModal)
		submitBtn.addEventListener('click', handleSubmit)
	}

	function createNotification() {
		const notif = document.createElement('div')
		notif.id = 'bqa-notification'
		document.body.appendChild(notif)
	}

	async function autoFetchTitle(url) {
		const titleInput = document.getElementById('bqa-title')
		const status = document.getElementById('bqa-status')

		if (titleInput.dataset.manual) return

		status.textContent = 'Fetching page title...'
		status.className = 'bqa-status fetching'

		const title = await fetchPageTitle(url)
		status.textContent = ''
		status.className = 'bqa-status'

		// Only set if user hasn't typed something manually since we started
		if (!titleInput.dataset.manual) {
			titleInput.value = title
		}
	}

	function openModal() {
		const overlay = document.getElementById('bqa-overlay')
		const urlInput = document.getElementById('bqa-url')
		const titleInput = document.getElementById('bqa-title')
		const status = document.getElementById('bqa-status')
		const submitBtn = document.getElementById('bqa-submit')

		// Reset state
		urlInput.value = ''
		titleInput.value = ''
		titleInput.dataset.manual = ''
		status.textContent = ''
		submitBtn.disabled = true

		overlay.classList.add('open')
		// Delay focus slightly for transition
		setTimeout(() => urlInput.focus(), 100)
	}

	function closeModal() {
		document.getElementById('bqa-overlay').classList.remove('open')
	}

	async function handleSubmit() {
		const urlInput = document.getElementById('bqa-url')
		const titleInput = document.getElementById('bqa-title')
		const submitBtn = document.getElementById('bqa-submit')

		const url = urlInput.value.trim()
		if (url.length < 3) return

		let title = titleInput.value.trim()
		if (!title) {
			title = await fetchPageTitle(url)
			titleInput.value = title
		}

		submitBtn.disabled = true
		submitBtn.textContent = 'Adding...'

		try {
			await addLinkToBonjourr(normalizeUrl(url), title)
			closeModal()
			showNotification(`Added: ${title}`)
		} catch (err) {
			logError('Failed to add link:', err)
			showNotification('Failed to add link', true)
		} finally {
			submitBtn.disabled = false
			submitBtn.textContent = 'Add'
		}
	}

	function showNotification(message, isError = false) {
		const notif = document.getElementById('bqa-notification')
		notif.textContent = message
		notif.className = 'show' + (isError ? ' error' : '')
		// Force id back since className override removes it visually
		notif.id = 'bqa-notification'
		notif.classList.add('show')
		if (isError) notif.classList.add('error')

		setTimeout(() => {
			notif.classList.remove('show', 'error')
		}, 3000)
	}

	// --- Keyboard Shortcut ---

	function setupKeyboardShortcut() {
		document.addEventListener('keydown', (e) => {
			// Alt+A to open quick add
			if (e.altKey && e.key === 'a') {
				e.preventDefault()
				const overlay = document.getElementById('bqa-overlay')
				if (overlay.classList.contains('open')) {
					closeModal()
				} else {
					openModal()
				}
			}

			// Escape to close modal
			if (e.key === 'Escape') {
				const overlay = document.getElementById('bqa-overlay')
				if (overlay.classList.contains('open')) {
					e.stopPropagation()
					closeModal()
				}
			}
		}, true) // capture phase so we get Escape before Bonjourr
	}

	// --- Init ---

	function init() {
		// Wait for Bonjourr to finish loading
		if (!document.getElementById('linkblocks')) {
			log('Waiting for Bonjourr to initialize...')
			const observer = new MutationObserver((_mutations, obs) => {
				if (document.getElementById('linkblocks')) {
					obs.disconnect()
					bootstrap()
				}
			})
			observer.observe(document.body, { childList: true, subtree: true })
			// Timeout fallback
			setTimeout(() => {
				observer.disconnect()
				bootstrap()
			}, 5000)
			return
		}

		bootstrap()
	}

	function bootstrap() {
		log('Initializing')
		injectStyles()
		createFab()
		createOverlay()
		createNotification()
		setupKeyboardShortcut()
		log('Ready - click + button or press Alt+A')
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init)
	} else {
		init()
	}
})()
