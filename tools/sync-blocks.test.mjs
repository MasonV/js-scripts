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

const kit = evalBlocks(['autoclaim-kit'], ['maskKey', 'normalizeKey', 'waitFor'], { UI_PREFIX: 'test' })

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

const steam = evalBlocks(['steam-redeem'], ['STEAM_KEY_RE', 'steamRedeemUrl'])

test('STEAM_KEY_RE finds a key inside surrounding text', () => {
  assert.equal('Key: AB1CD-EF2GH-IJ3KL ok'.match(steam.STEAM_KEY_RE)[0], 'AB1CD-EF2GH-IJ3KL')
  assert.equal('ab1cd-ef2gh-ij3kl'.match(steam.STEAM_KEY_RE), null)
})

test('steamRedeemUrl builds a registerkey URL', () => {
  assert.equal(steam.steamRedeemUrl('AAAAA-BBBBB-CCCCC'), 'steam://registerkey/AAAAA-BBBBB-CCCCC')
})
