import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const SKIP_DIRS = new Set([
  '.git',
  '.claude',
  'archive',
  'node_modules',
  'diagnostics',
])

const COMPARED_KEYS = [
  'name',
  'namespace',
  'version',
  'description',
  'match',
  'include',
  'homepageURL',
  'supportURL',
  'updateURL',
  'downloadURL',
  'grant',
  'connect',
  'run-at',
]

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(ROOT, abs)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.endsWith('.dev.resources') || entry.name.endsWith('.dev.res')) continue
      files.push(...walk(abs))
      continue
    }

    if (entry.isFile() && (entry.name.endsWith('.user.js') || entry.name.endsWith('.meta.js'))) {
      files.push(rel)
    }
  }

  return files
}

function parseUserscriptHeader(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const block = text.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/)
  if (!block) {
    return { meta: {}, text, error: 'missing userscript metadata block' }
  }

  const meta = {}
  for (const line of block[1].split(/\r?\n/)) {
    const match = line.match(/^\s*\/\/\s+@(\S+)\s+(.*)$/)
    if (!match) continue
    const [, key, value] = match
    if (!meta[key]) meta[key] = []
    meta[key].push(value.trim())
  }

  return { meta, text, error: null }
}

function groupedScripts(files) {
  const groups = new Map()

  for (const file of files) {
    const kind = file.endsWith('.user.js') ? 'user' : 'meta'
    const base = path.basename(file).replace(/\.(user|meta)\.js$/, '')
    const key = path.join(path.dirname(file), base)

    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[kind] = file
  }

  return [...groups.entries()]
}

function values(meta, key) {
  return meta[key] || []
}

function sameValues(left, right, key) {
  return JSON.stringify(values(left, key)) === JSON.stringify(values(right, key))
}

function literalScriptVersion(text) {
  return /\bSCRIPT_VERSION\s*=\s*['"][^'"]+['"]/.test(text)
}

function usesGmInfoVersion(text) {
  return /\bGM_info\.script\.version\b/.test(text)
}

// The update check is mandatory (see CLAUDE.md). Declaring it isn't enough —
// yourtube shipped for several versions with the constants but no call.
function definesUpdateCheck(text) {
  return /\bfunction checkForUpdate\s*\(/.test(text)
}

function callsUpdateCheck(text) {
  return /^[^\S\n]*checkForUpdate\(\)/m.test(text)
}

function hasUpdateCheckMarkers(text) {
  return text.includes('// <update-check>') && text.includes('// </update-check>')
}

// Everything after the metadata block — where a granted API has to be used.
function scriptBody(text) {
  const end = text.indexOf('// ==/UserScript==')
  return end === -1 ? text : text.slice(end)
}

let errors = 0
let warnings = 0

for (const [group, files] of groupedScripts(walk(ROOT))) {
  const groupErrors = []
  const groupWarnings = []

  if (!files.user) groupErrors.push('missing .user.js')
  if (!files.meta) groupErrors.push('missing .meta.js')

  if (files.user && files.meta) {
    const user = parseUserscriptHeader(files.user)
    const meta = parseUserscriptHeader(files.meta)

    if (user.error) groupErrors.push(`${files.user}: ${user.error}`)
    if (meta.error) groupErrors.push(`${files.meta}: ${meta.error}`)

    if (!user.error && !meta.error) {
      for (const key of COMPARED_KEYS) {
        if (!sameValues(user.meta, meta.meta, key)) {
          groupErrors.push(`@${key} differs between .user.js and .meta.js`)
        }
      }

      if (literalScriptVersion(user.text)) {
        groupErrors.push('SCRIPT_VERSION should read GM_info.script.version instead of a literal version')
      }
      if (!usesGmInfoVersion(user.text)) {
        groupErrors.push('SCRIPT_VERSION should use GM_info.script.version')
      }

      const updateUrl = values(user.meta, 'updateURL')[0] || ''
      const downloadUrl = values(user.meta, 'downloadURL')[0] || ''
      if (!updateUrl.endsWith('.meta.js')) groupErrors.push('@updateURL should point at .meta.js')
      if (!downloadUrl.endsWith('.user.js')) groupErrors.push('@downloadURL should point at .user.js')

      if (!hasUpdateCheckMarkers(user.text)) {
        groupErrors.push('missing // <update-check> … // </update-check> region (run: node tools/sync-blocks.mjs)')
      }
      if (!definesUpdateCheck(user.text)) groupErrors.push('no checkForUpdate() defined')
      if (!callsUpdateCheck(user.text)) groupErrors.push('checkForUpdate() is defined but never called')

      const grants = values(user.meta, 'grant')
      const body = scriptBody(user.text)

      if (grants.includes('GM_xmlhttpRequest') && !values(user.meta, 'connect').includes('raw.githubusercontent.com')) {
        groupErrors.push('@grant GM_xmlhttpRequest requires @connect raw.githubusercontent.com')
      }

      // unsafeWindow is a scope switch, not a callable API, so it's exempt.
      for (const grant of grants) {
        if (grant === 'unsafeWindow' || grant === 'none') continue
        if (!new RegExp(`\\b${grant}\\b`).test(body)) {
          groupErrors.push(`@grant ${grant} is never used`)
        }
      }
    }
  }

  if (groupErrors.length || groupWarnings.length) {
    console.log(`\n${group}`)
    for (const message of groupErrors) console.log(`  error: ${message}`)
    for (const message of groupWarnings) console.log(`  warn:  ${message}`)
  }

  errors += groupErrors.length
  warnings += groupWarnings.length
}

// Generated regions (update-check and the opt-in shared blocks) are owned by
// sync-blocks.mjs, so ask it whether any file has drifted from its template.
const sync = spawnSync(process.execPath, [path.join('tools', 'sync-blocks.mjs'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
})

if (sync.status !== 0) {
  console.log(`\ngenerated blocks out of sync (run: node tools/sync-blocks.mjs):`)
  console.log(sync.stdout.trimEnd())
  errors++
}

if (errors || warnings) {
  console.log(`\nMetadata check: ${errors} error(s), ${warnings} warning(s)`)
} else {
  console.log('Metadata check: ok')
}

if (errors) process.exit(1)
