// Unit tests for Auto Focus Search pure logic functions.
// Slices the PURE LOGIC section directly from auto-focus-search.user.js and evaluates it with new Function.
// Run with: node --test auto-focus-search/logic.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadAutoFocusSearchLogic() {
	const src = fs.readFileSync(path.join(__dirname, 'auto-focus-search.user.js'), 'utf8')
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
		return { describeElement, scoreCandidate, isSearchPath };
	`)
	return factory()
}

const { describeElement, scoreCandidate, isSearchPath } = loadAutoFocusSearchLogic()

describe('describeElement', () => {
	test('formats tag, id, name, and placeholder consistently', () => {
		assert.equal(
			describeElement({
				tagName: 'INPUT',
				id: 'site-search',
				name: 'q',
				placeholder: 'Search docs',
			}),
			'input#site-search[name="q"] "Search docs"',
		)
		assert.equal(describeElement({ tagName: 'TEXTAREA' }), 'textarea')
	})
})

describe('scoreCandidate', () => {
	test('scores search candidates by semantic, type, name, label, and id/class signals', () => {
		const top = scoreCandidate({
			tagName: 'INPUT',
			inSearchRole: true,
			type: 'search',
			name: 'q',
			placeholder: 'Search...',
			id: 'search-input',
		})
		const medium = scoreCandidate({
			tagName: 'INPUT',
			type: 'text',
			name: 'q',
		})
		const weak = scoreCandidate({
			tagName: 'INPUT',
			type: 'text',
			id: 'searchbox',
		})
		assert.ok(top > medium, `Expected semantic search (${top}) > name=q (${medium})`)
		assert.ok(medium > weak, `Expected name=q (${medium}) > id=searchbox (${weak})`)
		assert.ok(weak > 0)
	})

	test('rejects non-inputs and non-text input types', () => {
		assert.equal(scoreCandidate(null), 0)
		assert.equal(scoreCandidate({ tagName: 'DIV', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'hidden', name: 'q' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'submit', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'text', name: 'email' }), 0)
	})
})

describe('isSearchPath', () => {
	test('detects search routes and non-empty search query parameters', () => {
		assert.equal(isSearchPath('/search', ''), true)
		assert.equal(isSearchPath('/en/results', ''), true)
		assert.equal(isSearchPath('/find/', ''), true)
		assert.equal(isSearchPath('/', '?q=userscript'), true)
		assert.equal(isSearchPath('/results', '?search_query=music'), true)
	})

	test('ignores non-search routes and empty query params', () => {
		assert.equal(isSearchPath('/watch', '?v=abc123'), false)
		assert.equal(isSearchPath('/search-tips', ''), false)
		assert.equal(isSearchPath('/', '?q=   '), false)
		assert.equal(isSearchPath('/', ''), false)
	})
})
