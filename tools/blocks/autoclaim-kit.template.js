// ═══════════════════════════════════════════════════════════════════
//  AUTOCLAIM KIT — shared helpers and panel UI
//  Generated from tools/blocks/autoclaim-kit.template.js — do not edit here.
//  Change the template, then run: node tools/sync-blocks.mjs
// ═══════════════════════════════════════════════════════════════════
//
// Expects UI_PREFIX (e.g. 'lac') in the enclosing scope: every id and class
// the panel uses is `${UI_PREFIX}-…`, so two autoclaim scripts on one page
// never collide. Needs @grant GM_addStyle.

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Poll `probe` until it returns something truthy or `timeoutMs` elapses.
 * Resolves with the probe's value, or null on timeout.
 */
async function waitFor(probe, timeoutMs, intervalMs = 250) {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const value = probe()
		if (value) return value
		if (Date.now() >= deadline) return null
		await sleep(intervalMs)
	}
}

function isVisible(el) {
	return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
}

function isEnabled(el) {
	return !el.disabled && el.getAttribute('aria-disabled') !== 'true'
}

// Visible buttons/links whose text is exactly `text` (case-insensitive),
// ignoring our own panel.
function findVisibleButtonsByText(text) {
	const want = text.toLowerCase()
	return Array.from(
		document.querySelectorAll('button, a, [role="button"], input[type="submit"]'),
	).filter(
		el =>
			!el.closest(`#${UI_PREFIX}-panel`) &&
			(el.value || el.textContent).trim().toLowerCase() === want &&
			isVisible(el),
	)
}

// The single visible, enabled button with this text — or null, so an
// ambiguous page is never guessed at.
function findOnlyButton(text) {
	const matches = findVisibleButtonsByText(text).filter(isEnabled)
	return matches.length === 1 ? matches[0] : null
}

