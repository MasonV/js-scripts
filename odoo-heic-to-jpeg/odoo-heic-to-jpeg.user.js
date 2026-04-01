// ==UserScript==
// @name         Odoo HEIC to JPEG
// @namespace    odoo-heic-to-jpeg
// @version      1.2.0
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
	const SCRIPT_VERSION = '1.2.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js'
	const UPDATE_BANNER_ID = 'oheic-update-banner'

	// ═══════════════════════════════════════════════════════════════════
	//  LOGGING (userscript scope)
	// ═══════════════════════════════════════════════════════════════════

	function log(msg, ...args) {
		console.log(`${LOG_PREFIX} ${msg}`, ...args)
	}

	function warn(msg, ...args) {
		console.warn(`${LOG_PREFIX} ${msg}`, ...args)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UPDATE CHECK (userscript scope — needs GM_xmlhttpRequest)
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
		function inject() {
			const banner = document.createElement('div')
			banner.id = UPDATE_BANNER_ID
			Object.assign(banner.style, {
				position: 'fixed',
				top: '0',
				left: '0',
				right: '0',
				zIndex: '10000',
				padding: '8px 16px',
				background: '#714B67',
				color: 'white',
				textAlign: 'center',
				fontFamily: 'sans-serif',
				fontSize: '13px',
				cursor: 'pointer',
			})
			banner.textContent = `Odoo HEIC→JPEG v${remote} available (current: v${SCRIPT_VERSION}) — click to update`
			banner.addEventListener('click', () => {
				window.open(DOWNLOAD_URL, '_blank')
			})
			document.body.prepend(banner)
		}
		if (document.body) inject()
		else document.addEventListener('DOMContentLoaded', inject)
	}

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
			if (blob.type && HEIC_MIME_TYPES.indexOf(blob.type.toLowerCase()) !== -1) return true
			if (blob.name) {
				var name = blob.name.toLowerCase()
				for (var i = 0; i < HEIC_EXTENSIONS.length; i++) {
					if (name.lastIndexOf(HEIC_EXTENSIONS[i]) === name.length - HEIC_EXTENSIONS[i].length) return true
				}
			}
			return false
		}

		// ── Conversion ─────────────────────────────────────────────────
		function convertBlob(blob) {
			return heic2anyReady.then(function (heic2any) {
				var name = blob.name || 'image.heic'
				console.log(LOG, 'Converting ' + name + ' (' + (blob.size / 1024).toFixed(1) + ' KB)')

				return heic2any({
					blob: blob,
					toType: 'image/jpeg',
					quality: JPEG_QUALITY,
				}).then(function (result) {
					var outputBlob = Array.isArray(result) ? result[0] : result
					var newName = name.replace(/\.hei[cf]$/i, '.jpg')
					var converted = new File([outputBlob], newName, {
						type: 'image/jpeg',
						lastModified: blob.lastModified || Date.now(),
					})
					console.log(LOG, 'Done → ' + converted.name + ' (' + (converted.size / 1024).toFixed(1) + ' KB)')
					return converted
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
				if (isHeic(blob)) {
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
