// ═══════════════════════════════════════════════════════════════════
//  GOG REDEEM
//  Generated from tools/blocks/gog-redeem.template.js — do not edit here.
//  Change the template, then run: node tools/sync-blocks.mjs
// ═══════════════════════════════════════════════════════════════════
//
// Two halves, one script on two sites:
//   store side  sendToGogRedeem(url, game) records the key in GM storage
//               and navigates this tab to https://www.gog.com/redeem/<key>.
//   gog.com     runGogRedemption() acts only on a key the store side sent
//               in the last few minutes: Continue, then Redeem.
//
// localStorage/sessionStorage don't reach gog.com, so the handoff lives in
// GM storage (shared by the script on every site it matches). The key
// travels in the redeem URL; the GM entry is what gives the gog.com side
// permission to act on it, and records the Redeem click so it can never
// happen twice. One entry per key so parallel tabs don't clobber.
//
// gog.com pages: Page 1 "Redeem code" — key prefilled, green Continue.
// Page 2 "You are about to redeem 1 item …" — Cancel / Redeem. Buttons are
// found by visible text, never by GOG's generated classes. Any surprise
// stops the run.
//
// Expects KEY_PREFIX (e.g. 'lac'), log(), warn(), checkForUpdate() and the
// autoclaim-kit block. Needs @match https://www.gog.com/* and @grant
// GM_getValue, GM_setValue, GM_deleteValue.

