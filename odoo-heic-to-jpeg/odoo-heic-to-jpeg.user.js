// ==UserScript==
// @name         Odoo HEIC to JPEG
// @namespace    odoo-heic-to-jpeg
// @version      1.4.0
// @description  Converts HEIC/HEIF images to JPEG client-side before Odoo uploads them
// @match        *://*.odoo.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS (userscript scope)
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Odoo HEIC→JPEG]'
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'

	// ═══════════════════════════════════════════════════════════════════
	//  LOGGING (userscript scope)
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

	const UPDATE_BANNER_ID = 'odoo-heic-to-jpeg-update-banner'
	const UPDATE_DISMISS_KEY = 'odoo_heic_to_jpeg_update_dismissed_v'

	// Tampermonkey exposes the script's own metadata block, so these URLs
	// don't have to be hand-maintained in two places. Greasemonkey 4 does
	// not expose them, hence the literal fallbacks.
	const META_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js'
	const DOWNLOAD_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js'

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
	//  PAGE-CONTEXT INJECTION
	// ═══════════════════════════════════════════════════════════════════
	//
	//  All FileReader / fetch / XHR patches must run in the page's native
	//  JS context to avoid Tampermonkey sandbox cross-context issues
	//  (instanceof checks, FormData iteration, prototype access).
	//
	//  We inject an inline <script> that:
	//    1. Loads heic2any via a dynamic <script src> tag
	//    2. Patches FileReader, fetch, and XHR synchronously
	//    3. Defers actual conversion until heic2any finishes loading
	//

	const pageScript = document.createElement('script')
	pageScript.textContent = '(' + function () {
		var LOG = '[Odoo HEIC→JPEG]'
		var JPEG_QUALITY = 0.92
		var HEIC_MIME_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']
		var HEIC_EXTENSIONS = ['.heic', '.heif']

		// ── Load heic2any into page context ────────────────────────────
		var heic2anyReady = new Promise(function (resolve, reject) {
			var s = document.createElement('script')
			s.src = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js'
			s.onload = function () {
				console.log(LOG, 'heic2any library loaded')
				resolve(window.heic2any)
			}
			s.onerror = function () {
				console.error(LOG, 'Failed to load heic2any library')
				reject(new Error('heic2any load failed'))
			}
			document.documentElement.appendChild(s)
		})

		// ── Detection ──────────────────────────────────────────────────
		function isHeic(blob) {
			if (!blob) return false
			var type = (blob.type || '').toLowerCase()
			if (HEIC_MIME_TYPES.indexOf(type) !== -1) return true
			if (blob.name) {
				var name = blob.name.toLowerCase()
				for (var i = 0; i < HEIC_EXTENSIONS.length; i++) {
					if (name.lastIndexOf(HEIC_EXTENSIONS[i]) === name.length - HEIC_EXTENSIONS[i].length) return true
				}
			}
			return false
		}

		// ── Conversion ─────────────────────────────────────────────────
		//  converting flag guards against re-entrancy: heic2any uses
		//  FileReader internally, which would trigger our FileReader patch
		//  and create an infinite loop without this guard.
		var converting = false

		function convertBlob(blob) {
			converting = true
			return heic2anyReady.then(function (heic2any) {
				var name = blob.name || 'image.heic'
				console.log(LOG, 'Converting ' + name + ' (' + (blob.size / 1024).toFixed(1) + ' KB)')

				return heic2any({
					blob: blob,
					toType: 'image/jpeg',
					quality: JPEG_QUALITY,
				}).then(function (result) {
					converting = false
					var outputBlob = Array.isArray(result) ? result[0] : result
					var newName = name.replace(/\.hei[cf]$/i, '.jpg')
					var converted = new File([outputBlob], newName, {
						type: 'image/jpeg',
						lastModified: blob.lastModified || Date.now(),
					})
					console.log(LOG, 'Done → ' + converted.name + ' (' + (converted.size / 1024).toFixed(1) + ' KB)')
					return converted
				}).catch(function (err) {
					converting = false
					// heic2any code 1 = "already browser readable" — pass through
					if (err && err.code === 1) {
						console.log(LOG, 'File already browser-readable, skipping conversion')
						return blob
					}
					throw err
				})
			})
		}

		// ── Toast ──────────────────────────────────────────────────────
		function showToast(message) {
			if (!document.body) return
			var el = document.createElement('div')
			el.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#714B67;color:#fff;' +
				'padding:12px 20px;border-radius:8px;font-size:14px;font-family:sans-serif;' +
				'z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.25);transition:opacity 0.4s;opacity:1;'
			el.textContent = message
			document.body.appendChild(el)
			setTimeout(function () {
				el.style.opacity = '0'
				setTimeout(function () { el.remove() }, 500)
			}, 3000)
		}

		// ── Patch FileReader ───────────────────────────────────────────
		function patchReader(methodName) {
			var original = FileReader.prototype[methodName]
			if (!original) return
			FileReader.prototype[methodName] = function (blob) {
				if (!converting && isHeic(blob)) {
					var self = this
					convertBlob(blob).then(function (jpeg) {
						showToast('Converted HEIC image to JPEG')
						original.call(self, jpeg)
					}).catch(function (err) {
						console.error(LOG, 'Conversion failed, passing through original:', err)
						original.call(self, blob)
					})
					return
				}
				return original.call(this, blob)
			}
		}

		patchReader('readAsDataURL')
		patchReader('readAsArrayBuffer')
		patchReader('readAsBinaryString')

		// ── Patch fetch ────────────────────────────────────────────────
		var originalFetch = window.fetch
		window.fetch = function () {
			var args = arguments
			var config = args[1]
			if (config && config.body instanceof FormData) {
				return convertFormData(config.body).then(function () {
					return originalFetch.apply(this, args)
				}.bind(this))
			}
			return originalFetch.apply(this, args)
		}

		// ── Patch XMLHttpRequest.send ──────────────────────────────────
		var originalXHRSend = XMLHttpRequest.prototype.send
		XMLHttpRequest.prototype.send = function (data) {
			if (data instanceof FormData) {
				var self = this
				convertFormData(data).then(function () {
					originalXHRSend.call(self, data)
				})
				return
			}
			return originalXHRSend.call(this, data)
		}

		// ── FormData HEIC scan ─────────────────────────────────────────
		function convertFormData(formData) {
			var entries = []
			var iter = formData.entries()
			var next = iter.next()
			while (!next.done) {
				entries.push(next.value)
				next = iter.next()
			}

			var conversions = []
			for (var i = 0; i < entries.length; i++) {
				var key = entries[i][0]
				var value = entries[i][1]
				if (value instanceof Blob && isHeic(value)) {
					conversions.push({ key: key, blob: value })
				}
			}

			if (conversions.length === 0) return Promise.resolve()

			var promises = conversions.map(function (item) {
				return convertBlob(item.blob).then(function (jpeg) {
					formData.delete(item.key)
					formData.append(item.key, jpeg, jpeg.name)
				}).catch(function (err) {
					console.error(LOG, 'FormData conversion failed for', item.blob.name, err)
				})
			})

			return Promise.all(promises).then(function () {
				showToast('Converted ' + conversions.length + ' HEIC image' + (conversions.length > 1 ? 's' : '') + ' to JPEG')
			})
		}

		console.log(LOG, 'Initialized — patched FileReader, fetch, and XMLHttpRequest')
	} + ')()'

	;(document.head || document.documentElement).appendChild(pageScript)
	pageScript.remove()

	// ═══════════════════════════════════════════════════════════════════
	//  INIT (userscript scope)
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	log('Userscript loaded')
})()
