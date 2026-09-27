// ═══════════════════════════════════════════════════════════════════
//  STEAM REDEEM
//  Generated from tools/blocks/steam-redeem.template.js — do not edit here.
//  Change the template, then run: node tools/sync-blocks.mjs
// ═══════════════════════════════════════════════════════════════════
//
// Steam has no web redeem page a script can drive, so a key is handed to
// the Steam client through a steam://registerkey/ URL.

// Groups of five letters/digits separated by dashes: XXXXX-XXXXX-XXXXX
const STEAM_KEY_RE = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/

function steamRedeemUrl(key) {
	return `steam://registerkey/${key}`
}

/**
 * Steam keys shown on the page, each with the element it was found in.
 * Keys are often in readonly inputs, else in short text elements.
 */
function findSteamKeys() {
	const keys = []

	document.querySelectorAll('input[type="text"], input:not([type])').forEach(input => {
		const match = input.value.match(STEAM_KEY_RE)
		if (match) keys.push({ key: match[0], element: input })
	})

	document.querySelectorAll('div, span, p').forEach(el => {
		// Only leaf-ish elements, so a key isn't reported once per ancestor.
		if (el.children.length > 3) return
		const text = el.textContent.trim()
		const match = text.match(STEAM_KEY_RE)
		if (match && text.length < 30 && !keys.some(k => k.key === match[0])) {
			keys.push({ key: match[0], element: el })
		}
	})

	return keys
}