const GOG_REDEEM_URL_RE =
	/^https:\/\/(?:www\.)?gog\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?redeem\/([A-Za-z0-9-]+)\/?(?:[?#].*)?$/
const GOG_REDEEM_PATH_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?redeem\/([A-Za-z0-9-]+)\/?$/

const GOG_PENDING_PREFIX = `${KEY_PREFIX}_gog_pending_v1:`
const GOG_PENDING_TTL_MS = 10 * 60 * 1000
const GOG_AUTO_REDEEM_KEY = `${KEY_PREFIX}_gog_auto_redeem_v1` // default false: stop before Redeem
const GOG_STEP_TIMEOUT_MS = 20000

function isGogHost() {
	return /(^|\.)gog\.com$/.test(window.location.hostname)
}

function isGogAutoRedeem() {
	return GM_getValue(GOG_AUTO_REDEEM_KEY, false) === true
}

function setGogAutoRedeem(on) {
	GM_setValue(GOG_AUTO_REDEEM_KEY, on)
}

// ── Store side ──────────────────────────────────────────────────────

// `url` must match GOG_REDEEM_URL_RE. `game` is shown on the gog.com panel.
function sendToGogRedeem(url, game) {
	const key = url.match(GOG_REDEEM_URL_RE)[1]
	GM_setValue(GOG_PENDING_PREFIX + key.toUpperCase(), {
		createdAt: Date.now(),
		game: game || null,
		stage: 'handoff',
	})
	log(`GOG: handing off key ${maskKey(key)} to gog.com`)
	updateStatus(`GOG: opening redeem page for ${maskKey(key)}…`)
	window.location.assign(url)
}

// ── gog.com side ────────────────────────────────────────────────────

// A prefilled input that holds a *different* key means we're on the wrong
// code — stop. An empty or missing input is left to GOG.
function prefilledKeyMismatch(key) {
	const values = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
		.filter(isVisible)
		.map(i => normalizeKey(i.value))
		.filter(Boolean)
	return values.length > 0 && !values.includes(normalizeKey(key))
}

function createGogPanel(entry) {
	const panel = buildPanelShell('Autoclaim · GOG')

	const gameEl = document.createElement('div')
	gameEl.id = `${UI_PREFIX}-store`
	gameEl.textContent = entry.game ? `${entry.game}` : 'GOG key'
	panel.appendChild(gameEl)

	createStatusLine(panel)
	document.body.appendChild(panel)
	return panel
}

function stopGog(message) {
	warn(`GOG: ${message}`)
	updateStatus(`${message} — stopped`, 'error')
}

// Redeem is exactly-once: the GM entry is stamped "redeem-clicked" *before*
// the click, and a stamped entry is never clicked again — not after a
// reload, not from a second tab.
async function runGogRedemption() {
	const match = window.location.pathname.match(GOG_REDEEM_PATH_RE)
	if (!match) return
	const key = match[1]
	const entryKey = GOG_PENDING_PREFIX + key.toUpperCase()
	const entry = GM_getValue(entryKey, null)
	if (!entry) return // not a code we handed over — leave the page alone

	if (Date.now() - entry.createdAt > GOG_PENDING_TTL_MS) {
		log(`GOG: handoff for ${maskKey(key)} is stale — ignoring`)
		GM_deleteValue(entryKey)
		return
	}

	checkForUpdate()
	injectPanelStyles()
	const panel = createGogPanel(entry)

	if (entry.stage === 'redeem-clicked') {
		stopGog("Redeem was already clicked for this code — not clicking again. Check GOG's result")
		return
	}

	// ── Page 1: Continue ─────────────────────────────────────────────
	updateStatus('Waiting for Continue…')
	const continueBtn = await waitFor(() => findOnlyButton('Continue'), GOG_STEP_TIMEOUT_MS)
	if (!continueBtn) {
		stopGog('Continue button not found (signed in to GOG?)')
		return
	}
	if (prefilledKeyMismatch(key)) {
		stopGog("The code on the page doesn't match the one handed over")
		return
	}
	log(`GOG: clicking Continue for ${maskKey(key)}`)
	GM_setValue(entryKey, { ...entry, stage: 'continue-clicked' })
	continueBtn.click()

	// ── Page 2: wait for the transition, then Redeem ────────────────
	updateStatus('Waiting for the confirmation page…')
	const redeemBtn = await waitFor(() => {
		if (findVisibleButtonsByText('Continue').length) return null // still on page 1
		if (!/you are about to redeem/i.test(document.body.innerText)) return null
		return findOnlyButton('Redeem')
	}, GOG_STEP_TIMEOUT_MS)
	if (!redeemBtn) {
		stopGog("Confirmation page with a single Redeem button didn't appear")
		return
	}

	let confirmBtn = null
	let redeemStarted = false
	const redeemOnce = async () => {
		if (redeemStarted) return
		redeemStarted = true
		confirmBtn?.remove()

		// Re-read: another tab or an earlier run may have got here first.
		const latest = GM_getValue(entryKey, null)
		if (!latest || latest.stage === 'redeem-clicked') {
			stopGog("This code's Redeem was already handled elsewhere")
			return
		}
		if (!redeemBtn.isConnected || !isVisible(redeemBtn) || !isEnabled(redeemBtn)) {
			stopGog('The Redeem button went away before it could be clicked')
			return
		}

		GM_setValue(entryKey, { ...latest, stage: 'redeem-clicked', redeemedAt: Date.now() })
		log(`GOG: clicking Redeem for ${maskKey(key)}`)
		redeemBtn.click()
		updateStatus('Redeem clicked — waiting for GOG…')

		const gone = await waitFor(() => !redeemBtn.isConnected || !isVisible(redeemBtn), GOG_STEP_TIMEOUT_MS)
		if (gone) {
			GM_deleteValue(entryKey)
			log(`GOG: Redeem accepted for ${maskKey(key)}`)
			updateStatus("Redeem sent — GOG's result is on the page", 'ok')
		} else {
			// The entry stays stamped, so nothing will ever click Redeem again.
			stopGog("GOG didn't move on after Redeem. Check the page before trying by hand")
		}
	}

	if (isGogAutoRedeem()) {
		await redeemOnce()
		return
	}

	updateStatus('Ready to redeem — confirm below')
	confirmBtn = document.createElement('button')
	confirmBtn.className = `${UI_PREFIX}-btn ${UI_PREFIX}-btn-primary`
	confirmBtn.textContent = '✔ Redeem on GOG'
	confirmBtn.addEventListener('click', redeemOnce)
	panel.appendChild(confirmBtn)
}
