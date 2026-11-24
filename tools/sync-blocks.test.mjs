// node --test tools/sync-blocks.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCKS, SKIP_DIRS, loadTemplates, render, syncBlock, walk } from './sync-blocks.mjs'
import { COMPARED_KEYS, parseUserscriptHeaderText, sameValues } from './check-metadata.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const templates = loadTemplates(ROOT)
const block = name => BLOCKS.find(b => b.name === name)

// ═══════════════════════════════════════════════════════════════════
//  SYNC ENGINE
// ═══════════════════════════════════════════════════════════════════

test('render re-indents tab-authored templates to the host indent', () => {
  const out = render('a()\n\tb()\n\n\t\tc()', 'my-script', '    ')
  assert.equal(out, '    a()\n        b()\n\n            c()')
})

test('render fills SLUG and STORAGE_PREFIX', () => {
  assert.equal(render("'{{SLUG}}' '{{STORAGE_PREFIX}}'", 'my-script', ''), "'my-script' 'my_script'")
})

test('syncBlock fills an empty marked region and is idempotent', () => {
  const b = { name: 'demo' }
  const host = 'x()\n  // <demo>\n  // </demo>\ny()'
  const once = syncBlock(host, b, 'one()\n\ttwo()', 's')
  assert.equal(once, 'x()\n  // <demo>\n  one()\n    two()\n  // </demo>\ny()')
  assert.equal(syncBlock(once, b, 'one()\n\ttwo()', 's'), once)
})

test('syncBlock: optional blocks may be absent, required ones may not', () => {
  assert.equal(syncBlock('x()', { name: 'demo' }, '', 's'), 'absent')
  assert.equal(syncBlock('x()', { name: 'demo', required: true }, '', 's'), 'missing-markers')
})

test('syncBlock rejects broken markers', () => {
  assert.equal(syncBlock('// <demo>\nx()', { name: 'demo' }, '', 's'), 'unpaired-marker')
  assert.equal(syncBlock('// </demo>\n// <demo>', { name: 'demo' }, '', 's'), 'markers-out-of-order')
})

test('walk skips .autodev and other excluded directories', t => {
  assert.equal(SKIP_DIRS.has('.autodev'), true)

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-blocks-walk-'))
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

  fs.mkdirSync(path.join(tmpRoot, 'my-script'), { recursive: true })
  fs.writeFileSync(path.join(tmpRoot, 'my-script', 'my-script.user.js'), '')

  fs.mkdirSync(path.join(tmpRoot, '.autodev', 'worktrees', 'T1', 'my-script'), { recursive: true })
  fs.writeFileSync(path.join(tmpRoot, '.autodev', 'worktrees', 'T1', 'my-script', 'my-script.user.js'), '')

  assert.deepEqual(walk(tmpRoot), [path.join('my-script', 'my-script.user.js')])
})

// ═══════════════════════════════════════════════════════════════════
//  METADATA CHECKER
// ═══════════════════════════════════════════════════════════════════

test('parseUserscriptHeaderText captures valueless directives like @noframes', () => {
  const header = [
    '// ==UserScript==',
    '// @name        Demo Script',
    '// @version     1.0.0',
    '// @noframes',
    '// @noframes   ',
    '// ==/UserScript==',
  ].join('\n')

  const parsed = parseUserscriptHeaderText(header)
  assert.equal(parsed.error, null)
  assert.deepEqual(parsed.meta.name, ['Demo Script'])
  assert.deepEqual(parsed.meta.version, ['1.0.0'])
  assert.deepEqual(parsed.meta.noframes, ['', ''])
})

test('COMPARED_KEYS includes noframes so @noframes drift is detected', () => {
  assert.equal(COMPARED_KEYS.includes('noframes'), true)

  const withNoframes = parseUserscriptHeaderText('// ==UserScript==\n// @noframes\n// ==/UserScript==')
  const withoutNoframes = parseUserscriptHeaderText('// ==UserScript==\n// @name Demo\n// ==/UserScript==')
  const alsoWithNoframes = parseUserscriptHeaderText('// ==UserScript==\n// @noframes\n// ==/UserScript==')

  assert.equal(sameValues(withNoframes.meta, withoutNoframes.meta, 'noframes'), false)
  assert.equal(sameValues(withNoframes.meta, alsoWithNoframes.meta, 'noframes'), true)
})

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE PURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
//
// The templates are script fragments, not modules. Evaluate the real
// template text in a function scope and pull out what's pure, so these
// tests can't drift from the code that ships.

