// ==UserScript==
// @name         YT Button Clickability Test
// @namespace    yt-button-test
// @version      1.0.0
// @description  10 different button methods to diagnose which one is actually clickable on YouTube
// @match        *://www.youtube.com/watch*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  HELPERS
	// ═══════════════════════════════════════════════════════════════════

	function hit(n, method) {
		const msg = `[YT Button Test] Button ${n} WORKED — ${method}`
		console.log(msg)
		document.getElementById(`ytbt-status-${n}`).textContent = 'CLICKED!'
		document.getElementById(`ytbt-status-${n}`).style.background = '#00c853'
	}

	const BASE_STYLE = `
		position: fixed;
		right: 8px;
		z-index: 2147483647;
		width: 180px;
		padding: 7px 10px;
		border-radius: 6px;
		font: bold 11px monospace;
		text-align: center;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0,0,0,0.6);
		pointer-events: all !important;
	`

	// colours per button
	const COLORS = [
		'#b71c1c', // 1
		'#e65100', // 2
		'#f57f17', // 3
		'#1b5e20', // 4
		'#0d47a1', // 5
		'#4a148c', // 6
		'#880e4f', // 7
		'#006064', // 8
		'#37474f', // 9
		'#4e342e', // 10
	]

	function makeStatusSpan(n) {
		const s = document.createElement('span')
		s.id = `ytbt-status-${n}`
		s.style.cssText = `
			display: block;
			margin-top: 3px;
			padding: 2px 4px;
			border-radius: 3px;
			font-size: 10px;
			background: rgba(0,0,0,0.4);
		`
		s.textContent = 'waiting...'
		return s
	}

	function topPx(index) {
		// Stack buttons starting from 72px, 20px apart (with ~52px height each)
		return 72 + index * 58
	}

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 1 — plain <button> + click, appended to body
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 1
		const btn = document.createElement('button')
		btn.textContent = `${n}. <button> click`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(0)}px; background: ${COLORS[0]}; color: #fff; border: none;`
		btn.appendChild(makeStatusSpan(n))
		btn.addEventListener('click', () => hit(n, '<button> + addEventListener click, body'))
		document.body.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 2 — plain <button> + pointerdown capture, appended to body
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 2
		const btn = document.createElement('button')
		btn.textContent = `${n}. <button> pointerdown`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(1)}px; background: ${COLORS[1]}; color: #fff; border: none;`
		btn.appendChild(makeStatusSpan(n))
		btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); hit(n, '<button> + pointerdown capture, body') }, true)
		document.body.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 3 — <div role=button> + pointerdown capture (mirrors current code)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 3
		const btn = document.createElement('div')
		btn.textContent = `${n}. <div> pointerdown`
		btn.setAttribute('role', 'button')
		btn.setAttribute('tabindex', '0')
		btn.style.cssText = BASE_STYLE + `top: ${topPx(2)}px; background: ${COLORS[2]}; color: #fff;`
		btn.appendChild(makeStatusSpan(n))
		btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); hit(n, '<div role=button> + pointerdown capture (current approach)') }, true)
		document.body.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 4 — <button> appended to <html> (not inside <body>)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 4
		const btn = document.createElement('button')
		btn.textContent = `${n}. <button> on <html>`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(3)}px; background: ${COLORS[3]}; color: #fff; border: none;`
		btn.appendChild(makeStatusSpan(n))
		btn.addEventListener('click', () => hit(n, '<button> click, appended to document.documentElement'))
		document.documentElement.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 5 — Shadow DOM host so YouTube CSS/events can't reach it
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 5
		const host = document.createElement('div')
		host.style.cssText = `position: fixed; top: ${topPx(4)}px; right: 8px; z-index: 2147483647; pointer-events: all !important;`
		const shadow = host.attachShadow({ mode: 'open' })
		const btn = document.createElement('button')
		btn.textContent = `${n}. Shadow DOM`
		const style = document.createElement('style')
		style.textContent = `button { ${BASE_STYLE.replace(/position: fixed;/, '')} background: ${COLORS[4]}; color: #fff; border: none; display: block; }`
		shadow.appendChild(style)
		shadow.appendChild(btn)
		const status = makeStatusSpan(n)
		btn.appendChild(status)
		btn.addEventListener('click', () => hit(n, '<button> inside Shadow DOM, click'))
		document.body.appendChild(host)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 6 — mousedown capture (no pointerdown, no click)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 6
		const btn = document.createElement('button')
		btn.textContent = `${n}. mousedown capture`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(5)}px; background: ${COLORS[5]}; color: #fff; border: none;`
		btn.appendChild(makeStatusSpan(n))
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); hit(n, '<button> + mousedown capture') }, true)
		document.body.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 7 — inline onclick attribute (bypasses addEventListener entirely)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 7
		const btn = document.createElement('button')
		btn.textContent = `${n}. inline onclick`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(6)}px; background: ${COLORS[6]}; color: #fff; border: none;`
		const status = makeStatusSpan(n)
		btn.appendChild(status)
		// Inline handler — lives on the element itself, not the listener chain
		btn.onclick = function (e) { e.stopPropagation(); hit(n, '<button> inline .onclick property') }
		document.body.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 8 — <a> tag acting as button (completely different element type)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 8
		const btn = document.createElement('a')
		btn.textContent = `${n}. <a> click`
		btn.href = '#'
		btn.style.cssText = BASE_STYLE + `top: ${topPx(7)}px; background: ${COLORS[7]}; color: #fff; text-decoration: none; display: block;`
		btn.appendChild(makeStatusSpan(n))
		btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hit(n, '<a href="#"> + click') })
		document.body.appendChild(btn)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 9 — window-level capture listener watching for pointer on element
	//             (works even if the element's own listeners are blocked)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 9
		const btn = document.createElement('button')
		btn.id = 'ytbt-btn-9'
		btn.textContent = `${n}. window capture`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(8)}px; background: ${COLORS[8]}; color: #fff; border: none;`
		btn.appendChild(makeStatusSpan(n))
		document.body.appendChild(btn)
		// Listener lives on window, not the element — nothing can block it at the element level
		window.addEventListener('pointerdown', (e) => {
			if (e.target === btn || btn.contains(e.target)) {
				e.preventDefault()
				e.stopImmediatePropagation()
				hit(n, 'window-level pointerdown capture, target check')
			}
		}, true)
	})()

	// ═══════════════════════════════════════════════════════════════════
	//  BUTTON 10 — <input type=button> (form control, different event model)
	// ═══════════════════════════════════════════════════════════════════
	;(function () {
		const n = 10
		const btn = document.createElement('input')
		btn.type = 'button'
		btn.value = `${n}. <input type=button>`
		btn.style.cssText = BASE_STYLE + `top: ${topPx(9)}px; background: ${COLORS[9]}; color: #fff; border: none;`
		// Can't appendChild into an <input>, so wrap it
		const wrap = document.createElement('div')
		wrap.style.cssText = `position: fixed; top: ${topPx(9)}px; right: 8px; z-index: 2147483647;`
		wrap.appendChild(btn)
		wrap.appendChild(makeStatusSpan(n))
		btn.addEventListener('click', () => hit(n, '<input type=button> + click'))
		document.body.appendChild(wrap)
	})()

	console.log('[YT Button Test] 10 test buttons injected. Check the right side of the page.')
})()
