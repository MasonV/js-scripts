// ==UserScript==
// @name         LiveBench Custom Weights
// @namespace    livebench-custom-weights
// @version      0.2.0
// @description  Build your own score weights for the LiveBench suites and the parts beneath them, save them as profiles, and see the leaderboard re-ranked live
// @match        https://livebench.ai/*
// @match        https://www.livebench.ai/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/livebench-custom-weights/livebench-custom-weights.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/livebench-custom-weights/livebench-custom-weights.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
	'use strict'

	// ═══════════════════════════════════════════════════════════════════
	//  CONSTANTS
	// ═══════════════════════════════════════════════════════════════════

	const LOG_PREFIX = '[LiveBench Custom Weights]'
	const SCRIPT_VERSION =
		typeof GM_info !== 'undefined' && GM_info.script?.version
			? GM_info.script.version
			: '__DEV__'

	const PROFILES_KEY = 'livebench_custom_weights_profiles_v1'
	const STATE_KEY = 'livebench_custom_weights_state_v1'
	const ROOT_ID = 'lbcw-root'

	// How long to wait after the page stops changing before re-reading the
	// leaderboard. The site re-renders the table on every filter click.
	const REFRESH_DEBOUNCE_MS = 250

	// ═══════════════════════════════════════════════════════════════════
	//  PURE LOGIC
	// ═══════════════════════════════════════════════════════════════════

	// A suite with no saved weight counts once. This is also how the site
	// treats most suites in its own Overall score.
	const DEFAULT_WEIGHT = 1
	const MAX_WEIGHT = 10
	const WEIGHT_STEP = 0.25
	const MAX_NAME_LENGTH = 40

	// Weights are keyed by normalized suite label, not by column position,
	// so a profile keeps working when the site reorders or hides columns.
	// "LiveBench default" reproduces the site's own Overall formula
	// (categories.json → _overall_weights): Long Agentic ×2, Coding ×1.5,
	// Design ×1.5, everything else ×1.
	const BUILTIN_PROFILES = [
		{
			name: 'LiveBench default',
			note: 'The same weights the site uses for its Overall score.',
			weights: { agentic: 2, coding: 1.5, design: 1.5 },
		},
		{
			name: 'Equal weight',
			note: 'Every suite counts the same.',
			weights: {},
		},
		{
			name: 'Builder',
			note: 'Coding, agents and browser use count the most.',
			weights: { coding: 3, agentic: 3, 'browser use': 2, design: 1.5 },
		},
		{
			name: 'Thinker',
			note: 'Reasoning, research and data analysis count the most.',
			weights: { reasoning: 3, research: 3, 'data analysis': 2 },
		},
	]
	const DEFAULT_PROFILE_NAME = BUILTIN_PROFILES[0].name

	// "LLM API INTEGRATION (3)" → "LLM API INTEGRATION". The site appends a
	// task count to sub-suite headers; it changes between releases.
	function stripTaskCount(text) {
		return String(text ?? '')
			.replace(/\s+/g, ' ')
			.replace(/\s*\(\d+\)\s*$/, '')
			.trim()
	}

	function normalizeLabel(text) {
		return stripTaskCount(text).toLowerCase()
	}

	// Cell text → number, or null for anything that isn't a plain score
	// ("—", "", "n/a"). A null score is left out of the average.
	function parseScore(text) {
		const m = String(text ?? '')
			.trim()
			.match(/^(-?\d+(?:\.\d+)?)\s*%?$/)
		return m ? Number(m[1]) : null
	}

	function clampWeight(value, fallback = DEFAULT_WEIGHT) {
		const n = typeof value === 'number' ? value : parseFloat(value)
		if (!Number.isFinite(n)) return fallback
		return Math.round(Math.min(MAX_WEIGHT, Math.max(0, n)) * 100) / 100
	}

	function weightOf(weights, key) {
		return Object.prototype.hasOwnProperty.call(weights, key)
			? clampWeight(weights[key])
			: DEFAULT_WEIGHT
	}

	// Anything read back from storage is untrusted: keep only own numeric
	// entries, clamped, and never a "__proto__" key.
	function sanitizeWeights(raw) {
		const out = {}
		if (!raw || typeof raw !== 'object') return out
		for (const key of Object.keys(raw)) {
			if (key === '__proto__') continue
			if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) {
				out[key] = clampWeight(raw[key])
			}
		}
		return out
	}

	// Two weight sets are the same when every suite resolves to the same
	// weight — so {} equals {agentic: 1}.
	function sameWeights(a, b) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)])
		for (const key of keys) {
			if (weightOf(a, key) !== weightOf(b, key)) return false
		}
		return true
	}

	// One suite's score under your part weights.
	//
	// entry: { key, value, parts } — `value` is the site's own score for the
	// suite and `parts` is [{ key, tasks, value }] (or null when the parts
	// aren't known). A part weight is a multiplier on how much that part
	// counts: 1 = as the site counts it (in proportion to its task count),
	// 0 = leave it out, 2 = twice as much.
	//
	// The result starts from the site's own number and shifts by how your
	// weights change the average of the parts. So untouched weights give the
	// site's score exactly, and the site's own rules (e.g. a regression
	// scoring a hard 0) are kept. Null means every part was set to 0.
	function suiteScore(entry, weights) {
		const { value, parts } = entry
		if (value == null) return null
		if (!parts || parts.length === 0) return value
		if (parts.every(p => weightOf(weights, p.key) === 1)) return value

		let siteSum = 0
		let siteTasks = 0
		let mySum = 0
		let myTasks = 0
		for (const p of parts) {
			if (p.value == null) continue
			const mult = weightOf(weights, p.key)
			siteSum += p.tasks * p.value
			siteTasks += p.tasks
			mySum += p.tasks * mult * p.value
			myTasks += p.tasks * mult
		}
		if (siteTasks === 0) return value
		if (myTasks === 0) return null
		const adjusted = value + (mySum / myTasks - siteSum / siteTasks)
		return Math.min(100, Math.max(0, adjusted))
	}

	// Weighted mean over the suites a model has a score for, skipping
	// zero-weight suites. Same rule the site uses for its Overall column.
	// scores: [{ key, value, parts? }] — value is a number or null.
	function computeCustomScore(scores, weights) {
		let sum = 0
		let total = 0
		for (const entry of scores) {
			const w = weightOf(weights, entry.key)
			if (w <= 0) continue
			const value = suiteScore(entry, weights)
			if (value == null) continue
			sum += w * value
			total += w
		}
		return total > 0 ? sum / total : null
	}

	// models: [{ name, scores: [{ key, value }], siteOverall }] in the order
	// the site shows them. Returns the models best-first with:
	//   score    your weighted score (null if nothing could be scored)
	//   rank     your 1-based rank (null when unscored)
	//   siteRank rank by the site's Overall (null when the page has none)
	//   delta    places gained vs the site (positive = you rank it higher)
	// Ties keep the site's order, so a re-sort never shuffles equal rows.
	function rankModels(models, weights) {
		const scored = models.map((m, index) => ({
			...m,
			index,
			score: computeCustomScore(m.scores, weights),
		}))

		const siteRanks = new Map()
		scored
			.filter(m => m.siteOverall != null)
			.sort((a, b) => b.siteOverall - a.siteOverall || a.index - b.index)
			.forEach((m, pos) => siteRanks.set(m.index, pos + 1))

		const ranked = scored
			.filter(m => m.score != null)
			.sort((a, b) => b.score - a.score || a.index - b.index)
		const unranked = scored.filter(m => m.score == null)

		ranked.forEach((m, pos) => {
			m.rank = pos + 1
			m.siteRank = siteRanks.get(m.index) ?? null
			m.delta = m.siteRank == null ? null : m.siteRank - m.rank
		})
		unranked.forEach(m => {
			m.rank = null
			m.siteRank = siteRanks.get(m.index) ?? null
			m.delta = null
		})
		return ranked.concat(unranked)
	}

	// Each suite's share of the total weight, in percent. keys: string[].
	function weightShares(keys, weights) {
		const total = keys.reduce((sum, key) => sum + weightOf(weights, key), 0)
		const shares = new Map()
		for (const key of keys) {
			shares.set(key, total > 0 ? (weightOf(weights, key) / total) * 100 : 0)
		}
		return shares
	}

	function formatWeight(w) {
		return String(Math.round(w * 100) / 100)
	}

	// Plain-language echo of the formula being applied, so nobody has to
	// guess how the sliders turn into a score.
	// columns: [{ key, label }]
	function describeFormula(columns, weights) {
		const active = columns
			.map(c => ({ label: c.label, w: weightOf(weights, c.key) }))
			.filter(c => c.w > 0)
		if (active.length === 0) return 'Every weight is 0, so no score can be worked out.'
		if (active.every(c => c.w === active[0].w)) {
			return active.length === 1
				? `Score = ${active[0].label} only`
				: `Score = plain average of ${active.length} suites`
		}
		const total = active.reduce((sum, c) => sum + c.w, 0)
		const terms = active.map(c => `${formatWeight(c.w)} × ${c.label}`).join(' + ')
		return `Score = (${terms}) ÷ ${formatWeight(total)}`
	}

	// Wording for how far a model moved against the site's ranking.
	function describeMove(delta) {
		if (delta == null) return { dir: 'none', text: '–' }
		if (delta > 0) return { dir: 'up', text: `▲ ${delta}` }
		if (delta < 0) return { dir: 'down', text: `▼ ${-delta}` }
		return { dir: 'same', text: '＝' }
	}

	// A profile name is trimmed, 1–40 characters, and can't reuse a built-in
	// name or one of your own. Returns { ok, name } or { ok: false, error }.
	function validateProfileName(raw, customNames, builtinNames) {
		const name = String(raw ?? '')
			.replace(/\s+/g, ' ')
			.trim()
		if (!name) return { ok: false, error: 'Give the profile a name.' }
		if (name.length > MAX_NAME_LENGTH) {
			return { ok: false, error: `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.` }
		}
		if (name === '__proto__') return { ok: false, error: 'Pick a different name.' }
		const lower = name.toLowerCase()
		if (builtinNames.some(n => n.toLowerCase() === lower)) {
			return { ok: false, error: 'A built-in profile already uses that name.' }
		}
		if (customNames.some(n => n.toLowerCase() === lower)) {
			return { ok: false, error: 'You already have a profile with that name.' }
		}
		return { ok: true, name }
	}

	// ── Parts (the scores underneath each suite) ────────────────────────

	function own(obj, key) {
		return !!obj && Object.prototype.hasOwnProperty.call(obj, key)
	}

	// "LLM API INTEGRATION (3)" → 3. Null when the header has no count.
	function parseTaskCount(text) {
		const m = String(text ?? '').match(/\((\d+)\)\s*$/)
		return m ? Number(m[1]) : null
	}

	// A part's weight is stored under "<suite>/<part>", e.g. "coding/hard fixes".
	// The same key is used whether the part shows up in the suite's expanded
	// list or as a column when a category is selected on the site.
	function partKey(suiteKey, partName) {
		return `${suiteKey}/${normalizeLabel(partName)}`
	}

	// breakdown.json names two suites differently from the table headers.
	const GROUP_COLUMN_ALIASES = { 'long agentic': 'agentic', browser: 'browser use' }

	function groupColumnKey(groupName) {
		const key = normalizeLabel(groupName)
		return own(GROUP_COLUMN_ALIASES, key) ? GROUP_COLUMN_ALIASES[key] : key
	}

	// table.csv → [{ id, values }] with every numeric score after the id.
	function parseCsvRows(text) {
		const lines = String(text ?? '')
			.split(/\r?\n/)
			.filter(l => l.trim())
		return lines.slice(1).map(line => {
			const fields = line.split(',')
			return {
				id: fields[0].trim(),
				values: fields
					.slice(1)
					.map(f => parseFloat(f))
					.filter(Number.isFinite),
			}
		})
	}

	const tenths = v => Math.round(v * 10)

	// Which model (by id) is each row of the table? The page only shows
	// display names, which don't follow one rule ("Step 5 (Preview)" is
	// "step-5-preview", "Mistral Large 4 1029" is "mistral-large-4-0"), so
	// match on the scores instead: a row belongs to the one model whose
	// table.csv scores include every score the row shows.
	// rows: number[][] (the scores each row shows); candidates: [{ id, values }].
	// Returns one id (or null when unclear or shared by two rows) per row.
	function matchRowsToIds(rows, candidates) {
		const counts = candidates.map(c => {
			const map = new Map()
			for (const v of c.values) map.set(tenths(v), (map.get(tenths(v)) || 0) + 1)
			return map
		})
		const found = rows.map(row => {
			const need = new Map()
			for (const v of row) need.set(tenths(v), (need.get(tenths(v)) || 0) + 1)
			const hits = []
			counts.forEach((have, i) => {
				for (const [k, n] of need) if ((have.get(k) || 0) < n) return
				hits.push(i)
			})
			return row.length > 0 && hits.length === 1 ? candidates[hits[0]].id : null
		})
		const used = new Map()
		for (const id of found) if (id != null) used.set(id, (used.get(id) || 0) + 1)
		return found.map(id => (id != null && used.get(id) === 1 ? id : null))
	}

	// What the leaderboard shows, as scoring input.
	// raw: { columns: [{ key, label, tasks }], hasOverall, overallLabel,
	//        models: [{ name, siteOverall, values }] }
	//
	// kind "suites": each column is a suite (the default view).
	// kind "parts":  each column is a part of one suite — what the site shows
	//   when a category is selected. The "Overall" column is then that suite.
	function buildBoard(raw) {
		const base = { hasOverall: raw.hasOverall, partsStatus: 'n/a', unmatched: 0 }
		const suiteKey = normalizeLabel(raw.overallLabel)
		const isPartsView =
			raw.hasOverall && !!suiteKey && raw.columns.length > 0 && raw.columns.every(c => c.tasks != null)

		if (isPartsView) {
			const columns = raw.columns.map(c => ({
				key: partKey(suiteKey, c.label),
				label: c.label,
				tasks: c.tasks,
			}))
			return {
				...base,
				kind: 'parts',
				suiteKey,
				suiteLabel: stripTaskCount(raw.overallLabel),
				columns,
				models: raw.models.map(m => ({
					name: m.name,
					siteOverall: m.siteOverall,
					scores: [
						{
							key: '(suite)',
							value: m.siteOverall,
							parts: columns.map((c, i) => ({ key: c.key, tasks: c.tasks, value: m.values[i] })),
						},
					],
				})),
			}
		}

		const columns = raw.columns.map(c => ({ key: c.key, label: c.label }))
		return {
			...base,
			kind: 'suites',
			columns,
			models: raw.models.map(m => ({
				name: m.name,
				siteOverall: m.siteOverall,
				scores: columns.map((c, i) => ({ key: c.key, value: m.values[i] })),
			})),
		}
	}

	// Adds each suite's parts to a "suites" board, from the release's
	// breakdown.json (suite → { parts: [{ name, tasks }], models: { id:
	// { scores: { part: score } } } }) and table.csv rows. A suite or model
	// that can't be matched keeps just its suite score.
	function attachParts(board, breakdown, csvRows) {
		if (board.kind !== 'suites' || !breakdown || typeof breakdown !== 'object') return board

		const groupByColumn = {}
		for (const name of Object.keys(breakdown)) {
			const key = groupColumnKey(name)
			if (!own(groupByColumn, key)) groupByColumn[key] = name
		}

		const columns = board.columns.map(col => {
			const group = own(groupByColumn, col.key) ? groupByColumn[col.key] : null
			const list = group && Array.isArray(breakdown[group]?.parts) ? breakdown[group].parts : []
			const parts = list
				.filter(p => p && typeof p.name === 'string' && Number.isFinite(p.tasks) && p.tasks > 0)
				.map(p => ({ key: partKey(col.key, p.name), label: p.name, tasks: p.tasks }))
			return { ...col, group, parts: parts.length > 0 ? parts : null }
		})

		const ids = matchRowsToIds(
			board.models.map(m => m.scores.map(s => s.value).filter(v => v != null)),
			csvRows || []
		)
		const models = board.models.map((m, i) => {
			const id = ids[i]
			if (id == null) return m
			return {
				...m,
				scores: m.scores.map((s, j) => {
					const col = columns[j]
					if (!col.parts) return s
					const model = breakdown[col.group]?.models
					const scores = own(model, id) ? model[id]?.scores : null
					if (!scores) return s
					return {
						...s,
						parts: col.parts.map(p => ({
							key: p.key,
							tasks: p.tasks,
							value: own(scores, p.label) && Number.isFinite(scores[p.label]) ? scores[p.label] : null,
						})),
					}
				}),
			}
		})
		return {
			...board,
			columns,
			models,
			partsStatus: 'ready',
			unmatched: ids.filter(id => id == null).length,
		}
	}

	// Each part's share of its suite, in percent: its task count times your
	// weight, out of the total. With every weight at 1 this is the share the
	// site gives it. parts: [{ key, tasks }].
	function partShares(parts, weights) {
		const total = parts.reduce((sum, p) => sum + p.tasks * weightOf(weights, p.key), 0)
		const shares = new Map()
		for (const p of parts) {
			shares.set(p.key, total > 0 ? ((p.tasks * weightOf(weights, p.key)) / total) * 100 : 0)
		}
		return shares
	}

	// Parts whose weight differs from the site's (1).
	function changedParts(parts, weights) {
		return parts.filter(p => weightOf(weights, p.key) !== DEFAULT_WEIGHT)
	}

	// Plain-language note on which part weights are in play, so a changed
	// score is never a mystery. Empty when every part is at the site's weight.
	function describePartChanges(board, weights) {
		if (board.kind === 'parts') {
			const changed = changedParts(board.columns, weights)
			if (changed.length === 0) return `${board.suiteLabel} score matches the site (every part ×1).`
			const terms = changed.map(p => {
				const w = weightOf(weights, p.key)
				return w === 0 ? `${p.label} left out` : `${p.label} ×${formatWeight(w)}`
			})
			return `${board.suiteLabel} score = the site’s, adjusted for: ${terms.join(', ')}.`
		}
		const names = board.columns
			.filter(c => c.parts && changedParts(c.parts, weights).length > 0)
			.map(c => c.label)
		return names.length > 0 ? `Part weights changed in: ${names.join(', ')}.` : ''
	}

	// ═══════════════════════════════════════════════════════════════════
	//  LOGGING
	// ═══════════════════════════════════════════════════════════════════

	function log(...args) {
		console.log(LOG_PREFIX, ...args)
	}
	function warn(...args) {
		console.warn(LOG_PREFIX, ...args)
	}

	// <update-check>
	// ═══════════════════════════════════════════════════════════════════
	//  UPDATE CHECK
	//  Generated from tools/update-check.template.js — do not edit here.
	//  Change the template, then run: node tools/sync-update-check.mjs
	// ═══════════════════════════════════════════════════════════════════

	const UPDATE_BANNER_ID = 'livebench-custom-weights-update-banner'
	const UPDATE_DISMISS_KEY = 'livebench_custom_weights_update_dismissed_v'

	// Tampermonkey exposes the script's own metadata block, so these URLs
	// don't have to be hand-maintained in two places. Greasemonkey 4 does
	// not expose them, hence the literal fallbacks.
	const META_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/livebench-custom-weights/livebench-custom-weights.meta.js'
	const DOWNLOAD_URL =
		(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
		'https://raw.githubusercontent.com/MasonV/js-scripts/main/livebench-custom-weights/livebench-custom-weights.user.js'

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
	// </update-check>

	// ═══════════════════════════════════════════════════════════════════
	//  STORAGE
	// ═══════════════════════════════════════════════════════════════════

	function storageGet(key) {
		try {
			const raw = localStorage.getItem(key)
			return raw ? JSON.parse(raw) : null
		} catch (e) {
			warn(`Couldn't read ${key}:`, e)
			return null
		}
	}

	function storageSet(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value))
			return true
		} catch (e) {
			warn(`Couldn't save ${key}:`, e)
			return false
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	//  STATE
	// ═══════════════════════════════════════════════════════════════════

	const state = {
		open: false,
		profiles: {}, // your saved profiles: name → weights
		active: DEFAULT_PROFILE_NAME, // the profile the sliders started from
		weights: {}, // the sliders' current values (may have unsaved edits)
		raw: null, // last table read from the page, before part scores are added
		board: null, // raw, built into scoring input (with parts when known)
		boardSig: '',
		columnsSig: '',
		openSuites: new Set(), // suites whose part sliders are expanded
	}

	function clone(weights) {
		return { ...weights }
	}

	function builtinProfile(name) {
		return BUILTIN_PROFILES.find(p => p.name === name) || null
	}

	function isCustomProfile(name) {
		return Object.prototype.hasOwnProperty.call(state.profiles, name)
	}

	// The weights a profile was last saved with.
	function savedWeights(name) {
		const builtin = builtinProfile(name)
		if (builtin) return builtin.weights
		return isCustomProfile(name) ? state.profiles[name] : {}
	}

	function isDirty() {
		return !sameWeights(state.weights, savedWeights(state.active))
	}

	function loadState() {
		const savedProfiles = storageGet(PROFILES_KEY)
		if (savedProfiles && typeof savedProfiles === 'object') {
			for (const name of Object.keys(savedProfiles)) {
				const check = validateProfileName(
					name,
					[],
					BUILTIN_PROFILES.map(p => p.name)
				)
				if (check.ok) state.profiles[check.name] = sanitizeWeights(savedProfiles[name])
			}
		}

		const saved = storageGet(STATE_KEY)
		const active = saved?.active
		state.active =
			typeof active === 'string' && (builtinProfile(active) || isCustomProfile(active))
				? active
				: DEFAULT_PROFILE_NAME
		state.weights = saved?.weights
			? sanitizeWeights(saved.weights)
			: clone(savedWeights(state.active))
	}

	function saveProfiles() {
		return storageSet(PROFILES_KEY, state.profiles)
	}

	function saveState() {
		storageSet(STATE_KEY, { active: state.active, weights: state.weights })
	}

	// ═══════════════════════════════════════════════════════════════════
	//  LEADERBOARD READER
	// ═══════════════════════════════════════════════════════════════════

	// "Release 2026-11-06 · LiveBench 2.0" → "20261106", the folder the site
	// keeps that release's data in.
	function activeReleaseId() {
		const label = document.querySelector('.lb-dot.active')?.getAttribute('aria-label') ?? ''
		const m = label.match(/(\d{4})-(\d{2})-(\d{2})/)
		return m ? m[1] + m[2] + m[3] : null
	}

	// Reads whatever table the site is showing right now: its release,
	// category and filter choices all carry through, and the columns follow
	// the site when they change (v1 releases, a selected category's parts).
	// Returns null when there's no leaderboard on screen.
	function readLeaderboard() {
		const table = document.querySelector('table.lb-tbl')
		if (!table) return null
		const rows = [...table.querySelectorAll('tbody tr.row')]
		if (rows.length === 0) return null

		const headers = [...table.querySelectorAll('thead th')]
		const sample = rows[0]
		const columns = []
		let overallIndex = -1
		let overallLabel = ''
		headers.forEach((th, index) => {
			const cell = sample.children[index]
			if (!cell) return
			const text = th.querySelector('.th-t')?.textContent ?? th.textContent
			if (cell.classList.contains('lb-ovr')) {
				overallIndex = index
				overallLabel = stripTaskCount(text)
			} else if (cell.classList.contains('lb-cat')) {
				const key = normalizeLabel(text)
				if (key) columns.push({ index, key, label: stripTaskCount(text), tasks: parseTaskCount(text) })
			}
		})
		if (columns.length === 0) return null

		const models = rows.map(tr => {
			const nameEl = tr.querySelector('.nm') || tr.querySelector('.mdl-col')
			return {
				name: (nameEl?.textContent ?? '').replace(/\s+/g, ' ').trim() || '(unnamed model)',
				siteOverall: overallIndex >= 0 ? parseScore(tr.children[overallIndex]?.textContent) : null,
				values: columns.map(c => parseScore(tr.children[c.index]?.textContent)),
			}
		})
		return {
			columns,
			models,
			hasOverall: overallIndex >= 0,
			overallLabel,
			release: activeReleaseId(),
		}
	}

	function rawSignature(raw) {
		if (!raw) return ''
		return [
			`${raw.release}|${raw.overallLabel}|${raw.columns.map(c => `${c.key}:${c.tasks}`).join('|')}`,
			...raw.models.map(m => `${m.name}:${m.siteOverall}:${m.values.join(',')}`),
		].join('\n')
	}

	// ═══════════════════════════════════════════════════════════════════
	//  RELEASE DATA (part scores)
	// ═══════════════════════════════════════════════════════════════════

	// The scores underneath each suite aren't in the table, but the site
	// loads them from data/<release>/breakdown.json, and table.csv holds the
	// model ids that tie them to table rows. Both are fetched once per
	// release (the page has already pulled them, so the browser has them
	// cached). A release with neither just gets suite-level weights.
	const releaseData = new Map() // release id → { status, breakdown, csv }

	// Use the exact URL the page loaded (it carries a cache-busting version),
	// otherwise fall back to the plain path.
	function dataUrl(releaseId, file) {
		const path = `/data/${releaseId}/${file}`
		try {
			const hit = performance
				.getEntriesByType('resource')
				.map(r => r.name)
				.find(name => name.includes(path))
			if (hit) return hit
		} catch {
			/* fall through to the plain path */
		}
		return `${location.origin}${path}`
	}

	async function fetchData(releaseId, file, asJson) {
		try {
			const resp = await fetch(dataUrl(releaseId, file))
			if (!resp.ok) return null
			return asJson ? await resp.json() : await resp.text()
		} catch (e) {
			warn(`Couldn't load ${file} for release ${releaseId}:`, e)
			return null
		}
	}

	function ensureReleaseData(releaseId) {
		if (!releaseId || releaseData.has(releaseId)) return
		releaseData.set(releaseId, { status: 'loading' })
		Promise.all([fetchData(releaseId, 'breakdown.json', true), fetchData(releaseId, 'table.csv', false)]).then(
			([breakdown, csvText]) => {
				const csv = csvText ? parseCsvRows(csvText) : null
				const ok = breakdown && typeof breakdown === 'object' && csv && csv.length > 0
				releaseData.set(releaseId, ok ? { status: 'ready', breakdown, csv } : { status: 'none' })
				log(`Part scores for ${releaseId}: ${ok ? 'loaded' : 'not available'}.`)
				refreshBoard(true)
			}
		)
	}

	// The raw table, built into scoring input and — when the release's part
	// scores are in — with each suite's parts attached.
	function composeBoard(raw) {
		let board = buildBoard(raw)
		if (board.kind !== 'suites') return board
		const data = raw.release ? releaseData.get(raw.release) : null
		if (data?.status === 'ready') return attachParts(board, data.breakdown, data.csv)
		board = { ...board, partsStatus: data?.status === 'loading' ? 'loading' : 'none' }
		return board
	}

	function boardSignature(board) {
		if (!board) return ''
		return `${board.kind}:${board.partsStatus}:${board.columns.map(c => c.key + (c.parts ? '+' + c.parts.length : '')).join('|')}`
	}

	// ═══════════════════════════════════════════════════════════════════
	//  STYLES
	// ═══════════════════════════════════════════════════════════════════

	function injectStyles() {
		GM_addStyle(`
			#${ROOT_ID} {
				--lbcw-bg: #ffffff;
				--lbcw-bg-soft: #f6f8fc;
				--lbcw-border: #dbe2ee;
				--lbcw-text: #14213d;
				--lbcw-muted: #5b6785;
				--lbcw-accent: #2f54eb;
				--lbcw-accent-soft: rgba(47, 84, 235, 0.12);
				--lbcw-up: #1a7f37;
				--lbcw-down: #c0392b;
				--lbcw-danger: #c0392b;
				font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
				color: var(--lbcw-text);
			}
			html[data-theme="dark"] #${ROOT_ID} {
				--lbcw-bg: #151b2b;
				--lbcw-bg-soft: #1d2538;
				--lbcw-border: #2d3855;
				--lbcw-text: #e6ebf7;
				--lbcw-muted: #9aa6c4;
				--lbcw-accent: #7c97ff;
				--lbcw-accent-soft: rgba(124, 151, 255, 0.18);
				--lbcw-up: #4cc472;
				--lbcw-down: #ff7b6e;
				--lbcw-danger: #ff7b6e;
			}
			#${ROOT_ID} *, #${ROOT_ID} *::before, #${ROOT_ID} *::after { box-sizing: border-box; }

			#${ROOT_ID} .lbcw-launcher {
				position: fixed; right: 20px; bottom: 20px; z-index: 2147482000;
				display: inline-flex; align-items: center; gap: 8px;
				padding: 10px 16px; border-radius: 999px;
				border: 1px solid var(--lbcw-accent); background: var(--lbcw-accent); color: #fff;
				font: 600 13px/1 inherit; font-family: inherit; cursor: pointer;
				box-shadow: 0 6px 18px rgba(20, 33, 61, 0.25);
				transition: transform .15s ease, box-shadow .15s ease;
			}
			#${ROOT_ID} .lbcw-launcher:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(20, 33, 61, 0.32); }

			#${ROOT_ID} .lbcw-drawer {
				position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147482500;
				width: min(500px, 100vw); display: flex; flex-direction: column;
				background: var(--lbcw-bg); border-left: 1px solid var(--lbcw-border);
				box-shadow: -12px 0 32px rgba(20, 33, 61, 0.18);
				transform: translateX(100%); visibility: hidden;
				transition: transform .22s ease, visibility 0s linear .22s;
			}
			#${ROOT_ID} .lbcw-drawer.lbcw-open {
				transform: translateX(0); visibility: visible;
				transition: transform .22s ease, visibility 0s;
			}

			#${ROOT_ID} .lbcw-head {
				display: flex; align-items: center; justify-content: space-between; gap: 12px;
				padding: 14px 18px; border-bottom: 1px solid var(--lbcw-border);
			}
			#${ROOT_ID} .lbcw-title { margin: 0; font-size: 16px; font-weight: 700; }
			#${ROOT_ID} .lbcw-body { flex: 1; overflow-y: auto; padding: 16px 18px 28px; }

			#${ROOT_ID} .lbcw-section { margin-bottom: 20px; }
			#${ROOT_ID} .lbcw-label {
				margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .08em;
				text-transform: uppercase; color: var(--lbcw-muted);
			}
			#${ROOT_ID} .lbcw-hint { margin: 6px 0 0; font-size: 12px; color: var(--lbcw-muted); line-height: 1.4; }

			#${ROOT_ID} .lbcw-btn {
				display: inline-flex; align-items: center; gap: 6px;
				padding: 6px 12px; border-radius: 8px; font: 600 12px/1.2 inherit; font-family: inherit;
				border: 1px solid var(--lbcw-border); background: var(--lbcw-bg); color: var(--lbcw-text);
				cursor: pointer; transition: background .12s ease, border-color .12s ease;
			}
			#${ROOT_ID} .lbcw-btn:hover:not(:disabled) { background: var(--lbcw-bg-soft); border-color: var(--lbcw-accent); }
			#${ROOT_ID} .lbcw-btn:disabled { opacity: .45; cursor: not-allowed; }
			#${ROOT_ID} .lbcw-btn-primary { background: var(--lbcw-accent); border-color: var(--lbcw-accent); color: #fff; }
			#${ROOT_ID} .lbcw-btn-primary:hover:not(:disabled) { background: var(--lbcw-accent); filter: brightness(1.08); }
			#${ROOT_ID} .lbcw-btn-danger { color: var(--lbcw-danger); border-color: var(--lbcw-danger); }
			#${ROOT_ID} .lbcw-btn-danger:hover:not(:disabled) { background: var(--lbcw-danger); border-color: var(--lbcw-danger); color: #fff; }
			#${ROOT_ID} .lbcw-btn:focus-visible, #${ROOT_ID} .lbcw-launcher:focus-visible,
			#${ROOT_ID} .lbcw-select:focus-visible, #${ROOT_ID} .lbcw-text:focus-visible,
			#${ROOT_ID} .lbcw-num:focus-visible { outline: 2px solid var(--lbcw-accent); outline-offset: 2px; }

			#${ROOT_ID} .lbcw-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
			#${ROOT_ID} .lbcw-hint + .lbcw-row { margin-top: 10px; }
			#${ROOT_ID} .lbcw-row + .lbcw-row { margin-top: 8px; }
			#${ROOT_ID} .lbcw-select, #${ROOT_ID} .lbcw-text, #${ROOT_ID} .lbcw-num {
				padding: 6px 8px; border-radius: 8px; border: 1px solid var(--lbcw-border);
				background: var(--lbcw-bg); color: var(--lbcw-text); font: 13px/1.2 inherit; font-family: inherit;
			}
			#${ROOT_ID} .lbcw-select { flex: 1; min-width: 160px; }
			#${ROOT_ID} .lbcw-text { flex: 1; min-width: 140px; }
			#${ROOT_ID} .lbcw-dirty {
				font-size: 11px; font-weight: 700; color: var(--lbcw-accent);
				background: var(--lbcw-accent-soft); border-radius: 999px; padding: 3px 9px;
			}
			#${ROOT_ID} .lbcw-error { margin: 6px 0 0; font-size: 12px; color: var(--lbcw-danger); }
			#${ROOT_ID} .lbcw-ok { margin: 6px 0 0; font-size: 12px; color: var(--lbcw-up); }

			#${ROOT_ID} .lbcw-weight {
				display: grid; grid-template-columns: minmax(96px, 1.1fr) 2fr 62px 52px;
				align-items: center; gap: 10px; padding: 5px 0;
			}
			#${ROOT_ID} .lbcw-weight-name { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
			#${ROOT_ID} .lbcw-weight input[type="range"] { width: 100%; accent-color: var(--lbcw-accent); }
			#${ROOT_ID} .lbcw-num { width: 62px; text-align: right; }
			#${ROOT_ID} .lbcw-share {
				text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--lbcw-muted);
			}
			#${ROOT_ID} .lbcw-formula {
				margin: 10px 0 0; padding: 9px 11px; border-radius: 8px; background: var(--lbcw-bg-soft);
				border: 1px solid var(--lbcw-border); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				overflow-wrap: anywhere; white-space: pre-wrap;
			}
			#${ROOT_ID} .lbcw-note { padding: 8px 10px; border-radius: 8px; background: var(--lbcw-accent-soft); color: var(--lbcw-text); }

			#${ROOT_ID} .lbcw-suite { border-bottom: 1px solid var(--lbcw-border); padding-bottom: 4px; margin-bottom: 4px; }
			#${ROOT_ID} .lbcw-suite:last-child { border-bottom: 0; }
			#${ROOT_ID} .lbcw-parts { margin: 0 0 6px 14px; padding-left: 12px; border-left: 2px solid var(--lbcw-accent-soft); }
			#${ROOT_ID} .lbcw-parts-summary {
				cursor: pointer; padding: 4px 0; font-size: 12px; font-weight: 600; color: var(--lbcw-accent);
			}
			#${ROOT_ID} .lbcw-parts-summary:focus-visible { outline: 2px solid var(--lbcw-accent); outline-offset: 2px; }
			#${ROOT_ID} .lbcw-part .lbcw-weight-name { font-size: 12px; font-weight: 500; }
			#${ROOT_ID} .lbcw-weight.lbcw-part { grid-template-columns: minmax(130px, 1.5fr) 1.4fr 62px 46px; }
			#${ROOT_ID} .lbcw-tasks { color: var(--lbcw-muted); font-weight: 400; }
			#${ROOT_ID} .lbcw-parts-foot { padding: 4px 0 2px; }
			#${ROOT_ID} .lbcw-btn-small { padding: 4px 9px; font-size: 11px; }

			#${ROOT_ID} .lbcw-rank { width: 100%; border-collapse: collapse; font-size: 13px; }
			#${ROOT_ID} .lbcw-rank th {
				text-align: left; padding: 4px 6px; font-size: 10px; letter-spacing: .08em;
				text-transform: uppercase; color: var(--lbcw-muted); border-bottom: 1px solid var(--lbcw-border);
			}
			#${ROOT_ID} .lbcw-rank td { padding: 6px; border-bottom: 1px solid var(--lbcw-border); vertical-align: middle; }
			#${ROOT_ID} .lbcw-rank .lbcw-r { width: 30px; color: var(--lbcw-muted); font-variant-numeric: tabular-nums; }
			#${ROOT_ID} .lbcw-rank .lbcw-m { font-weight: 600; overflow-wrap: anywhere; }
			#${ROOT_ID} .lbcw-rank .lbcw-s { width: 130px; font-variant-numeric: tabular-nums; }
			#${ROOT_ID} .lbcw-rank .lbcw-d { width: 64px; white-space: nowrap; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
			#${ROOT_ID} .lbcw-score { display: flex; align-items: center; gap: 8px; }
			#${ROOT_ID} .lbcw-score-num { width: 38px; font-weight: 700; }
			#${ROOT_ID} .lbcw-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--lbcw-accent-soft); overflow: hidden; }
			#${ROOT_ID} .lbcw-bar > i { display: block; height: 100%; background: var(--lbcw-accent); transition: width .18s ease; }
			#${ROOT_ID} .lbcw-up { color: var(--lbcw-up); }
			#${ROOT_ID} .lbcw-down { color: var(--lbcw-down); }
			#${ROOT_ID} .lbcw-same, #${ROOT_ID} .lbcw-none { color: var(--lbcw-muted); font-weight: 500; }
			#${ROOT_ID} .lbcw-empty {
				padding: 14px; border-radius: 8px; background: var(--lbcw-bg-soft);
				border: 1px dashed var(--lbcw-border); font-size: 13px; color: var(--lbcw-muted); line-height: 1.45;
			}
			@media (max-width: 520px) {
				#${ROOT_ID} .lbcw-weight { grid-template-columns: 1fr 62px 46px; }
				#${ROOT_ID} .lbcw-weight input[type="range"] { grid-column: 1 / -1; grid-row: 2; }
				#${ROOT_ID} .lbcw-rank .lbcw-s { width: 96px; }
			}
			@media (prefers-reduced-motion: reduce) {
				#${ROOT_ID} .lbcw-drawer, #${ROOT_ID} .lbcw-launcher, #${ROOT_ID} .lbcw-bar > i { transition: none; }
			}
		`)
	}

	// ═══════════════════════════════════════════════════════════════════
	//  UI
	// ═══════════════════════════════════════════════════════════════════

	const ui = {} // element refs, filled in by buildUI()

	// Page-derived text always goes through textContent, never innerHTML.
	function el(tag, props, ...children) {
		const node = document.createElement(tag)
		for (const [key, value] of Object.entries(props || {})) {
			if (value == null || value === false) continue
			if (key === 'class') node.className = value
			else if (key === 'text') node.textContent = value
			else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
			else node.setAttribute(key, value === true ? '' : value)
		}
		for (const child of children.flat()) {
			if (child != null) node.append(child)
		}
		return node
	}

	function setOpen(open) {
		state.open = open
		ui.drawer.classList.toggle('lbcw-open', open)
		ui.drawer.setAttribute('aria-hidden', String(!open))
		ui.launcher.setAttribute('aria-expanded', String(open))
		if (open) refreshBoard(true)
	}

	// ── Profile controls ────────────────────────────────────────────────

	function renderProfileControls() {
		const dirty = isDirty()
		const custom = isCustomProfile(state.active)

		ui.select.replaceChildren(
			el(
				'optgroup',
				{ label: 'Built-in' },
				BUILTIN_PROFILES.map(p => el('option', { value: p.name, text: p.name }))
			),
			Object.keys(state.profiles).length
				? el(
						'optgroup',
						{ label: 'Your profiles' },
						Object.keys(state.profiles).map(n => el('option', { value: n, text: n }))
					)
				: null
		)
		ui.select.value = state.active

		ui.dirty.hidden = !dirty
		ui.profileNote.textContent = custom
			? 'One of your own profiles.'
			: builtinProfile(state.active)?.note || ''
		ui.saveBtn.disabled = !(custom && dirty)
		ui.saveBtn.textContent = custom ? `💾 Save changes to “${state.active}”` : '💾 Save changes'
		ui.revertBtn.disabled = !dirty
		ui.deleteBtn.disabled = !custom
	}

	function onProfileSelected() {
		const next = ui.select.value
		if (next === state.active) return
		if (isDirty() && !window.confirm('Discard your unsaved weight changes?')) {
			ui.select.value = state.active
			return
		}
		state.active = next
		state.weights = clone(savedWeights(next))
		saveState()
		setNotice('')
		renderWeights()
		updateDerived()
	}

	function onSaveChanges() {
		if (!isCustomProfile(state.active)) return
		state.profiles[state.active] = clone(state.weights)
		const ok = saveProfiles()
		saveState()
		setNotice(
			ok ? `Saved changes to “${state.active}”.` : 'Couldn’t save — browser storage is unavailable.',
			ok ? 'ok' : 'error'
		)
		updateDerived()
	}

	function onRevert() {
		state.weights = clone(savedWeights(state.active))
		saveState()
		setNotice('')
		renderWeights()
		updateDerived()
	}

	function onDelete() {
		const name = state.active
		if (!isCustomProfile(name)) return
		if (!window.confirm(`Delete the profile “${name}”? This can’t be undone.`)) return
		delete state.profiles[name]
		saveProfiles()
		state.active = DEFAULT_PROFILE_NAME
		state.weights = clone(savedWeights(state.active))
		saveState()
		setNotice(`Deleted “${name}”.`, 'ok')
		renderWeights()
		updateDerived()
	}

	function onSaveAsNew() {
		const check = validateProfileName(
			ui.newName.value,
			Object.keys(state.profiles),
			BUILTIN_PROFILES.map(p => p.name)
		)
		if (!check.ok) {
			setNotice(check.error, 'error')
			return
		}
		state.profiles[check.name] = clone(state.weights)
		if (!saveProfiles()) {
			delete state.profiles[check.name]
			setNotice('Couldn’t save — browser storage is unavailable.', 'error')
			return
		}
		state.active = check.name
		saveState()
		ui.newName.value = ''
		setNotice(`Saved as “${check.name}”.`, 'ok')
		updateDerived()
	}

	function setNotice(message, kind) {
		ui.notice.textContent = message || ''
		ui.notice.className = kind === 'error' ? 'lbcw-error' : kind === 'ok' ? 'lbcw-ok' : 'lbcw-hint'
		ui.notice.hidden = !message
	}

	// ── Weight sliders ──────────────────────────────────────────────────

	const weightRows = new Map() // key → { range, num, share } for suites and parts
	const suiteRows = new Map() // suite key → { summary, reset, parts } for the part lists

	// One slider + number box for a weight, kept in step with each other.
	// Returns the row's grid cells: name, slider, number, share.
	function weightRow(key, label, extra) {
		const value = weightOf(state.weights, key)
		const range = el('input', {
			type: 'range',
			min: 0,
			max: 5,
			step: WEIGHT_STEP,
			value: Math.min(value, 5),
			'aria-label': `${label} weight`,
		})
		const num = el('input', {
			type: 'number',
			class: 'lbcw-num',
			min: 0,
			max: MAX_WEIGHT,
			step: WEIGHT_STEP,
			value,
			'aria-label': `${label} weight (number)`,
		})
		const share = el('span', { class: 'lbcw-share' })
		weightRows.set(key, { range, num, share })

		range.addEventListener('input', () => {
			setWeight(key, range.value)
			num.value = formatWeight(weightOf(state.weights, key))
		})
		num.addEventListener('input', () => {
			if (num.value.trim() === '' || !Number.isFinite(parseFloat(num.value))) return
			setWeight(key, num.value)
			range.value = Math.min(weightOf(state.weights, key), 5)
		})
		// Snap a typed value back into range once the field loses focus.
		num.addEventListener('change', () => {
			num.value = formatWeight(weightOf(state.weights, key))
		})

		return el(
			'div',
			{ class: extra ? 'lbcw-weight lbcw-part' : 'lbcw-weight' },
			el('span', { class: 'lbcw-weight-name' }, label, extra ? el('span', { class: 'lbcw-tasks', text: ` (${extra})` }) : null),
			range,
			num,
			share
		)
	}

	// Writes the sliders back from the stored weights (after a bulk change).
	function syncWeightControls() {
		for (const [key, row] of weightRows) {
			const w = weightOf(state.weights, key)
			row.num.value = formatWeight(w)
			row.range.value = Math.min(w, 5)
		}
	}

	function resetSuiteParts(col) {
		for (const p of col.parts) delete state.weights[p.key]
		saveState()
		syncWeightControls()
		updateDerived()
	}

	// The part sliders under one suite, collapsed until you want them.
	function partsSection(col) {
		const summary = el('summary', { class: 'lbcw-parts-summary' })
		const reset = el('button', {
			class: 'lbcw-btn lbcw-btn-small',
			type: 'button',
			onclick: () => resetSuiteParts(col),
			text: '↺ Reset parts to ×1',
		})
		const details = el(
			'details',
			{ class: 'lbcw-parts', open: state.openSuites.has(col.key) },
			summary,
			col.parts.map(p => weightRow(p.key, p.label, p.tasks)),
			el('div', { class: 'lbcw-parts-foot' }, reset)
		)
		details.addEventListener('toggle', () => {
			if (details.open) state.openSuites.add(col.key)
			else state.openSuites.delete(col.key)
		})
		suiteRows.set(col.key, { summary, reset })
		return details
	}

	// Rebuilds the sliders for the table the site is showing now: a slider
	// per suite (each with its parts underneath when known), or a slider per
	// part when a category is selected.
	function renderWeights() {
		weightRows.clear()
		suiteRows.clear()
		const board = state.board
		if (!board) {
			ui.weightsHost.replaceChildren()
			return
		}
		if (board.kind === 'parts') {
			ui.weightsHost.replaceChildren(...board.columns.map(c => weightRow(c.key, c.label, c.tasks)))
			return
		}
		ui.weightsHost.replaceChildren(
			...board.columns.map(col =>
				el('div', { class: 'lbcw-suite' }, weightRow(col.key, col.label), col.parts ? partsSection(col) : null)
			)
		)
	}

	function setWeight(key, raw) {
		state.weights[key] = clampWeight(raw, weightOf(state.weights, key))
		saveState()
		updateDerived()
	}

	// ── Ranking ─────────────────────────────────────────────────────────

	function renderRanking() {
		const board = state.board
		if (!board) {
			ui.rankHost.replaceChildren(
				el('div', {
					class: 'lbcw-empty',
					text: 'No leaderboard on screen. Open the Leaderboard on livebench.ai and your ranking will appear here.',
				})
			)
			return
		}

		const ranked = rankModels(board.models, state.weights)
		const showMoves = board.hasOverall

		const head = el(
			'tr',
			null,
			el('th', { text: '#' }),
			el('th', { text: 'Model' }),
			el('th', { text: 'Your score' }),
			showMoves ? el('th', { class: 'lbcw-d', text: 'vs site' }) : null
		)
		const body = ranked.map(m => {
			const move = describeMove(m.delta)
			return el(
				'tr',
				null,
				el('td', { class: 'lbcw-r', text: m.rank == null ? '–' : String(m.rank) }),
				el('td', { class: 'lbcw-m', text: m.name }),
				el(
					'td',
					{ class: 'lbcw-s' },
					m.score == null
						? el('span', { class: 'lbcw-none', text: 'no score' })
						: el(
								'div',
								{ class: 'lbcw-score' },
								el('span', { class: 'lbcw-score-num', text: m.score.toFixed(1) }),
								el('span', { class: 'lbcw-bar' }, el('i', { style: `width:${Math.max(0, Math.min(100, m.score))}%` }))
							)
				),
				showMoves ? el('td', { class: `lbcw-d lbcw-${move.dir}`, text: move.text }) : null
			)
		})

		ui.rankHost.replaceChildren(
			el('table', { class: 'lbcw-rank' }, el('thead', null, head), el('tbody', null, body))
		)
	}

	// Refreshes everything that depends on the weights, without rebuilding
	// the sliders (so dragging one doesn't lose focus).
	function formatShare(pct) {
		return `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%`
	}

	function setShare(key, pct) {
		const row = weightRows.get(key)
		if (row) row.share.textContent = formatShare(pct)
	}

	// Words that depend on what the site is showing: suites, or the parts of
	// one suite.
	function describeView(board) {
		if (board.kind === 'parts') {
			return {
				heading: `How much should each part of ${board.suiteLabel} count?`,
				hint: '×1 counts a part the way the site does (by how many tasks it has). 0 leaves it out. The score starts from the site’s own number and shifts with your part weights.',
				note: `These are the same part weights you’ll find under ${board.suiteLabel} on the all-suites view.`,
			}
		}
		const notes = {
			loading: 'Loading the scores underneath each suite…',
			none: 'This release has no part scores, so only suite weights apply.',
			ready:
				board.unmatched > 0
					? `${board.unmatched} model${board.unmatched === 1 ? '' : 's'} couldn’t be matched to part scores, so part weights don’t change ${board.unmatched === 1 ? 'its' : 'their'} score.`
					: '',
		}
		return {
			heading: 'How much should each suite count?',
			hint: '0 leaves a suite out, and a model missing a suite is scored on the ones it has. Open a suite to weight its parts: ×1 counts a part the way the site does, and the suite’s score starts from the site’s own number and shifts with your part weights.',
			note: notes[board.partsStatus] ?? '',
		}
	}

	function updateDerived() {
		renderProfileControls()
		const board = state.board
		if (board) {
			const words = describeView(board)
			ui.weightsHeading.textContent = words.heading
			ui.weightsHint.textContent = words.hint
			ui.partsNote.textContent = words.note
			ui.partsNote.hidden = !words.note

			if (board.kind === 'parts') {
				const shares = partShares(board.columns, state.weights)
				for (const c of board.columns) setShare(c.key, shares.get(c.key) ?? 0)
				ui.formula.textContent = describePartChanges(board, state.weights)
			} else {
				const shares = weightShares(
					board.columns.map(c => c.key),
					state.weights
				)
				for (const col of board.columns) {
					setShare(col.key, shares.get(col.key) ?? 0)
					if (!col.parts) continue
					const partPct = partShares(col.parts, state.weights)
					for (const p of col.parts) setShare(p.key, partPct.get(p.key) ?? 0)
					const changed = changedParts(col.parts, state.weights).length
					const row = suiteRows.get(col.key)
					if (row) {
						row.summary.textContent =
							`Adjust ${col.parts.length} parts` + (changed > 0 ? ` · ${changed} changed` : '')
						row.reset.disabled = changed === 0
					}
				}
				const changes = describePartChanges(board, state.weights)
				ui.formula.textContent =
					describeFormula(board.columns, state.weights) + (changes ? `\n${changes}` : '')
			}
			ui.formula.hidden = false
		} else {
			ui.formula.hidden = true
			ui.partsNote.hidden = true
		}
		renderRanking()
	}

	// ── Build ───────────────────────────────────────────────────────────

	function buildUI() {
		ui.launcher = el('button', {
			class: 'lbcw-launcher',
			type: 'button',
			'aria-expanded': 'false',
			onclick: () => setOpen(!state.open),
			text: '⚖ Custom weights',
		})

		ui.select = el('select', {
			class: 'lbcw-select',
			'aria-label': 'Weight profile',
			onchange: onProfileSelected,
		})
		ui.dirty = el('span', { class: 'lbcw-dirty', text: '● Unsaved changes', hidden: true })
		ui.profileNote = el('p', { class: 'lbcw-hint' })
		ui.saveBtn = el('button', {
			class: 'lbcw-btn lbcw-btn-primary',
			type: 'button',
			onclick: onSaveChanges,
			text: '💾 Save changes',
		})
		ui.revertBtn = el('button', {
			class: 'lbcw-btn',
			type: 'button',
			onclick: onRevert,
			text: '↺ Undo edits',
		})
		ui.deleteBtn = el('button', {
			class: 'lbcw-btn lbcw-btn-danger',
			type: 'button',
			onclick: onDelete,
			text: '🗑 Delete profile',
		})
		ui.newName = el('input', {
			class: 'lbcw-text',
			type: 'text',
			maxlength: MAX_NAME_LENGTH,
			placeholder: 'Name for a new profile…',
			'aria-label': 'New profile name',
			onkeydown: e => {
				if (e.key === 'Enter') onSaveAsNew()
			},
		})
		ui.notice = el('p', { class: 'lbcw-hint', hidden: true })
		ui.weightsHeading = el('h3', { class: 'lbcw-label', text: 'How much should each suite count?' })
		ui.weightsHost = el('div')
		ui.formula = el('p', { class: 'lbcw-formula', hidden: true })
		ui.weightsHint = el('p', { class: 'lbcw-hint' })
		ui.partsNote = el('p', { class: 'lbcw-hint lbcw-note', hidden: true })
		ui.rankHost = el('div')

		ui.drawer = el(
			'aside',
			{ class: 'lbcw-drawer', role: 'dialog', 'aria-label': 'Custom score weights', 'aria-hidden': 'true' },
			el(
				'div',
				{ class: 'lbcw-head' },
				el('h2', { class: 'lbcw-title', text: '⚖ Custom score weights' }),
				el('button', { class: 'lbcw-btn', type: 'button', onclick: () => setOpen(false), text: '✕ Close' })
			),
			el(
				'div',
				{ class: 'lbcw-body' },
				el(
					'section',
					{ class: 'lbcw-section' },
					el('h3', { class: 'lbcw-label', text: 'Profile' }),
					el('div', { class: 'lbcw-row' }, ui.select, ui.dirty),
					ui.profileNote,
					el('div', { class: 'lbcw-row' }, ui.saveBtn, ui.revertBtn, ui.deleteBtn),
					el('div', { class: 'lbcw-row' }, ui.newName, el('button', {
						class: 'lbcw-btn',
						type: 'button',
						onclick: onSaveAsNew,
						text: '＋ Save as new profile',
					})),
					ui.notice
				),
				el(
					'section',
					{ class: 'lbcw-section' },
					ui.weightsHeading,
					ui.weightsHost,
					ui.formula,
					ui.weightsHint,
					ui.partsNote
				),
				el(
					'section',
					{ class: 'lbcw-section' },
					el('h3', { class: 'lbcw-label', text: 'Your ranking' }),
					ui.rankHost,
					el('p', {
						class: 'lbcw-hint',
						text: 'Ranks the models the leaderboard is showing now, so the site’s search, organization and release choices carry through.',
					})
				)
			)
		)

		const root = el('div', { id: ROOT_ID }, ui.launcher, ui.drawer)
		document.body.append(root)
		ui.root = root

		document.addEventListener('keydown', e => {
			if (e.key === 'Escape' && state.open) setOpen(false)
		})
	}

	// ═══════════════════════════════════════════════════════════════════
	//  PAGE WATCHING
	// ═══════════════════════════════════════════════════════════════════

	// Re-reads the leaderboard and refreshes the panel if anything in it
	// changed. `force` skips the "nothing changed" shortcut (used on open).
	function refreshBoard(force) {
		if (!state.open) return
		const raw = readLeaderboard()
		const sig = `${rawSignature(raw)}#${raw?.release ? releaseData.get(raw.release)?.status : ''}`
		if (!force && sig === state.boardSig) return
		state.raw = raw
		state.boardSig = sig
		if (raw) ensureReleaseData(raw.release)
		const board = raw ? composeBoard(raw) : null
		state.board = board

		const columnsSig = boardSignature(board)
		if (force || columnsSig !== state.columnsSig) {
			state.columnsSig = columnsSig
			renderWeights()
		}
		updateDerived()
	}

	let refreshTimer = null
	function watchPage() {
		const observer = new MutationObserver(mutations => {
			if (!state.open) return
			// Ignore our own panel's updates.
			if (mutations.every(m => ui.root.contains(m.target))) return
			clearTimeout(refreshTimer)
			refreshTimer = setTimeout(() => refreshBoard(false), REFRESH_DEBOUNCE_MS)
		})
		observer.observe(document.body, { childList: true, subtree: true, characterData: true })
	}

	// ═══════════════════════════════════════════════════════════════════
	//  INIT
	// ═══════════════════════════════════════════════════════════════════

	function init() {
		checkForUpdate()
		loadState()
		injectStyles()
		buildUI()
		renderProfileControls()
		watchPage()
		log(`v${SCRIPT_VERSION} ready — ${Object.keys(state.profiles).length} saved profile(s).`)
	}

	init()
})()
