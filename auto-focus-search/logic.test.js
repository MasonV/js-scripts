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
		return { describeElement, isTextInputElement, isFocusable, scoreCandidate };
	`)
	return factory()
}

const { describeElement, isTextInputElement, isFocusable, scoreCandidate } = loadAutoFocusSearchLogic()

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
		assert.equal(scoreCandidate({}), 0)
		assert.equal(scoreCandidate({ tagName: 'DIV', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'BUTTON', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'A', className: 'search-box' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'hidden', name: 'q' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'submit', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'button', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'checkbox', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'radio', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'image', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'reset', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'file', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'range', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'color', id: 'search' }), 0)
		assert.equal(scoreCandidate({ tagName: 'INPUT', type: 'text', name: 'email' }), 0)
	})
})

describe('isTextInputElement & isFocusable', () => {
	test('accepts text-like inputs and textareas when enabled and tabbable', () => {
		assert.equal(isTextInputElement({ tagName: 'INPUT', type: 'text' }), true)
		assert.equal(isTextInputElement({ tagName: 'INPUT', type: 'search' }), true)
		assert.equal(isTextInputElement({ tagName: 'INPUT' }), true)
		assert.equal(isTextInputElement({ tagName: 'TEXTAREA' }), true)
		assert.equal(isFocusable({ tagName: 'INPUT', type: 'search', disabled: false, readOnly: false, tabIndex: 0 }), true)
		assert.equal(isFocusable({ tagName: 'TEXTAREA', disabled: false, readOnly: false }), true)
	})

	test('rejects non-input elements such as button, a, and div with tabindex', () => {
		assert.equal(isFocusable({ tagName: 'BUTTON', id: 'search' }), false)
		assert.equal(isFocusable({ tagName: 'A', className: 'search-box' }), false)
		assert.equal(isFocusable({ tagName: 'DIV', id: 'search', tabIndex: 0 }), false)
	})

	test('rejects non-text input types and disabled, readOnly, or tabIndex=-1 inputs', () => {
		for (const type of ['hidden', 'submit', 'button', 'checkbox', 'radio', 'image', 'reset', 'file', 'range', 'color']) {
			assert.equal(isFocusable({ tagName: 'INPUT', type }), false, `Expected type=${type} to be rejected`)
		}
		assert.equal(isFocusable({ tagName: 'INPUT', type: 'text', disabled: true }), false)
		assert.equal(isFocusable({ tagName: 'INPUT', type: 'text', readOnly: true }), false)
		assert.equal(isFocusable({ tagName: 'INPUT', type: 'text', tabIndex: -1 }), false)
	})
})
