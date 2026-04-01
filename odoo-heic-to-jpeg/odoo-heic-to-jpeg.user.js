// ==UserScript==
// @name         Odoo HEIC to JPEG
// @namespace    odoo-heic-to-jpeg
// @version      1.0.0
// @description  Converts HEIC/HEIF images to JPEG client-side before Odoo uploads them
// @match        *://*.odoo.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Odoo HEIC→JPEG]'
	const SCRIPT_VERSION = '1.0.0'
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
	//  CONVERSION
	// ═══════════════════════════════════════════════════════════════════

	function isHeicFile(file) {
		if (HEIC_MIME_TYPES.includes(file.type.toLowerCase())) return true
		const name = file.name.toLowerCase()
		return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext))
	}

	async function convertHeicToJpeg(file) {
		log(`Converting ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)

		const blob = await heic2any({
			blob: file,
			toType: 'image/jpeg',
			quality: JPEG_QUALITY,
		})

		// heic2any may return an array for multi-image HEIC; take the first
		const outputBlob = Array.isArray(blob) ? blob[0] : blob

		const newName = file.name.replace(/\.hei[cf]$/i, '.jpg')
		const converted = new File([outputBlob], newName, {
			type: 'image/jpeg',
			lastModified: file.lastModified || Date.now(),
		})

		log(`Done → ${converted.name} (${(converted.size / 1024).toFixed(1)} KB)`)
		return converted
	}

	async function processFileList(fileList) {
		const files = Array.from(fileList)
		const processed = await Promise.all(
			files.map(async (file) => {
				if (!isHeicFile(file)) return file
				try {
					return await convertHeicToJpeg(file)
				} catch (err) {
					console.error(`${LOG_PREFIX} Conversion failed for ${file.name}:`, err)
					return file
				}
			}),
		)
		return processed
	}

	function toFileList(filesArray) {
		const dt = new DataTransfer()
		filesArray.forEach((f) => dt.items.add(f))
		return dt.files
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TOAST
	// ═══════════════════════════════════════════════════════════════════

	function showToast(message) {
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
	//  FILE INPUT INTERCEPTION
	// ═══════════════════════════════════════════════════════════════════

	let processing = false

	document.addEventListener(
		'change',
		async (event) => {
			if (processing) return

			const input = event.target
			if (!(input instanceof HTMLInputElement) || input.type !== 'file') return
			if (!input.files || input.files.length === 0) return

			const hasHeic = Array.from(input.files).some(isHeicFile)
			if (!hasHeic) return

			event.stopImmediatePropagation()

			const count = Array.from(input.files).filter(isHeicFile).length
			log(`Intercepted upload with ${count} HEIC file(s)`)

			try {
				const files = await processFileList(input.files)

				processing = true
				input.files = toFileList(files)
				processing = false

				input.dispatchEvent(new Event('change', { bubbles: true }))
				showToast(`Converted ${count} HEIC image${count > 1 ? 's' : ''} to JPEG`)
			} catch (err) {
				processing = false
				console.error(`${LOG_PREFIX} Fatal error during conversion:`, err)
				input.dispatchEvent(new Event('change', { bubbles: true }))
			}
		},
		true,
	)

	// ═══════════════════════════════════════════════════════════════════
	//  DRAG-AND-DROP
	// ═══════════════════════════════════════════════════════════════════

	document.addEventListener(
		'drop',
		async (event) => {
			if (processing) return
			if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length === 0) return

			const hasHeic = Array.from(event.dataTransfer.files).some(isHeicFile)
			if (!hasHeic) return

			event.stopImmediatePropagation()
			event.preventDefault()

			const count = Array.from(event.dataTransfer.files).filter(isHeicFile).length
			log(`Intercepted drop with ${count} HEIC file(s)`)

			try {
				const files = await processFileList(event.dataTransfer.files)

				const dt = new DataTransfer()
				files.forEach((f) => dt.items.add(f))

				const syntheticDrop = new DragEvent('drop', {
					bubbles: true,
					cancelable: true,
					dataTransfer: dt,
				})

				processing = true
				event.target.dispatchEvent(syntheticDrop)
				processing = false

				showToast(`Converted ${count} HEIC image${count > 1 ? 's' : ''} to JPEG`)
			} catch (err) {
				processing = false
				console.error(`${LOG_PREFIX} Fatal error during drop conversion:`, err)
			}
		},
		true,
	)

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	log('Initialized')
})()
