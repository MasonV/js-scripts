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

	const stateStart = src.indexOf('const STATE_BADGE_SELECTORS =')
	const stateEnd = src.indexOf('\t\t/**\n\t\t * Classifies a tile', stateStart)
	assert.ok(stateStart !== -1 && stateEnd !== -1, 'detectStateFromText block not found')
	const stateSlice = src.slice(stateStart, stateEnd)

	const evalStart = src.indexOf('function evaluateTile(')
	const evalEnd = src.indexOf('\t\t// ── Application', evalStart)
	assert.ok(evalStart !== -1 && evalEnd !== -1, 'evaluateTile block not found')
	const evalSlice = src.slice(evalStart, evalEnd)

	const factory = new Function(`
		"use strict";
		${cloneSlice}
		${parserSlice}
		${stateSlice}
		${evalSlice}
		return {
			structuredCloneCompat,
			parseDuration,
			formatDuration,
			parseDurationField,
			validateDurationPair,
			classifyStateText,
			detectStateFromText,
			evaluateTile,
		};
	`)
	return factory()
}

const {
	structuredCloneCompat,
	parseDuration,
	formatDuration,
	parseDurationField,
	validateDurationPair,
	classifyStateText,
	detectStateFromText,
	evaluateTile,
} = loadYourTubeLogic()

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

describe('classifyStateText and detectStateFromText', () => {
	// Lightweight mock tile helper that simulates tile.querySelectorAll(STATE_BADGE_SELECTORS)
	// while keeping title/channel elements separate unless nested inside a container.
	function makeMockTile({ title = '', channel = '', badges = [], nestedTitleInOverlay = false } = {}) {
		const badgeNodes = badges.map((b) => {
			if (typeof b === 'string') {
				return {
					textContent: b,
					matches: () => false,
					closest: () => null,
				}
			}
			return {
				textContent: b.text || '',
				matches: (sel) => Boolean(b.isExcluded && sel.includes('#video-title')),
				closest: (sel) => (b.insideExcluded && sel.includes('#channel-name') ? {} : null),
			}
		})

		if (nestedTitleInOverlay && title) {
			badgeNodes.push({
				textContent: `${title} ${badges.join(' ')}`,
				matches: () => false,
				closest: () => null,
				querySelectorAll: () => [],
				cloneNode: () => ({
					textContent: `${title} ${badges.join(' ')}`,
					querySelectorAll: () => [
						{
							remove() {
								this._removed = true
							},
						},
					],
				}),
			})
		}

		return {
			// Full tile textContent includes title + channel + badges, just like a real DOM tile
			textContent: [title, channel, ...badges.map((b) => (typeof b === 'string' ? b : b.text))].join(' '),
			querySelectorAll(selector) {
				if (selector.includes('ytd-thumbnail-overlay-time-status-renderer')) {
					return badgeNodes
				}
				return []
			},
		}
	}

	test('does not false-positive on video titles or channel names containing state keywords', () => {
		const falsePositiveTiles = [
			makeMockTile({
				title: 'Adobe Premiere Pro Tutorial for Beginners',
				channel: 'Video Editing 101',
				badges: ['14K views', '2 hours ago'],
			}),
			makeMockTile({
				title: 'Live Concert at Red Rocks Amphitheatre',
				channel: 'Indie Sessions',
				badges: ['85K views', '1 day ago'],
			}),
			makeMockTile({
				title: 'Summer Shorts Haul & Try-On',
				channel: 'Style Daily',
				badges: ['5K views', '3 days ago'],
			}),
			makeMockTile({
				title: 'Upcoming Marvel Movies Breakdown',
				channel: 'Live Film Talk',
				badges: ['120K views', '5 hours ago'],
			}),
			makeMockTile({
				title: 'Normal Tutorial Video',
				channel: 'Premiere & Shorts Studio',
				badges: [],
			}),
		]

		for (const tile of falsePositiveTiles) {
			assert.equal(
				detectStateFromText(tile),
				null,
				`Expected null for tile with text "${tile.textContent}"`,
			)
		}
	})

	test('detects genuine live, premiere, upcoming, and shorts badges or metadata', () => {
		assert.equal(
			detectStateFromText(
				makeMockTile({
					title: 'Saturday Gaming Stream',
					channel: 'Gamer',
					badges: ['LIVE'],
				}),
			),
			'live',
		)
		assert.equal(
			detectStateFromText(
				makeMockTile({
					title: 'Album Launch',
					channel: 'Artist',
					badges: ['Premieres 12/25/25, 5:00 PM'],
				}),
			),
			'premiere',
		)
		assert.equal(
			detectStateFromText(
				makeMockTile({
					title: 'Q&A Session',
					channel: 'Creator',
					badges: ['UPCOMING'],
				}),
			),
			'premiere',
		)
		assert.equal(
			detectStateFromText(
				makeMockTile({
					title: 'Quick Tip',
					channel: 'Creator',
					badges: ['SHORTS'],
				}),
			),
			'short',
		)
	})

	test('skips badge nodes inside excluded title or channel containers and ignores "Streamed live"', () => {
		const tileWithChannelBadge = makeMockTile({
			title: 'Regular Video',
			channel: 'Live Nation',
			badges: [{ text: 'LIVE', insideExcluded: true }],
		})
		assert.equal(detectStateFromText(tileWithChannelBadge), null)

		const pastStreamTile = makeMockTile({
			title: 'Archived Coding Session',
			channel: 'Dev',
			badges: ['50K views', 'Streamed live 2 days ago'],
		})
		assert.equal(detectStateFromText(pastStreamTile), null)
		assert.equal(classifyStateText('Streamed live 3 hours ago'), null)
	})
})

describe('validateDurationPair', () => {
	test('flags shorterThan > longerThan on both fields and clears both when either input becomes valid', () => {
		// Initial range conflict: 20m > 10m
		const conflict = validateDurationPair('20m', '10m')
		assert.equal(conflict.ok, false)
		assert.equal(conflict.rangeError, true)
		assert.equal(conflict.shorter.status, 'error')
		assert.equal(conflict.longer.status, 'error')
		assert.equal(conflict.longer.message, 'must be \u2265 minimum duration')

		// Editing shorterInput down to 5m clears the error on BOTH shorter and longer
		const fixedShorter = validateDurationPair('5m', '10m')
		assert.equal(fixedShorter.ok, true)
		assert.equal(fixedShorter.rangeError, false)
		assert.equal(fixedShorter.shorter.status, 'valid')
		assert.equal(fixedShorter.longer.status, 'valid')
		assert.equal(fixedShorter.longer.message, '= 10 minutes')

		// Clearing shorterInput also clears the range error on longer
		const clearedShorter = validateDurationPair('', '10m')
		assert.equal(clearedShorter.ok, true)
		assert.equal(clearedShorter.rangeError, false)
		assert.equal(clearedShorter.shorter.status, 'empty')
		assert.equal(clearedShorter.longer.status, 'valid')
		assert.equal(clearedShorter.longer.message, '= 10 minutes')

		// Parse error on shorterInput only highlights shorterInput, not longerInput
		const badShorter = validateDurationPair('invalid', '10m')
		assert.equal(badShorter.ok, false)
		assert.equal(badShorter.rangeError, false)
		assert.equal(badShorter.shorter.status, 'error')
		assert.equal(badShorter.longer.status, 'valid')
	})
})
