// Unit tests for YTM Data Panel pure parsing and formatting functions.
// Slices pure functions directly from ytm-data-panel.user.js and evaluates them with new Function.
// Run with: node --test ytm-data-panel/logic.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadYtmDataPanelLogic() {
	const src = fs.readFileSync(path.join(__dirname, 'ytm-data-panel.user.js'), 'utf8')

	const extractStart = src.indexOf('function extractTrackData(')
	const extractEnd = src.indexOf('\t/**\n\t * Retry loop', extractStart)
	assert.ok(extractStart !== -1 && extractEnd !== -1, 'extractTrackData block not found')
	const extractSlice = src.slice(extractStart, extractEnd)

	const chaptersHeader = src.indexOf('//  CHAPTER PARSING')
	assert.ok(chaptersHeader !== -1, 'CHAPTER PARSING section header not found')
	const chaptersStart = src.indexOf('═\n', chaptersHeader) + 2
	const stylesHeader = src.indexOf('//  UI — STYLES', chaptersStart)
	const stylesSectionStart = src.lastIndexOf('// ════', stylesHeader)
	assert.ok(stylesSectionStart !== -1, 'UI — STYLES section header not found')
	const pureSlice = src.slice(chaptersStart, stylesSectionStart)

	const factory = new Function(`
		"use strict";
		${extractSlice}
		${pureSlice}
		return {
			extractTrackData,
			parseChapters,
			timestampToSeconds,
			formatViewCount,
			formatLength,
			formatPublishDate,
		};
	`)
	return factory()
}

const {
	extractTrackData,
	parseChapters,
	timestampToSeconds,
	formatViewCount,
	formatLength,
	formatPublishDate,
} = loadYtmDataPanelLogic()

describe('timestampToSeconds', () => {
	test('converts M:SS and H:MM:SS timestamps to seconds', () => {
		assert.equal(timestampToSeconds('0:00'), 0)
		assert.equal(timestampToSeconds('04:30'), 270)
		assert.equal(timestampToSeconds('1:02:03'), 3723)
	})

	test('returns null for invalid timestamps', () => {
		assert.equal(timestampToSeconds('10'), null)
		assert.equal(timestampToSeconds('1:2:3:4'), null)
		assert.equal(timestampToSeconds('xx:yy'), null)
	})
})

describe('parseChapters', () => {
	test('extracts and sorts valid chapter lists starting at 0:00', () => {
		const desc = [
			'Tracklist:',
			'• 2:15 Chorus',
			'0:00 Intro',
			'- 1:02:05 - Finale',
		].join('\n')
		assert.deepEqual(parseChapters(desc), [
			{ startSeconds: 0, timestamp: '0:00', title: 'Intro' },
			{ startSeconds: 135, timestamp: '2:15', title: 'Chorus' },
			{ startSeconds: 3725, timestamp: '1:02:05', title: 'Finale' },
		])
	})

	test('requires at least two chapters and first chapter at 0:00', () => {
		assert.deepEqual(parseChapters(''), [])
		assert.deepEqual(parseChapters(null), [])
		assert.deepEqual(parseChapters('0:00 Only One'), [])
		assert.deepEqual(parseChapters('0:15 Not Zero\n1:30 Second'), [])
		assert.deepEqual(parseChapters('0:00\n1:00 Valid Title'), [])
	})
})

describe('formatViewCount & formatLength', () => {
	test('formats view counts and falls back to em-dash on non-positive/invalid values', () => {
		assert.equal(formatViewCount(0), '—')
		assert.equal(formatViewCount(-5), '—')
		assert.equal(formatViewCount(NaN), '—')
		assert.equal(formatViewCount(1234567), '1,234,567 views')
	})

	test('formats track lengths as M:SS or H:MM:SS', () => {
		assert.equal(formatLength(0), '—')
		assert.equal(formatLength(-10), '—')
		assert.equal(formatLength(NaN), '—')
		assert.equal(formatLength(65), '1:05')
		assert.equal(formatLength(3665), '1:01:05')
	})
})

describe('formatPublishDate', () => {
	test('formats ISO dates in UTC without local-timezone off-by-one shifts', () => {
		assert.equal(formatPublishDate(''), '—')
		assert.equal(formatPublishDate(null), '—')
		assert.equal(formatPublishDate('2020-05-15'), 'May 15, 2020')
		assert.equal(formatPublishDate('2024-01-01T00:00:00Z'), 'Jan 1, 2024')
		assert.equal(formatPublishDate('not-a-date'), 'not-a-date')
	})
})

describe('extractTrackData', () => {
	test('extracts metadata when videoId matches expectedVideoId', () => {
		const resp = {
			videoDetails: {
				videoId: 'abc123',
				title: 'Test Track',
				author: 'Test Artist',
				lengthSeconds: '215',
				viewCount: '9876',
				keywords: ['rock', 'indie'],
				shortDescription: '0:00 Intro\n1:00 Main',
			},
			microformat: {
				playerMicroformatRenderer: {
					category: 'Music',
					publishDate: '2024-07-04',
				},
			},
		}
		assert.deepEqual(extractTrackData(resp, 'abc123'), {
			videoId: 'abc123',
			title: 'Test Track',
			author: 'Test Artist',
			lengthSeconds: 215,
			viewCount: 9876,
			keywords: ['rock', 'indie'],
			category: 'Music',
			publishDate: '2024-07-04',
			description: '0:00 Intro\n1:00 Main',
		})
	})

	test('rejects missing responses or mismatched videoIds', () => {
		assert.equal(extractTrackData(null, 'abc123'), null)
		assert.equal(extractTrackData({}, 'abc123'), null)
		assert.equal(
			extractTrackData({ videoDetails: { videoId: 'old_id', title: 'Old' } }, 'new_id'),
			null,
		)
	})
})
