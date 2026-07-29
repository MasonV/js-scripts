// ═══════════════════════════════════════════════════════════════════
//  UPDATE CHECK
//  Generated from tools/update-check.template.js — do not edit here.
//  Change the template, then run: node tools/sync-update-check.mjs
// ═══════════════════════════════════════════════════════════════════

const UPDATE_BANNER_ID = '{{SLUG}}-update-banner'
const UPDATE_DISMISS_KEY = '{{STORAGE_PREFIX}}_update_dismissed_v'

// Tampermonkey exposes the script's own metadata block, so these URLs
// don't have to be hand-maintained in two places. Greasemonkey 4 does
// not expose them, hence the literal fallbacks.
const META_URL =
	(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
	'https://raw.githubusercontent.com/MasonV/js-scripts/main/{{SLUG}}/{{SLUG}}.meta.js'
const DOWNLOAD_URL =
	(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
	'https://raw.githubusercontent.com/MasonV/js-scripts/main/{{SLUG}}/{{SLUG}}.user.js'

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
