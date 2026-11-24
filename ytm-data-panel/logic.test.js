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

	test('rejects missing responses, missing videoIds, or mismatched videoIds', () => {
		assert.equal(extractTrackData(null, 'abc123'), null)
		assert.equal(extractTrackData({}, 'abc123'), null)
		assert.equal(extractTrackData({ videoDetails: {} }, 'abc123'), null)
		assert.equal(extractTrackData({ videoDetails: { videoId: '' } }, 'abc123'), null)
		assert.equal(extractTrackData({ videoDetails: {} }), null)
		assert.equal(extractTrackData({ videoDetails: { videoId: '' } }), null)
		assert.equal(
			extractTrackData({ videoDetails: { videoId: 'old_id', title: 'Old' } }, 'new_id'),
			null,
		)
	})

	test('extracts metadata when videoId is present and expectedVideoId is omitted', () => {
		const data = extractTrackData({
			videoDetails: { videoId: 'abc123', title: 'Direct Track' },
		})
		assert.equal(data.videoId, 'abc123')
		assert.equal(data.title, 'Direct Track')
	})
})

function loadRouteHarness(env) {
	const src = fs.readFileSync(path.join(__dirname, 'ytm-data-panel.user.js'), 'utf8')

	const extractStart = src.indexOf('function extractTrackData(')
	const chaptersHeader = src.indexOf('//  CHAPTER PARSING')
	const chaptersSectionStart = src.lastIndexOf('// ════', chaptersHeader)
	assert.ok(extractStart !== -1 && chaptersSectionStart !== -1, 'data extraction slice not found')
	const dataSlice = src.slice(extractStart, chaptersSectionStart)

	const routeHeader = src.indexOf('//  ROUTE HANDLING')
	const routeStart = src.indexOf('═\n', routeHeader) + 2
	const initHeader = src.indexOf('//  INIT', routeStart)
	const initSectionStart = src.lastIndexOf('// ════', initHeader)
	assert.ok(routeHeader !== -1 && initSectionStart !== -1, 'route handling slice not found')
	const routeSlice = src.slice(routeStart, initSectionStart)

	const factory = new Function(
		'env',
		`
		"use strict";
		const PANEL_ID = 'ytmdp-panel';
		const STALE_RETRY_LIMIT = env.STALE_RETRY_LIMIT ?? 15;
		const STALE_RETRY_DELAY_MS = env.STALE_RETRY_DELAY_MS ?? 100;
		const warn = (...args) => env.warnings.push(args.join(' '));
		const getVideoIdFromUrl = () => env.getVideoIdFromUrl();
		const readPlayerResponse = (id) => env.readPlayerResponse(id);
		const mountPanel = (data) => env.mountPanel(data);
		const removePanel = () => env.removePanel();
		const window = env.window;
		const document = env.document;
		const setTimeout = env.setTimeout;
		const clearTimeout = env.clearTimeout;
		${dataSlice}
		${routeSlice}
		return { handleRoute, fetchTrackDataForCurrentUrl };
		`,
	)
	return factory(env)
}

describe('handleRoute & retry cancellation', () => {
	test('cancels superseded retry timers without extra polling or timeout warnings', async () => {
		let nextTimerId = 1
		const timers = new Map()
		const cleared = []
		const mounted = []
		const warnings = []
		let panelMounted = false
		let currentVideoId = 'v1'
		let playerResponse = { videoDetails: {} }

		const harness = loadRouteHarness({
			STALE_RETRY_LIMIT: 3,
			STALE_RETRY_DELAY_MS: 100,
			warnings,
			window: { location: { pathname: '/watch' } },
			document: {
				getElementById: () => (panelMounted ? {} : null),
			},
			getVideoIdFromUrl: () => currentVideoId,
			readPlayerResponse: () => playerResponse,
			mountPanel: (data) => {
				panelMounted = true
				mounted.push(data)
			},
			removePanel: () => {
				panelMounted = false
			},
			setTimeout: (fn) => {
				const id = nextTimerId++
				timers.set(id, fn)
				return id
			},
			clearTimeout: (id) => {
				cleared.push(id)
				timers.delete(id)
			},
		})

		const firstRoute = harness.handleRoute()
		assert.equal(timers.size, 1, 'should schedule first retry timer for empty shell')

		// Supersede with a new route that has populated track metadata.
		currentVideoId = 'v2'
		playerResponse = { videoDetails: { videoId: 'v2', title: 'Second Track' } }
		const secondRoute = harness.handleRoute()

		await Promise.all([firstRoute, secondRoute])
		assert.equal(cleared.length, 1, 'superseded retry timer should be cleared')
		assert.equal(timers.size, 0, 'no dangling timers should remain')
		assert.equal(warnings.length, 0, 'should not log stale timeout warning')
		assert.equal(mounted.length, 1)
		assert.equal(mounted[0].videoId, 'v2')
		assert.equal(mounted[0].title, 'Second Track')
	})

	test('re-renders when panel is detached or metadata becomes populated, and skips identical re-renders', async () => {
		let panelMounted = false
		const mounted = []
		let playerResponse = { videoDetails: { videoId: 'abc123', title: '' } }

		const harness = loadRouteHarness({
			warnings: [],
			window: { location: { pathname: '/watch' } },
			document: {
				getElementById: () => (panelMounted ? {} : null),
			},
			getVideoIdFromUrl: () => 'abc123',
			readPlayerResponse: () => playerResponse,
			mountPanel: (data) => {
				panelMounted = true
				mounted.push(data)
			},
			removePanel: () => {
				panelMounted = false
			},
			setTimeout: globalThis.setTimeout,
			clearTimeout: globalThis.clearTimeout,
		})

		await harness.handleRoute()
		assert.equal(mounted.length, 1)

		// Identical track data while panel is still mounted should be skipped.
		await harness.handleRoute()
		assert.equal(mounted.length, 1)

		// Metadata populated for the same videoId should trigger a re-render.
		playerResponse = { videoDetails: { videoId: 'abc123', title: 'Populated Title' } }
		await harness.handleRoute()
		assert.equal(mounted.length, 2)
		assert.equal(mounted[1].title, 'Populated Title')

		// Detached panel should re-render even with identical track data.
		panelMounted = false
		await harness.handleRoute()
		assert.equal(mounted.length, 3)
	})
})
