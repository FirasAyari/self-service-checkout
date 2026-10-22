import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

const root = process.cwd()
const matrixPath = join(root, 'docs', 'submission-requirements-matrix.md')
const isFix = process.argv.includes('--fix')
const ignoredDirectories = new Set(['bin', 'dist', 'node_modules', 'obj'])

async function walk(directory, includeFile) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(join(directory, entry.name), includeFile))
    } else if (entry.isFile() && includeFile(entry.name)) {
      files.push(join(directory, entry.name))
    }
  }
  return files
}

const testFiles = [
  ...await walk(join(root, 'backend', 'tests'), (name) => name.endsWith('.cs')),
  ...await walk(join(root, 'frontend', 'src'), (name) => /\.(test|spec)\.[jt]sx?$/i.test(name)),
  ...await walk(join(root, 'frontend', 'e2e'), (name) => /\.(test|spec)\.[jt]sx?$/i.test(name)),
  ...await walk(join(root, 'frontend', 'e2e-production'), (name) => /\.(test|spec)\.[jt]sx?$/i.test(name)),
  join(root, 'scripts', 'delivery-criteria.test.mjs'),
]

const declarations = []
for (const file of testFiles) {
  const source = await readFile(file, 'utf8')
  const relativePath = relative(root, file).split(sep).join('/')
  const matches = [
    ...source.matchAll(/\[(?:Fact|Theory)\s*\(\s*DisplayName\s*=\s*"([^"]+)"\s*\)\s*\]/g),
    ...source.matchAll(/\b(?:test|it)\s*\(\s*(['"`])([\s\S]*?)\1/g),
  ]
  for (const match of matches) {
    const title = match[2] ?? match[1]
    const line = source.slice(0, match.index).split(/\r?\n/).length
    const ids = new Set(title.match(/\b(?:AC|BR|SC)-[A-Z0-9]+\b/g) ?? [])
    declarations.push({ path: relativePath, line, ids })
  }
}

function isTestCitation(label) {
  return /^(?:\.\.\/)?(?:backend\/tests\/.*|frontend\/(?:src\/.*\.(?:test|spec)\.[jt]sx?|e2e\/.*|e2e-production\/.*)|scripts\/.*\.test\.mjs):\d+$/.test(label)
}

function candidatesFor(rowId, rowText) {
  const evidenceIds = new Set([
    rowId,
    ...(rowText.match(/\bAC-[A-Z0-9]+\b/g) ?? []),
  ])
  return declarations.filter((declaration) => [...evidenceIds].some((id) => declaration.ids.has(id)))
}

function testCitationsIn(row) {
  return [...row.matchAll(/\[([^\]]+)\]\(([^)]+)#L(\d+)\)/g)]
    .filter((match) => isTestCitation(match[1]))
    .map((match) => ({ path: match[1].replace(/:\d+$/, '').replace(/^\.\.\//, ''), line: Number(match[3]), match: match[0] }))
}

function replaceTestCitations(row, expected) {
  const withoutTestLinks = row
    .replace(/\[([^\]]+)\]\(([^)]+)#L(\d+)\)/g, (link, label) => isTestCitation(label) ? '' : link)
    .replace(/([;,])\s*(?:[,;]\s*)+/g, '$1 ')
    .replace(/([.;])\s*,\s*/g, '$1 ')
  const references = [...new Map(expected.map(({ path, line }) => [`${path}:${line}`, { path, line }])).values()]
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
    .map(({ path, line }) => `[${path}:${line}](../${path}#L${line})`)
  if (references.length === 0) return withoutTestLinks
  const insertionPoint = withoutTestLinks.lastIndexOf('|')
  const beforeCellEnd = withoutTestLinks.slice(0, insertionPoint).trimEnd()
  const afterCellEnd = withoutTestLinks.slice(insertionPoint)
  return `${beforeCellEnd} ${references.join(', ')} ${afterCellEnd}`
}

const source = await readFile(matrixPath, 'utf8')
const lines = source.split(/\r?\n/)
const errors = []
let updatedRows = 0

for (let index = 0; index < lines.length; index++) {
  const row = lines[index]
  const rowMatch = /^\|\s*((?:AC|BR|SC)-[A-Z0-9]+)\s*\|/.exec(row)
  if (!rowMatch) continue

  const rowId = rowMatch[1]
  const isDeviated = /\|\s*Deviated:\s*ADR-\d{4}/i.test(row)
  const expected = isDeviated ? [] : candidatesFor(rowId, row)
  const hasMetStatus = /\|\s*(?:MET|Required)\s*\|/i.test(row)
  if (/;\s{2,}(?:checks?|covers?|verifies?|confirms?|clears?|exercises?)\b/i.test(row) ||
      /\b(?:checks?|covers?|verifies?)\s+(?:run\s+)?at\s*;/i.test(row)) {
    errors.push(`Line ${index + 1} (${rowId}) has an empty or dangling test-evidence note.`)
  }
  if (expected.length === 0 && hasMetStatus && !isDeviated) {
    errors.push(`Line ${index + 1} (${rowId}) has no named test evidence for its ID or linked acceptance criteria.`)
    continue
  }

  const updated = replaceTestCitations(row, expected)
  if (isFix) {
    if (updated !== row) {
      lines[index] = updated
      updatedRows++
    }
    continue
  }

  const actual = testCitationsIn(row)
  const expectedKeys = new Set(expected.map(({ path, line }) => `${path}:${line}`))
  const actualKeys = new Set(actual.map(({ path, line }) => `${path}:${line}`))
  const stale = actual.some(({ path, line }) => !expectedKeys.has(`${path}:${line}`))
  const missing = [...expectedKeys].some((key) => !actualKeys.has(key))
  if (stale || missing) errors.push(`Line ${index + 1} (${rowId}) has stale test evidence links.`)
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

if (isFix) {
  await writeFile(matrixPath, lines.join('\n'))
  console.log(`Refreshed named test evidence in ${updatedRows} requirement rows.`)
} else {
  console.log('Submission matrix test links match the current named test declarations.')
}
