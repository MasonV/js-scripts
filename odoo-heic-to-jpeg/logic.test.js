// Unit tests for the per-blob FileReader re-entrancy guard in odoo-heic-to-jpeg.user.js.
// Slices the injected page-context script directly from the userscript and runs it
// against mock browser primitives so tests cannot drift from shipped code.
//
// Run with: node --test odoo-heic-to-jpeg/logic.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const USER_JS_PATH = path.join(__dirname, 'odoo-heic-to-jpeg.user.js')

function deferred() {
	let resolve, reject
	const promise = new Promise((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function loadPageScriptHarness({ heic2anyImpl, failLoad = false, useWeakMap = true } = {}) {
	const src = fs.readFileSync(USER_JS_PATH, 'utf8')
	const start = src.indexOf("var LOG = '[Odoo HEIC→JPEG]'")
	const endMarker = "console.log(LOG, 'Initialized — patched FileReader, fetch, and XMLHttpRequest')"
	const end = src.indexOf(endMarker, start)
	assert.ok(start !== -1 && end !== -1, 'Could not locate injected page script body in userscript')

	const body = src.slice(start, end)
	const rawReads = []
	const xhrSends = []
	const fetchCalls = []

	class MockBlob {
		constructor(parts = [], options = {}) {
			this.parts = parts
			this.type = options.type || ''
			this.size = parts.reduce((acc, p) => acc + (p?.size || String(p).length || 0), 0)
		}
	}

	class MockFile extends MockBlob {
		constructor(parts, name, options = {}) {
			super(parts, options)
			this.name = name
			this.lastModified = options.lastModified || 0
		}
	}

	class MockFormData {
		constructor() {
			this._entries = []
		}
		append(key, value, filename) {
			this._entries.push([key, value, filename])
		}
		delete(key) {
			this._entries = this._entries.filter(([k]) => k !== key)
		}
		*entries() {
			for (const [k, v] of this._entries) {
				yield [k, v]
			}
		}
	}

	class MockFileReader {
		constructor() {
			this._onRawRead = null
		}
	}

	for (const method of ['readAsDataURL', 'readAsArrayBuffer', 'readAsBinaryString']) {
		MockFileReader.prototype[method] = function (blob) {
			rawReads.push({ reader: this, method, blob })
			if (typeof this._onRawRead === 'function') {
				this._onRawRead(blob, method)
			}
		}
	}

	class MockXMLHttpRequest {
		constructor() {
			this._onSend = null
		}
	}
	MockXMLHttpRequest.prototype.send = function (data) {
		xhrSends.push(data)
		if (typeof this._onSend === 'function') {
			this._onSend(data)
		}
	}

	const mockWindow = {
		heic2any: heic2anyImpl,
		fetch(url, config) {
			fetchCalls.push({ url, config })
			return Promise.resolve({ ok: true })
		},
	}

	const mockDocument = {
		body: null,
		createElement() {
			return { src: '', onload: null, onerror: null }
		},
		documentElement: {
			appendChild(el) {
				if (failLoad) {
					if (typeof el.onerror === 'function') el.onerror()
				} else if (typeof el.onload === 'function') {
					el.onload()
				}
			},
		},
	}

	const quietConsole = {
		log() {},
		warn() {},
		error() {},
	}

	// eslint-disable-next-line no-new-func
	const factory = new Function(
		'window',
		'document',
		'FileReader',
		'XMLHttpRequest',
		'File',
		'Blob',
		'FormData',
		'console',
		'WeakMap',
		`
		"use strict";
		${body}
		return {
			isHeic,
			isConvertingBlob,
			markConvertingBlob,
			unmarkConvertingBlob,
			convertBlob,
			convertFormData,
		};
		`
	)

	const api = factory(
		mockWindow,
		mockDocument,
		MockFileReader,
		MockXMLHttpRequest,
		MockFile,
		MockBlob,
		MockFormData,
		quietConsole,
		useWeakMap ? WeakMap : undefined
	)

	return {
		...api,
		FileReader: MockFileReader,
		XMLHttpRequest: MockXMLHttpRequest,
		FormData: MockFormData,
		File: MockFile,
		Blob: MockBlob,
		window: mockWindow,
		rawReads,
		xhrSends,
		fetchCalls,
	}
}

function readViaPatchedReader(ReaderClass, method, blob) {
	return new Promise((resolve) => {
		const reader = new ReaderClass()
		reader._onRawRead = (receivedBlob) => resolve(receivedBlob)
		reader[method](blob)
	})
}

describe('per-blob re-entrancy guard', () => {
	test('lets heic2any internal FileReader read pass through while converting concurrent HEIC blobs', async () => {
		const conv1 = deferred()
		const conv2 = deferred()
		const internalReadResults = []
		const heic2anyCalls = []

		let h
		const heic2anyImpl = ({ blob }) => {
			heic2anyCalls.push(blob)
			// Simulate heic2any internally calling FileReader.prototype.readAsArrayBuffer on the same blob.
			const internalReader = new h.FileReader()
			internalReader.readAsArrayBuffer(blob)
			internalReadResults.push(blob)

			if (blob.name === 'photo1.heic') return conv1.promise
			if (blob.name === 'photo2.heic') return conv2.promise
			throw new Error('Unexpected blob: ' + blob.name)
		}

		h = loadPageScriptHarness({ heic2anyImpl })
		const photo1 = new h.File(['heic-1'], 'photo1.heic', { type: 'image/heic' })
		const photo2 = new h.File(['heic-2'], 'photo2.heic', { type: 'image/heic' })

		const preview1Promise = readViaPatchedReader(h.FileReader, 'readAsDataURL', photo1)
		const preview2Promise = readViaPatchedReader(h.FileReader, 'readAsDataURL', photo2)

		// Wait a microtask so both heic2anyReady.then callbacks have executed.
		await Promise.resolve()
		await Promise.resolve()

		// Both conversions are in flight concurrently, and both internal readAsArrayBuffer calls
		// passed straight through to the original FileReader without triggering recursive conversion.
		assert.deepEqual(heic2anyCalls, [photo1, photo2])
		assert.deepEqual(internalReadResults, [photo1, photo2])
		assert.equal(h.isConvertingBlob(photo1), true)
		assert.equal(h.isConvertingBlob(photo2), true)
		assert.equal(h.rawReads.length, 2)
		assert.equal(h.rawReads[0].method, 'readAsArrayBuffer')
		assert.equal(h.rawReads[0].blob, photo1)
		assert.equal(h.rawReads[1].method, 'readAsArrayBuffer')
		assert.equal(h.rawReads[1].blob, photo2)

		conv2.resolve(new h.Blob(['jpeg-2'], { type: 'image/jpeg' }))
		conv1.resolve(new h.Blob(['jpeg-1'], { type: 'image/jpeg' }))

		const [out1, out2] = await Promise.all([preview1Promise, preview2Promise])
		assert.equal(out1.type, 'image/jpeg')
		assert.equal(out1.name, 'photo1.jpg')
		assert.equal(out2.type, 'image/jpeg')
		assert.equal(out2.name, 'photo2.jpg')
		assert.equal(h.isConvertingBlob(photo1), false)
		assert.equal(h.isConvertingBlob(photo2), false)
	})

	test('intercepts FileReader read on photo2 while convertFormData is converting photo1', async () => {
		const uploadConv = deferred()
		const previewConv = deferred()
		let h

		const heic2anyImpl = ({ blob }) => {
			const internalReader = new h.FileReader()
			internalReader.readAsArrayBuffer(blob)
			return blob.name === 'upload.heic' ? uploadConv.promise : previewConv.promise
		}

		h = loadPageScriptHarness({ heic2anyImpl })
		const uploadBlob = new h.File(['u'], 'upload.heic', { type: 'image/heic' })
		const previewBlob = new h.File(['p'], 'preview.heic', { type: 'image/heic' })

		const formData = new h.FormData()
		formData.append('ufile', uploadBlob)

		const xhr = new h.XMLHttpRequest()
		const xhrSent = new Promise((resolve) => {
			xhr._onSend = resolve
		})
		xhr.send(formData)

		const previewPromise = readViaPatchedReader(h.FileReader, 'readAsBinaryString', previewBlob)

		await Promise.resolve()
		await Promise.resolve()

		assert.equal(h.isConvertingBlob(uploadBlob), true)
		assert.equal(h.isConvertingBlob(previewBlob), true)

		uploadConv.resolve(new h.Blob(['jpg-u'], { type: 'image/jpeg' }))
		previewConv.resolve(new h.Blob(['jpg-p'], { type: 'image/jpeg' }))

		const previewOut = await previewPromise
		assert.equal(previewOut.name, 'preview.jpg')
		assert.equal(previewOut.type, 'image/jpeg')

		await xhrSent
		assert.equal(h.xhrSends.length, 1)
		const sentEntries = Array.from(formData.entries())
		assert.equal(sentEntries[0][1].name, 'upload.jpg')
		assert.equal(sentEntries[0][1].type, 'image/jpeg')
		assert.equal(h.isConvertingBlob(uploadBlob), false)
		assert.equal(h.isConvertingBlob(previewBlob), false)
	})

	test('reference-counts concurrent conversions of the exact same blob reference', async () => {
		const conv1 = deferred()
		const conv2 = deferred()
		let callCount = 0

		const h = loadPageScriptHarness({
			heic2anyImpl() {
				callCount++
				return callCount === 1 ? conv1.promise : conv2.promise
			},
		})

		const sharedBlob = new h.File(['same'], 'shared.heic', { type: 'image/heic' })
		const p1 = h.convertBlob(sharedBlob)
		const p2 = h.convertBlob(sharedBlob)

		assert.equal(h.isConvertingBlob(sharedBlob), true)

		conv1.resolve(new h.Blob(['jpg-1'], { type: 'image/jpeg' }))
		await p1

		// Second conversion is still active, so sharedBlob must remain guarded.
		assert.equal(h.isConvertingBlob(sharedBlob), true)

		conv2.resolve(new h.Blob(['jpg-2'], { type: 'image/jpeg' }))
		await p2

		assert.equal(h.isConvertingBlob(sharedBlob), false)
	})

	test('cleans up blob guard on rejection, code-1 skip, load failure, and synchronous throw', async () => {
		// 1. Generic rejection passes original through FileReader and unmarks blob
		let shouldThrowSync = false
		let nextResult = Promise.reject(new Error('decode error'))
		let h = loadPageScriptHarness({
			heic2anyImpl() {
				if (shouldThrowSync) throw new Error('sync boom')
				return nextResult
			},
		})

		const photo = new h.File(['heic'], 'bad.heic', { type: 'image/heic' })
		const fallbackOut = await readViaPatchedReader(h.FileReader, 'readAsDataURL', photo)
		assert.equal(fallbackOut, photo)
		assert.equal(h.isConvertingBlob(photo), false)

		// 2. Subsequent synchronous throw in heic2any also cleans up so future reads convert
		shouldThrowSync = true
		const syncErrOut = await readViaPatchedReader(h.FileReader, 'readAsDataURL', photo)
		assert.equal(syncErrOut, photo)
		assert.equal(h.isConvertingBlob(photo), false)

		// 3. Subsequent read succeeds once heic2any recovers
		shouldThrowSync = false
		nextResult = Promise.resolve(new h.Blob(['ok-jpg'], { type: 'image/jpeg' }))
		const okOut = await readViaPatchedReader(h.FileReader, 'readAsDataURL', photo)
		assert.equal(okOut.name, 'bad.jpg')
		assert.equal(okOut.type, 'image/jpeg')
		assert.equal(h.isConvertingBlob(photo), false)

		// 4. heic2any code 1 ("already browser readable") passes original and cleans up
		nextResult = Promise.reject({ code: 1 })
		const code1Out = await readViaPatchedReader(h.FileReader, 'readAsArrayBuffer', photo)
		assert.equal(code1Out, photo)
		assert.equal(h.isConvertingBlob(photo), false)

		// 5. heic2any script load failure cleans up
		const failedHarness = loadPageScriptHarness({ failLoad: true })
		const photo2 = new failedHarness.File(['heic'], 'loadfail.heic', { type: 'image/heic' })
		const failLoadOut = await readViaPatchedReader(failedHarness.FileReader, 'readAsDataURL', photo2)
		assert.equal(failLoadOut, photo2)
		assert.equal(failedHarness.isConvertingBlob(photo2), false)
	})

	test('array fallback when WeakMap is unavailable tracks and cleans up per-blob state', async () => {
		const convA1 = deferred()
		const convA2 = deferred()
		const convB = deferred()
		let aCalls = 0
		let h

		const heic2anyImpl = ({ blob }) => {
			const internalReader = new h.FileReader()
			internalReader.readAsArrayBuffer(blob)
			if (blob.name === 'a.heic') {
				aCalls++
				return aCalls === 1 ? convA1.promise : convA2.promise
			}
			return convB.promise
		}

		h = loadPageScriptHarness({ heic2anyImpl, useWeakMap: false })
		const a = new h.File(['a'], 'a.heic', { type: 'image/heic' })
		const b = new h.File(['b'], 'b.heic', { type: 'image/heic' })

		const pA1 = h.convertBlob(a)
		const pA2 = h.convertBlob(a)
		const pB = readViaPatchedReader(h.FileReader, 'readAsDataURL', b)

		assert.equal(h.isConvertingBlob(a), true)
		assert.equal(h.isConvertingBlob(b), true)

		convA1.resolve(new h.Blob(['jpg-a1'], { type: 'image/jpeg' }))
		convB.resolve(new h.Blob(['jpg-b'], { type: 'image/jpeg' }))

		await pA1
		assert.equal(h.isConvertingBlob(a), true)

		convA2.resolve(new h.Blob(['jpg-a2'], { type: 'image/jpeg' }))
		await pA2
		assert.equal(h.isConvertingBlob(a), false)

		const bOut = await pB
		assert.equal(bOut.name, 'b.jpg')
		assert.equal(h.isConvertingBlob(b), false)
	})
})
