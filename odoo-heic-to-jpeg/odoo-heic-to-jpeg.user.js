// ==UserScript==
// @name         Odoo HEIC to JPEG
// @namespace    odoo-heic-to-jpeg
// @version      1.1.0
// @description  Converts HEIC/HEIF images to JPEG client-side before Odoo uploads them
// @match        *://*.odoo.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Odoo HEIC→JPEG]'
	const SCRIPT_VERSION = '1.1.0'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js'
	const UPDATE_BANNER_ID = 'oheic-update-banner'
	const JPEG_QUALITY = 0.92
	const HEIC_EXTENSIONS = ['.heic', '.heif']
	const HEIC_MIME_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

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

	// ═══════════════════════════════════════════════════════════════════
	//  HEIC DETECTION
	// ═══════════════════════════════════════════════════════════════════

	function isHeicBlob(blob) {
		if (!blob || !blob.type) return false
		if (HEIC_MIME_TYPES.includes(blob.type.toLowerCase())) return true
		if (blob.name) {
			const name = blob.name.toLowerCase()
			return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext))
		}
		return false
	}

	// ═══════════════════════════════════════════════════════════════════
	//  CONVERSION
	// ═══════════════════════════════════════════════════════════════════

	async function convertHeicToJpeg(blob) {
		const name = blob.name || 'image.heic'
		log(`Converting ${name} (${(blob.size / 1024).toFixed(1)} KB)`)

		const result = await heic2any({
			blob: blob,
			toType: 'image/jpeg',
			quality: JPEG_QUALITY,
		})

		// heic2any may return an array for multi-image HEIC; take the first
		const outputBlob = Array.isArray(result) ? result[0] : result

		const newName = name.replace(/\.hei[cf]$/i, '.jpg')
		const converted = new File([outputBlob], newName, {
			type: 'image/jpeg',
			lastModified: blob.lastModified || Date.now(),
		})

		log(`Done → ${converted.name} (${(converted.size / 1024).toFixed(1)} KB)`)
		return converted
	}

	async function convertOrPassthrough(blob) {
		if (!isHeicBlob(blob)) return blob
		try {
			return await convertHeicToJpeg(blob)
		} catch (err) {
			warn(`Conversion failed for ${blob.name || 'blob'}, passing through original:`, err)
			return blob
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TOAST
	// ═══════════════════════════════════════════════════════════════════

	function showToast(message) {
		if (!document.body) return
		const el = document.createElement('div')
		Object.assign(el.style, {
			position: 'fixed',
			bottom: '24px',
			right: '24px',
			background: '#714B67',
			color: '#fff',
			padding: '12px 20px',
			borderRadius: '8px',
			fontSize: '14px',
			fontFamily: 'sans-serif',
			zIndex: '999999',
			boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
			transition: 'opacity 0.4s',
			opacity: '1',
		})
		el.textContent = message
		document.body.appendChild(el)
		setTimeout(() => {
			el.style.opacity = '0'
			setTimeout(() => el.remove(), 500)
		}, 3000)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  FILEREADER PATCH
	// ═══════════════════════════════════════════════════════════════════
	//
	//  Odoo reads uploaded files via FileReader (readAsDataURL for base64
	//  encoding, readAsArrayBuffer for binary). We intercept these calls
	//  and convert HEIC blobs to JPEG before the original read executes.
	//  This is async-safe because FileReader is inherently asynchronous.
	//

	const pageWindow = unsafeWindow
	const OrigFileReader = pageWindow.FileReader

	function patchFileReaderMethod(methodName) {
		const original = OrigFileReader.prototype[methodName]
		OrigFileReader.prototype[methodName] = function (blob) {
			if (isHeicBlob(blob)) {
				convertOrPassthrough(blob).then((converted) => {
					if (converted !== blob) {
						showToast('Converted HEIC image to JPEG')
					}
					original.call(this, converted)
				})
				return
			}
			return original.call(this, blob)
		}
	}

	patchFileReaderMethod('readAsDataURL')
	patchFileReaderMethod('readAsArrayBuffer')
	patchFileReaderMethod('readAsBinaryString')

	// ═══════════════════════════════════════════════════════════════════
	//  FETCH / XHR PATCH
	// ═══════════════════════════════════════════════════════════════════
	//
	//  Belt-and-suspenders: also intercept network requests that send
	//  FormData containing HEIC files. This covers upload paths that
	//  append File objects directly to FormData without reading first.
	//

	async function convertFormDataHeicFiles(formData) {
		const entries = []
		for (const pair of formData.entries()) {
			entries.push(pair)
		}

		let converted = 0
		for (const [key, value] of entries) {
			if (value instanceof Blob && isHeicBlob(value)) {
				const jpeg = await convertOrPassthrough(value)
				if (jpeg !== value) {
					formData.delete(key)
					formData.append(key, jpeg, jpeg.name)
					converted++
				}
			}
		}

		if (converted > 0) {
			showToast(`Converted ${converted} HEIC image${converted > 1 ? 's' : ''} to JPEG`)
		}
	}

	// Patch fetch
	const originalFetch = pageWindow.fetch
	pageWindow.fetch = function (...args) {
		const [resource, config] = args
		if (config && config.body instanceof pageWindow.FormData) {
			return convertFormDataHeicFiles(config.body).then(() =>
				originalFetch.apply(this, args),
			)
		}
		return originalFetch.apply(this, args)
	}

	// Patch XMLHttpRequest.send
	const originalXHRSend = pageWindow.XMLHttpRequest.prototype.send
	pageWindow.XMLHttpRequest.prototype.send = function (data) {
		if (data instanceof pageWindow.FormData) {
			convertFormDataHeicFiles(data).then(() => {
				originalXHRSend.call(this, data)
			})
			return
		}
		return originalXHRSend.call(this, data)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	log('Initialized — patched FileReader, fetch, and XMLHttpRequest')
})()