function evalBlocks(names, exportNames, scope = {}) {
  const source = names.map(n => render(templates.get(n), 'test-script', '')).join('\n')
  const params = Object.keys(scope)
  const fn = new Function(...params, `${source}\nreturn { ${exportNames.join(', ')} }`)
  return fn(...params.map(k => scope[k]))
}

const { isNewerVersion } = evalBlocks(['update-check'], ['isNewerVersion'])

test('isNewerVersion detects patch, minor, and major bumps', () => {
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true)
  assert.equal(isNewerVersion('1.1.0', '1.0.9'), true)
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true)
})

test('isNewerVersion compares multi-digit segments numerically', () => {
  assert.equal(isNewerVersion('1.10.0', '1.2.0'), true)
  assert.equal(isNewerVersion('1.2.0', '1.10.0'), false)
})

test('isNewerVersion returns false when local is ahead or equal', () => {
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), false)
  assert.equal(isNewerVersion('1.2.0', '1.3.0'), false)
  assert.equal(isNewerVersion('1.9.9', '2.0.0'), false)
  assert.equal(isNewerVersion('1.2.3', '1.2.3'), false)
})

test('isNewerVersion handles unequal segment lengths', () => {
  assert.equal(isNewerVersion('1.2.1', '1.2'), true)
  assert.equal(isNewerVersion('1.2', '1.2.1'), false)
  assert.equal(isNewerVersion('1.2', '1.2.0'), false)
  assert.equal(isNewerVersion('1.2.0', '1.2'), false)
})

test('isNewerVersion falls back to inequality for pre-release or non-numeric strings', () => {
  assert.equal(isNewerVersion('1.2.0-beta.1', '1.2.0'), true)
  assert.equal(isNewerVersion('1.2.0', '1.2.0-beta.1'), true)
  assert.equal(isNewerVersion('1.2.0-beta.1', '1.2.0-beta.1'), false)
})

function makeUpdateCheckHarness({
  scriptVersion = '1.0.0',
  now = 1_000_000_000_000,
  storageThrows = false,
} = {}) {
  let currentNow = now
  const localMap = new Map()
  const sessionMap = new Map()
  const xhrCalls = []
  const openedUrls = []
  const elementsById = new Map()
  const prepended = []

  const makeStorage = map => ({
    getItem(k) {
      if (storageThrows) throw new Error('storage disabled')
      return map.has(k) ? map.get(k) : null
    },
    setItem(k, v) {
      if (storageThrows) throw new Error('storage disabled')
      map.set(k, String(v))
    },
    removeItem(k) {
      if (storageThrows) throw new Error('storage disabled')
      map.delete(k)
    },
  })

  const fakeDoc = {
    body: {
      prepend(el) {
        prepended.push(el)
        if (el.id) elementsById.set(el.id, el)
      },
    },
    getElementById(id) {
      return elementsById.get(id) || null
    },
    createElement(tag) {
      const listeners = {}
      const children = []
      const el = {
        tag,
        id: '',
        type: '',
        textContent: '',
        style: {},
        children,
        listeners,
        addEventListener(evt, fn) {
          listeners[evt] = fn
        },
        append(...nodes) {
          children.push(...nodes)
        },
        remove() {
          if (this.id) elementsById.delete(this.id)
          const idx = prepended.indexOf(this)
          if (idx !== -1) prepended.splice(idx, 1)
        },
      }
      return el
    },
  }

  const fakeWindow = {
    open(...args) {
      openedUrls.push(args)
    },
  }

  const fakeDate = {
    now() {
      return currentNow
    },
  }

  const silentConsole = { log() {}, warn() {}, error() {} }

  const exported = evalBlocks(
    ['update-check'],
    [
      'checkForUpdate',
      'showUpdateBanner',
      'UPDATE_BANNER_ID',
      'UPDATE_CHECKED_AT_KEY',
      'UPDATE_REMOTE_VERSION_KEY',
      'UPDATE_COOLDOWN_MS',
      'DOWNLOAD_URL',
    ],
    {
      SCRIPT_VERSION: scriptVersion,
      LOG_PREFIX: '[Test Script]',
      localStorage: makeStorage(localMap),
      sessionStorage: makeStorage(sessionMap),
      document: fakeDoc,
      window: fakeWindow,
      Date: fakeDate,
      console: silentConsole,
      GM_xmlhttpRequest(opts) {
        xhrCalls.push(opts)
      },
    },
  )

  return {
    ...exported,
    localMap,
    sessionMap,
    xhrCalls,
    openedUrls,
    prepended,
    elementsById,
    advanceTime(ms) {
      currentNow += ms
    },
  }
}