function normalizeKey(key) {
	return key.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

// Keys end up in the console and the status line — show only enough to
// tell two apart.
function maskKey(key) {
	return key.length > 5 ? `${key.slice(0, 5)}…` : key
}

// ── Panel ───────────────────────────────────────────────────────────

let statusEl = null
let panelStylesInjected = false

// Floating panel with a title and a close button. The caller appends its
// own controls, then the panel to document.body.
function buildPanelShell(titleText) {
	const panel = document.createElement('div')
	panel.id = `${UI_PREFIX}-panel`

	const header = document.createElement('div')
	header.id = `${UI_PREFIX}-header`

	const title = document.createElement('div')
	title.id = `${UI_PREFIX}-title`
	title.textContent = titleText
	header.appendChild(title)

	const closeBtn = document.createElement('button')
	closeBtn.id = `${UI_PREFIX}-close-btn`
	closeBtn.textContent = '×'
	closeBtn.title = 'Close panel'
	closeBtn.addEventListener('click', () => panel.remove())
	header.appendChild(closeBtn)

	panel.appendChild(header)
	return panel
}

// The one status line updateStatus() writes to.
function createStatusLine(panel, text = '') {
	statusEl = document.createElement('div')
	statusEl.id = `${UI_PREFIX}-status`
	statusEl.textContent = text
	panel.appendChild(statusEl)
	return statusEl
}

// tone: undefined (neutral) | 'ok' | 'error'
function updateStatus(text, tone) {
	if (!statusEl) return
	statusEl.textContent = text
	statusEl.classList.toggle(`${UI_PREFIX}-status--ok`, tone === 'ok')
	statusEl.classList.toggle(`${UI_PREFIX}-status--error`, tone === 'error')
}

function setControlsEnabled(controls, enabled) {
	controls.forEach(btn => {
		if (!btn) return
		btn.disabled = !enabled
		btn.style.opacity = enabled ? '1' : '0.5'
		btn.style.pointerEvents = enabled ? 'auto' : 'none'
	})
}

function createDelayInput(labelText, defaultValue, onChange) {
	const row = document.createElement('div')
	row.className = `${UI_PREFIX}-delay-row`

	const label = document.createElement('label')
	label.className = `${UI_PREFIX}-delay-label`
	label.textContent = labelText

	const input = document.createElement('input')
	input.type = 'number'
	input.className = `${UI_PREFIX}-delay-input`
	input.min = '100'
	input.max = '10000'
	input.step = '100'
	input.value = defaultValue
	input.addEventListener('change', () => {
		const val = parseInt(input.value, 10)
		if (!isNaN(val) && val >= 100) onChange(val)
	})

	const unit = document.createElement('span')
	unit.className = `${UI_PREFIX}-delay-unit`
	unit.textContent = 'ms'

	row.appendChild(label)
	row.appendChild(input)
	row.appendChild(unit)
	return row
}

function removePanel() {
	document.getElementById(`${UI_PREFIX}-panel`)?.remove()
	statusEl = null
}

// Base panel styles. Safe to call on every route — only the first call
// injects. Script-specific rules go in the script's own GM_addStyle.
function injectPanelStyles() {
	if (panelStylesInjected) return
	panelStylesInjected = true
	const p = UI_PREFIX
	GM_addStyle(`
		#${p}-panel {
			position: fixed;
			bottom: 20px;
			right: 20px;
			z-index: 10000;
			background: #2b2b2b;
			border: 1px solid #424242;
			border-radius: 8px;
			padding: 12px 16px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			min-width: 200px;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
			font-family: Lato, 'Open Sans', sans-serif;
			font-size: 14px;
			color: #eee;
		}

		#${p}-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
		}

		#${p}-title {
			font-weight: 700;
			font-size: 13px;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			color: #ff9800;
			flex: 1;
			text-align: center;
			padding-left: 20px;
		}

		#${p}-close-btn {
			background: none;
			border: none;
			color: #757575;
			font-size: 18px;
			cursor: pointer;
			padding: 0;
			line-height: 1;
			width: 20px;
			font-family: inherit;
		}

		#${p}-close-btn:hover { color: #eee; }

		/* One-line context under the title, e.g. "Store: GOG" */
		#${p}-store {
			font-size: 12px;
			color: #bdbdbd;
			text-align: center;
			padding: 2px 0;
		}

		.${p}-btn {
			background: #424242;
			color: #eee;
			border: 1px solid #616161;
			border-radius: 4px;
			padding: 8px 12px;
			font-size: 13px;
			font-weight: 400;
			cursor: pointer;
			transition: background 0.15s ease, opacity 0.15s ease;
			font-family: inherit;
		}

		.${p}-btn:hover { background: #616161; }

		.${p}-btn-primary {
			background: #ff9800;
			color: #212121;
			border-color: #ff9800;
			font-weight: 700;
		}

		.${p}-btn-primary:hover { background: #ffb74d; }

		.${p}-btn-danger {
			background: transparent;
			color: #ef5350;
			border-color: #ef5350;
			font-size: 11px;
			padding: 4px 8px;
		}

		.${p}-btn-danger:hover {
			background: #ef5350;
			color: #fff;
		}

		#${p}-delays {
			display: flex;
			flex-direction: column;
			gap: 4px;
			border-top: 1px solid #424242;
			padding-top: 8px;
			margin-top: 2px;
		}

		.${p}-delay-row {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.${p}-delay-label {
			font-size: 11px;
			color: #9e9e9e;
			flex: 1;
			margin: 0;
		}

		.${p}-delay-input {
			width: 60px;
			background: #333;
			color: #eee;
			border: 1px solid #616161;
			border-radius: 3px;
			padding: 2px 4px;
			font-size: 12px;
			font-family: inherit;
			text-align: right;
		}

		.${p}-delay-unit {
			font-size: 11px;
			color: #757575;
		}

		#${p}-status {
			font-size: 12px;
			color: #9e9e9e;
			text-align: center;
			min-height: 16px;
		}

		#${p}-status.${p}-status--ok { color: #81c784; }
		#${p}-status.${p}-status--error { color: #ef5350; font-weight: 700; }
	`)
}
