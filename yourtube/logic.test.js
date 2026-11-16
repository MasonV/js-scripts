// Unit tests for YourTube pure functions.
// Slices pure functions directly from yourtube.user.js and evaluates them with new Function.
// Run with: node --test yourtube/logic.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadYourTubeLogic() {
	const src = fs.readFileSync(path.join(__dirname, 'yourtube.user.js'), 'utf8')

	const cloneStart = src.indexOf('function structuredCloneCompat')
	const cloneEnd = src.indexOf('\t// GM_addStyle', cloneStart)
	assert.ok(cloneStart !== -1 && cloneEnd !== -1, 'structuredCloneCompat block not found')
	const cloneSlice = src.slice(cloneStart, cloneEnd)

	const parserHeader = src.indexOf('//  TIME PARSER')
	assert.ok(parserHeader !== -1, 'TIME PARSER section header not found')
	const parserStart = src.indexOf('═\n', parserHeader) + 2
	const parserEnd = src.indexOf('// ═══════════════════════════════════════════════════════════════════', parserStart)
	assert.ok(parserEnd !== -1, 'TIME PARSER section end not found')
	const parserSlice = src.slice(parserStart, parserEnd)

	const evalStart = src.indexOf('function evaluateTile(')
	const evalEnd = src.indexOf('\t\t// ── Application', evalStart)
	assert.ok(evalStart !== -1 && evalEnd !== -1, 'evaluateTile block not found')
	const evalSlice = src.slice(evalStart, evalEnd)

	const factory = new Function(`
		"use strict";
		${cloneSlice}
		${parserSlice}
		${evalSlice}
		return { structuredCloneCompat, parseDuration, formatDuration, evaluateTile };
	`)
	return factory()
}

const { structuredCloneCompat, parseDuration, formatDuration, evaluateTile } = loadYourTubeLogic()

describe('parseDuration', () => {
	test('handles empty, null, and whitespace inputs', () => {
		assert.equal(parseDuration(null), null)
		assert.equal(parseDuration(undefined), null)
		assert.equal(parseDuration(''), null)
		assert.equal(parseDuration('   '), null)
	})

	test('parses unit-tagged durations, bare numbers, and colon notation', () => {
		const cases = [
			['5m', 300],
			['5 min', 300],
			['5 minutes', 300],
			['5:00', 300],
			['1h', 3600],
			['1h30m', 5400],
			['1h 30m', 5400],
			['1:30:00', 5400],
			['3.5m', 210],
			['3.5 minutes', 210],
			['3m 30s', 210],
			['90s', 90],
			['90 sec', 90],
			['90', 5400],
			['1:23:45', 5025],
			['12:34', 754],
			['0', 0],
			['0:45', 45],
			['2 hours 15 mins 5 secs', 8105],
		]
		for (const [input, expected] of cases) {
			assert.equal(parseDuration(input), expected, `Expected ${input} -> ${expected}`)
		}
	})

	test('returns NaN for unparseable or trailing-garbage inputs', () => {
		for (const bad of ['gibberish', '5x', '5heures', '1h 30', 'abc:def']) {
			assert.ok(Number.isNaN(parseDuration(bad)), `Expected NaN for "${bad}"`)
		}
	})
})

describe('formatDuration', () => {
	test('formats seconds into natural-language previews', () => {
		assert.equal(formatDuration(null), '')
		assert.equal(formatDuration(undefined), '')
		assert.equal(formatDuration(NaN), '')
		assert.equal(formatDuration(0), '0 seconds')
		assert.equal(formatDuration(-10), '0 seconds')
		assert.equal(formatDuration(60), '1 minute')
		assert.equal(formatDuration(90), '1 minute 30 seconds')
		assert.equal(formatDuration(300), '5 minutes')
		assert.equal(formatDuration(3600), '1 hour')
		assert.equal(formatDuration(5400), '1 hour 30 minutes')
		assert.equal(formatDuration(3661), '1 hour 1 minute 1 second')
	})
})

describe('evaluateTile', () => {
	const baseSettings = {
		shorterThan: 300,
		longerThan: 1800,
		hideShorts: false,
		hideLive: false,
		hidePremieres: false,
	}

	test('filters shorts, live streams, and premieres according to toggles', () => {
		assert.equal(evaluateTile({ kind: 'short', seconds: null }, baseSettings), true)
		assert.equal(evaluateTile({ kind: 'short', seconds: null }, { ...baseSettings, hideShorts: true }), false)

		assert.equal(evaluateTile({ kind: 'live', seconds: null }, baseSettings), true)
		assert.equal(evaluateTile({ kind: 'live', seconds: null }, { ...baseSettings, hideLive: true }), false)

		assert.equal(evaluateTile({ kind: 'premiere', seconds: null }, baseSettings), true)
		assert.equal(evaluateTile({ kind: 'premiere', seconds: null }, { ...baseSettings, hidePremieres: true }), false)
	})

	test('never hides unknown tiles', () => {
		assert.equal(
			evaluateTile(
				{ kind: 'unknown', seconds: null },
				{ shorterThan: 300, longerThan: 600, hideShorts: true, hideLive: true, hidePremieres: true },
			),
			true,
		)
	})

	test('applies exclusive shorterThan and longerThan bounds on video tiles', () => {
		assert.equal(evaluateTile({ kind: 'video', seconds: 299 }, baseSettings), false)
		assert.equal(evaluateTile({ kind: 'video', seconds: 300 }, baseSettings), true)
		assert.equal(evaluateTile({ kind: 'video', seconds: 1800 }, baseSettings), true)
		assert.equal(evaluateTile({ kind: 'video', seconds: 1801 }, baseSettings), false)
	})
})

describe('structuredCloneCompat', () => {
	test('creates a deep copy without sharing nested object references', () => {
		const original = { duration: { shorterThan: 120, hideShorts: true } }
		const copy = structuredCloneCompat(original)
		assert.deepEqual(copy, original)
		assert.notEqual(copy, original)
		assert.notEqual(copy.duration, original.duration)
		copy.duration.shorterThan = 999
		assert.equal(original.duration.shorterThan, 120)
	})

	test('falls back to JSON round-trip when structuredClone is unavailable', () => {
		const src = fs.readFileSync(path.join(__dirname, 'yourtube.user.js'), 'utf8')
		const cloneStart = src.indexOf('function structuredCloneCompat')
		const cloneEnd = src.indexOf('\t// GM_addStyle', cloneStart)
		const cloneSlice = src.slice(cloneStart, cloneEnd)
		const fn = new Function('structuredClone', `"use strict";\n${cloneSlice}\nreturn structuredCloneCompat;`)(undefined)
		const original = { a: { b: 1 } }
		const copy = fn(original)
		assert.deepEqual(copy, original)
		assert.notEqual(copy.a, original.a)
	})
})