test('checkForUpdate fetches on first run, caches timestamp & remote version, and shows banner when newer', () => {
  const h = makeUpdateCheckHarness({ scriptVersion: '1.0.0' })
  h.checkForUpdate()
  assert.equal(h.xhrCalls.length, 1)

  h.xhrCalls[0].onload({ status: 200, responseText: '// @version 1.1.0\n' })
  assert.equal(h.localMap.get('test_script_update_checked_at'), '1000000000000')
  assert.equal(h.localMap.get('test_script_update_remote_version'), '1.1.0')
  assert.equal(h.prepended.length, 1)

  // Clicking message opens DOWNLOAD_URL with noopener,noreferrer
  const banner = h.prepended[0]
  const messageSpan = banner.children[0]
  messageSpan.listeners.click()
  assert.deepEqual(h.openedUrls, [[h.DOWNLOAD_URL, '_blank', 'noopener,noreferrer']])
})

test('checkForUpdate within cooldown skips network fetch and still shows banner for cached newer version', () => {
  const h = makeUpdateCheckHarness({ scriptVersion: '1.0.0' })
  h.checkForUpdate()
  h.xhrCalls[0].onload({ status: 200, responseText: '// @version 1.2.0\n' })
  assert.equal(h.xhrCalls.length, 1)
  assert.equal(h.prepended.length, 1)

  // Simulate navigating to a new page 1 hour later (clear banner DOM, keep storage)
  h.prepended[0].remove()
  assert.equal(h.prepended.length, 0)
  h.advanceTime(60 * 60 * 1000)

  h.checkForUpdate()
  assert.equal(h.xhrCalls.length, 1) // no new XHR
  assert.equal(h.prepended.length, 1) // banner re-shown from cache
})

test('checkForUpdate within cooldown stays silent when cached version is not newer or was dismissed', () => {
  const h = makeUpdateCheckHarness({ scriptVersion: '1.2.0' })
  h.checkForUpdate()
  h.xhrCalls[0].onload({ status: 200, responseText: '// @version 1.2.0\n' })
  assert.equal(h.xhrCalls.length, 1)
  assert.equal(h.prepended.length, 0)

  h.advanceTime(30 * 60 * 1000)
  h.checkForUpdate()
  assert.equal(h.xhrCalls.length, 1)
  assert.equal(h.prepended.length, 0)

  // Now simulate cached newer version that gets dismissed
  const h2 = makeUpdateCheckHarness({ scriptVersion: '1.0.0' })
  h2.checkForUpdate()
  h2.xhrCalls[0].onload({ status: 200, responseText: '// @version 1.3.0\n' })
  assert.equal(h2.prepended.length, 1)

  const dismissBtn = h2.prepended[0].children[1]
  dismissBtn.listeners.click()
  assert.equal(h2.prepended.length, 0)

  h2.advanceTime(10 * 60 * 1000)
  h2.checkForUpdate()
  assert.equal(h2.xhrCalls.length, 1)
  assert.equal(h2.prepended.length, 0)
})

test('checkForUpdate fetches again after cooldown expires', () => {
  const h = makeUpdateCheckHarness({ scriptVersion: '1.0.0' })
  h.checkForUpdate()
  h.xhrCalls[0].onload({ status: 200, responseText: '// @version 1.0.0\n' })
  assert.equal(h.xhrCalls.length, 1)

  h.advanceTime(h.UPDATE_COOLDOWN_MS + 1)
  h.checkForUpdate()
  assert.equal(h.xhrCalls.length, 2)
})

