// Unit tests for YT Music Redirect pure functions.
// Slices the PURE LOGIC section directly from yt-music-redirect.user.js and evaluates it with new Function.
// Run with: node --test yt-music-redirect/logic.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadYtMusicRedirectLogic() {
	const src = fs.readFileSync(path.join(__dirname, 'yt-music-redirect.user.js'), 'utf8')
	const startMarker = '//  PURE LOGIC'
	const startIdx = src.indexOf(startMarker)
	assert.ok(startIdx !== -1, 'PURE LOGIC section header not found')
	const afterStart = src.indexOf('═\n', startIdx) + 2
	const nextSection = src.indexOf('// ═══════════════════════════════════════════════════════════════════', afterStart)
	assert.ok(nextSection !== -1, 'Next section header after PURE LOGIC not found')
	const slice = src.slice(afterStart, nextSection)

	const factory = new Function(`
		"use strict";
		${slice}
		return {
			getVideoId,
			extractVideoDetailsFromPlayerResponse,
			isMusicFromPlayerResponse,
			parsePlayerResponseFromHtml,
		};
	`)
	return factory()
}

const {
	getVideoId,
	extractVideoDetailsFromPlayerResponse,
	isMusicFromPlayerResponse,
	parsePlayerResponseFromHtml,
} = loadYtMusicRedirectLogic()

describe('getVideoId', () => {
	test('extracts the v query parameter from search strings', () => {
		assert.equal(getVideoId('?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
		assert.equal(getVideoId('?list=PL123&v=abc_123&t=42'), 'abc_123')
		assert.equal(getVideoId('?list=PL123'), null)
		assert.equal(getVideoId(''), null)
	})
})

describe('isMusicFromPlayerResponse & extractVideoDetailsFromPlayerResponse', () => {
	test('detects Music category from microformat or videoDetails when videoId matches', () => {
		const microformatMusic = {
			videoDetails: { videoId: 'vid1', channelId: 'ch1', author: 'Artist' },
			microformat: { playerMicroformatRenderer: { category: 'Music' } },
		}
		assert.equal(isMusicFromPlayerResponse(microformatMusic, 'vid1'), true)
		assert.deepEqual(extractVideoDetailsFromPlayerResponse(microformatMusic, 'vid1'), {
			category: 'Music',
			channelId: 'ch1',
			channelName: 'Artist',
		})

		const directCategoryMusic = {
			videoDetails: { videoId: 'vid2', category: 'Music', channelId: 'ch2', author: 'Band' },
		}
		assert.equal(isMusicFromPlayerResponse(directCategoryMusic, 'vid2'), true)
	})

	test('returns false/null for non-music videos, stale videoIds, or missing responses', () => {
		const gaming = {
			videoDetails: { videoId: 'vid1', channelId: 'ch1', author: 'Gamer' },
			microformat: { playerMicroformatRenderer: { category: 'Gaming' } },
		}
		assert.equal(isMusicFromPlayerResponse(gaming, 'vid1'), false)
		assert.equal(isMusicFromPlayerResponse({ videoDetails: { videoId: 'other', category: 'Music' } }, 'vid1'), false)
		assert.equal(extractVideoDetailsFromPlayerResponse({ videoDetails: { videoId: 'other', category: 'Music' } }, 'vid1'), null)
		assert.equal(isMusicFromPlayerResponse(null, 'vid1'), false)
	})
})

describe('parsePlayerResponseFromHtml', () => {
	test('parses category, channelId, and author from watch page HTML', () => {
		const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"channelId":"UC123","author":"Synth Artist"},"microformat":{"playerMicroformatRenderer":{"category":"Music"}}};</script>'
		assert.deepEqual(parsePlayerResponseFromHtml(html), {
			category: 'Music',
			channelId: 'UC123',
			channelName: 'Synth Artist',
		})
	})

	test('returns nulls when fields are absent', () => {
		assert.deepEqual(parsePlayerResponseFromHtml('<html></html>'), {
			category: null,
			channelId: null,
			channelName: null,
		})
		assert.deepEqual(parsePlayerResponseFromHtml(null), {
			category: null,
			channelId: null,
			channelName: null,
		})
	})
})
