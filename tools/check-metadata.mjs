import fs from 'node:fs'
import path from 'node:path'

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
  return text.match(/\bSCRIPT_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || null
}

function usesGmInfoVersion(text) {
  return /\bGM_info\.script\.version\b/.test(text)
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

      const version = values(user.meta, 'version')[0]
      const scriptVersion = literalScriptVersion(user.text)
      if (scriptVersion && scriptVersion !== version) {
        groupErrors.push(`SCRIPT_VERSION ${scriptVersion} does not match @version ${version}`)
      }
      if (!scriptVersion && !usesGmInfoVersion(user.text)) {
        groupWarnings.push('no literal SCRIPT_VERSION constant or GM_info.script.version fallback')
      }

      const updateUrl = values(user.meta, 'updateURL')[0] || ''
      const downloadUrl = values(user.meta, 'downloadURL')[0] || ''
      if (!updateUrl.endsWith('.meta.js')) groupErrors.push('@updateURL should point at .meta.js')
      if (!downloadUrl.endsWith('.user.js')) groupErrors.push('@downloadURL should point at .user.js')
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

if (errors || warnings) {
  console.log(`\nMetadata check: ${errors} error(s), ${warnings} warning(s)`)
} else {
  console.log('Metadata check: ok')
}

if (errors) process.exit(1)