test('checkForUpdate fails open cleanly when storage throws', () => {
  const h = makeUpdateCheckHarness({ scriptVersion: '1.0.0', storageThrows: true })
  h.checkForUpdate()
  assert.equal(h.xhrCalls.length, 1)
  h.xhrCalls[0].onload({ status: 200, responseText: '// @version 1.1.0\n' })
  assert.equal(h.prepended.length, 1)
})

let injectedCss = ''
const fakeDocument = {
  createElement() {
    const classes = new Set()
    return {
      id: '',
      textContent: '',
      classList: {
        toggle(cls, force) {
          if (force) classes.add(cls)
          else classes.delete(cls)
        },
        contains(cls) {
          return classes.has(cls)
        },
      },
    }
  },
}

const kit = evalBlocks(
  ['autoclaim-kit'],
  ['maskKey', 'normalizeKey', 'waitFor', 'createStatusLine', 'updateStatus', 'injectPanelStyles'],
  {
    UI_PREFIX: 'test',
    document: fakeDocument,
    GM_addStyle: css => {
      injectedCss += css
    },
  },
)

test('maskKey shows only the first five characters', () => {
  assert.equal(kit.maskKey('ABCDE-FGHIJ'), 'ABCDE…')
  assert.equal(kit.maskKey('ABCDE'), 'ABCDE')
})

test('normalizeKey drops separators and upper-cases', () => {
  assert.equal(kit.normalizeKey('abcd-ef12 34'), 'ABCDEF1234')
})

test('waitFor resolves with the probe value, or null on timeout', async () => {
  let n = 0
  assert.equal(await kit.waitFor(() => ++n >= 3 && 'done', 1000, 1), 'done')
  assert.equal(await kit.waitFor(() => false, 5, 1), null)
})

test('updateStatus toggles ok, warn, and error tone classes and injectPanelStyles defines all three', () => {
  const panel = {
    children: [],
    appendChild(el) {
      this.children.push(el)
    },
  }
  const statusEl = kit.createStatusLine(panel, 'Ready')
  assert.equal(statusEl.textContent, 'Ready')

  kit.updateStatus('Backing off...', 'warn')
  assert.equal(statusEl.textContent, 'Backing off...')
  assert.equal(statusEl.classList.contains('test-status--warn'), true)
  assert.equal(statusEl.classList.contains('test-status--ok'), false)
  assert.equal(statusEl.classList.contains('test-status--error'), false)

  kit.updateStatus('Done', 'ok')
  assert.equal(statusEl.classList.contains('test-status--ok'), true)
  assert.equal(statusEl.classList.contains('test-status--warn'), false)
  assert.equal(statusEl.classList.contains('test-status--error'), false)

  kit.updateStatus('Failed', 'error')
  assert.equal(statusEl.classList.contains('test-status--error'), true)
  assert.equal(statusEl.classList.contains('test-status--warn'), false)
  assert.equal(statusEl.classList.contains('test-status--ok'), false)

  kit.updateStatus('Neutral')
  assert.equal(statusEl.classList.contains('test-status--ok'), false)
  assert.equal(statusEl.classList.contains('test-status--warn'), false)
  assert.equal(statusEl.classList.contains('test-status--error'), false)

  kit.injectPanelStyles()
  assert.match(injectedCss, /#test-status\.test-status--ok\b/)
  assert.match(injectedCss, /#test-status\.test-status--warn\b/)
  assert.match(injectedCss, /#test-status\.test-status--error\b/)
})

const steam = evalBlocks(['steam-redeem'], ['STEAM_KEY_RE', 'steamRedeemUrl'])

test('STEAM_KEY_RE finds a key inside surrounding text', () => {
  assert.equal('Key: AB1CD-EF2GH-IJ3KL ok'.match(steam.STEAM_KEY_RE)[0], 'AB1CD-EF2GH-IJ3KL')
  assert.equal('ab1cd-ef2gh-ij3kl'.match(steam.STEAM_KEY_RE), null)
})

test('steamRedeemUrl builds a registerkey URL', () => {
  assert.equal(steam.steamRedeemUrl('AAAAA-BBBBB-CCCCC'), 'steam://registerkey/AAAAA-BBBBB-CCCCC')
})
