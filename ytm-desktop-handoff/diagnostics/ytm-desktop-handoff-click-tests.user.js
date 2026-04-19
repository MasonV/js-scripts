// ==UserScript==
// @name         YTM Desktop Handoff — Click Tests
// @namespace    ytm-desktop-handoff-test
// @version      1.0.0
// @description  Diagnostic: mounts 5 pill variants to isolate click/mount failures
// @match        *://music.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  HELPERS
	// ═══════════════════════════════════════════════════════════════════

	const log = (msg) => console.log(`[YTMDH Test] ${msg}`)

	function flash(el, ok) {
		el.style.background = ok ? '#1db954' : '#ff4e7a'
		setTimeout(() => (el.style.background = ''), 800)
	}

	function reportClick(label, el) {
		log(`CLICK: ${label}`)
		flash(el, true)
		alert(`[YTMDH Test] "${label}" clicked ✓\nCheck console for [YTMDH Test] logs.`)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  STYLES
	// ═══════════════════════════════════════════════════════════════════

	const styleEl = document.createElement('style')
	styleEl.textContent = `
		.ytmdh-test-pill {
			display: inline-flex !important;
			align-items: center !important;
			gap: 6px !important;
			padding: 0 14px !important;
			height: 32px !important;
			border: 1px solid rgba(255,255,255,0.3) !important;
			background: #222 !important;
			color: #fff !important;
			font-family: 'YouTube Sans', 'Roboto', sans-serif !important;
			font-size: 12px !important;
			font-weight: 600 !important;
			cursor: pointer !important;
			border-radius: 999px !important;
			user-select: none !important;
			pointer-events: all !important;
			position: relative !important;
			z-index: 2147483647 !important;
			transition: background 0.15s !important;
			-webkit-appearance: none !important;
			appearance: none !important;
			box-sizing: border-box !important;
			outline: none !important;
			text-decoration: none !important;
			vertical-align: middle !important;
		}
		.ytmdh-test-pill:hover { background: #444 !important; }

		/* Fixed column: stacked on the right side for tests not in av-toggle */
		#ytmdh-test-column {
			position: fixed;
			top: 80px;
			right: 16px;
			z-index: 2147483647;
			display: flex;
			flex-direction: column;
			gap: 8px;
			pointer-events: none;
		}
		#ytmdh-test-column .ytmdh-test-pill {
			pointer-events: all !important;
		}
	`
	document.head.appendChild(styleEl)

	// ═══════════════════════════════════════════════════════════════════
	//  PILL FACTORY
	// ═══════════════════════════════════════════════════════════════════

	function makePill(tag, label) {
		const el = document.createElement(tag)
		el.className = 'ytmdh-test-pill'
		el.textContent = label
		if (tag === 'a') {
			el.href = '#'
			el.rel = 'noopener'
		}
		if (tag === 'button') {
			el.type = 'button'
		}
		return el
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TEST 1 — <button> fixed to body (baseline)
	//  If this fails, something global blocks clicks.
	// ═══════════════════════════════════════════════════════════════════

	function test1_BodyFixed() {
		const col = document.createElement('div')
		col.id = 'ytmdh-test-column'

		const btn = makePill('button', '① body-fixed <button>')
		btn.addEventListener('click', (e) => {
			e.preventDefault()
			e.stopPropagation()
			reportClick('① body-fixed <button>', btn)
		})
		col.appendChild(btn)
		document.body.appendChild(col)
		log('Test 1: body-fixed <button> mounted')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TEST 2 — <a> fixed to body
	//  Anchor tags bypass some button-specific event suppression.
	// ═══════════════════════════════════════════════════════════════════

	function test2_BodyAnchor() {
		const col = document.getElementById('ytmdh-test-column')
		const a = makePill('a', '② body-fixed <a>')
		a.addEventListener('click', (e) => {
			e.preventDefault()
			e.stopPropagation()
			reportClick('② body-fixed <a>', a)
		})
		col.appendChild(a)
		log('Test 2: body-fixed <a> mounted')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TEST 3 — <button> appended to .av-toggle (no stopPropagation)
	//  stopPropagation might kill Polymer event routing — skip it here.
	// ═══════════════════════════════════════════════════════════════════

	function test3_AvToggleButton() {
		const avToggle = document.querySelector('.av-toggle')
		if (!avToggle) {
			log('Test 3: .av-toggle not found — skipped')
			return
		}
		const btn = makePill('button', '③ av-toggle <button>')
		btn.style.marginLeft = '8px'
		btn.addEventListener('click', (e) => {
			// No stopPropagation — let Polymer see the event.
			e.preventDefault()
			reportClick('③ av-toggle <button>', btn)
		})
		avToggle.appendChild(btn)
		log('Test 3: av-toggle <button> mounted (no stopPropagation)')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TEST 4 — <button> appended to .av-toggle parent (#av-id)
	//  If av-toggle intercepts/swallows events, parent might not.
	// ═══════════════════════════════════════════════════════════════════

	function test4_AvParent() {
		const avEl = document.querySelector('#av-id') || document.querySelector('.av')
		if (!avEl) {
			log('Test 4: #av-id/.av not found — skipped')
			return
		}
		const btn = makePill('button', '④ av-parent <button>')
		btn.style.marginLeft = '8px'
		btn.addEventListener('click', (e) => {
			e.preventDefault()
			reportClick('④ av-parent <button>', btn)
		})
		avEl.appendChild(btn)
		log('Test 4: av-parent <button> mounted')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  TEST 5 — <button> inside .av-toggle, mounted after 2 s delay
	//  Polymer may re-stamp av-toggle after script runs, evicting earlier mounts.
	// ═══════════════════════════════════════════════════════════════════

	function test5_DelayedMount() {
		setTimeout(() => {
			const avToggle = document.querySelector('.av-toggle')
			if (!avToggle) {
				log('Test 5: .av-toggle not found after 2 s delay — skipped')
				return
			}
			const btn = makePill('button', '⑤ av-toggle delayed')
			btn.style.marginLeft = '8px'
			btn.addEventListener('click', (e) => {
				e.preventDefault()
				reportClick('⑤ av-toggle delayed (2 s)', btn)
			})
			avToggle.appendChild(btn)
			log('Test 5: delayed av-toggle <button> mounted')
		}, 2000)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  RUN ALL TESTS
	// ═══════════════════════════════════════════════════════════════════

	test1_BodyFixed()
	test2_BodyAnchor()
	test3_AvToggleButton()
	test4_AvParent()
	test5_DelayedMount()

	log('All tests initialized — check right side of screen + av-toggle area')
})()
