// ==UserScript==
// @name         Google Address Autocomplete — Canada Bias
// @namespace    google-address-autocomplete-ca
// @version      1.0.1
// @description  Restricts Google Places Autocomplete results to Canada on Odoo
// @match        https://*.odoo.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/google-address-autocomplete-ca/google-address-autocomplete-ca.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/google-address-autocomplete-ca/google-address-autocomplete-ca.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[Places CA]'
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'
	const META_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/google-address-autocomplete-ca/google-address-autocomplete-ca.meta.js'
	const DOWNLOAD_URL =
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/google-address-autocomplete-ca/google-address-autocomplete-ca.user.js'
	const UPDATE_BANNER_ID = 'places-ca-update-banner'

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
			banner.textContent = `Places CA v${remote} available (current: v${SCRIPT_VERSION}) — click to update`
			banner.addEventListener('click', () => {
				window.open(DOWNLOAD_URL, '_blank')
			})
			document.body.prepend(banner)
		}
		if (document.body) inject()
		else document.addEventListener('DOMContentLoaded', inject)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  GOOGLE PLACES PATCHING (page-context injection)
	// ═══════════════════════════════════════════════════════════════════

	const pageScript = document.createElement('script')
	pageScript.textContent = '(' + function () {
		var LOG = '[Places CA]'

		// ── Configuration ──────────────────────────────────────────────
		var COUNTRY_RESTRICTION = 'ca'
		var LOCATION_BIAS_LAT = 43.65
		var LOCATION_BIAS_LNG = -79.38
		var LOCATION_BIAS_RADIUS = 150000

		var POLL_INTERVAL = 250
		var POLL_MAX = 120

		// ── Helpers ────────────────────────────────────────────────────
		function ensureCountryRestriction(opts) {
			if (!opts) opts = {}
			if (!opts.componentRestrictions) {
				opts.componentRestrictions = { country: COUNTRY_RESTRICTION }
			}
			return opts
		}

		function ensureLocationBias(opts) {
			if (!opts) opts = {}
			if (!opts.locationBias) {
				opts.locationBias = {
					center: { lat: LOCATION_BIAS_LAT, lng: LOCATION_BIAS_LNG },
					radius: LOCATION_BIAS_RADIUS,
				}
			}
			return opts
		}

		// ── Polling ────────────────────────────────────────────────────
		var attempts = 0
		var timer = setInterval(function () {
			attempts++
			if (attempts > POLL_MAX) {
				clearInterval(timer)
				console.warn(LOG, 'google.maps.places not found after', POLL_MAX, 'attempts — giving up')
				return
			}

			if (
				typeof google === 'undefined' ||
				!google.maps ||
				!google.maps.places ||
				!google.maps.places.Autocomplete
			) {
				return
			}

			clearInterval(timer)

			// ── Patch Autocomplete constructor ─────────────────────────
			var OrigAutocomplete = google.maps.places.Autocomplete
			google.maps.places.Autocomplete = function (input, opts) {
				opts = ensureCountryRestriction(opts)
				return new OrigAutocomplete(input, opts)
			}
			google.maps.places.Autocomplete.prototype = OrigAutocomplete.prototype
			console.log(LOG, 'Patched Autocomplete constructor — country:', COUNTRY_RESTRICTION)

			// ── Patch AutocompleteService.getPlacePredictions ──────────
			if (google.maps.places.AutocompleteService) {
				var origGetPredictions =
					google.maps.places.AutocompleteService.prototype.getPlacePredictions

				google.maps.places.AutocompleteService.prototype.getPlacePredictions =
					function (request, callback) {
						request = ensureCountryRestriction(request)
						request = ensureLocationBias(request)
						return origGetPredictions.call(this, request, callback)
					}

				console.log(
					LOG,
					'Patched AutocompleteService.getPlacePredictions — country:',
					COUNTRY_RESTRICTION,
					'bias:', LOCATION_BIAS_LAT + ',' + LOCATION_BIAS_LNG,
					'radius:', LOCATION_BIAS_RADIUS + 'm'
				)
			}

			console.log(LOG, 'All patches applied successfully')
		}, POLL_INTERVAL)
	} + ')()'

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	checkForUpdate()
	document.documentElement.appendChild(pageScript)
	pageScript.remove()
	log('Page-context patch injected')
})()
