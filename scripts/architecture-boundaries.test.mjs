import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projects = {
  domain: 'backend/src/Checkout.Domain/Checkout.Domain.csproj',
  application: 'backend/src/SelfServiceCheckout/SelfServiceCheckout.Application/SelfServiceCheckout.Application.csproj',
  contracts: 'backend/src/SelfServiceCheckout/SelfServiceCheckout.Contracts/SelfServiceCheckout.Contracts.csproj',
  infrastructure: 'backend/src/SelfServiceCheckout/SelfServiceCheckout.Infrastructure.Sqlite/SelfServiceCheckout.Infrastructure.Sqlite.csproj',
  host: 'backend/src/SelfServiceCheckout/SelfServiceCheckout/SelfServiceCheckout.csproj',
}

async function projectReferences(path) {
  const projectPath = join(root, path)
  const xml = await readFile(projectPath, 'utf8')
  return [...xml.matchAll(/<ProjectReference\s+Include="([^"]+)"/gi)]
    .map((match) => resolve(dirname(projectPath), match[1].replaceAll('\\', '/')))
    .sort()
}

async function projectXml(path) {
  return readFile(join(root, path), 'utf8')
}

async function sourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !['bin', 'obj'].includes(entry.name)) files.push(...await sourceFiles(join(directory, entry.name)))
    else if (entry.isFile() && entry.name.endsWith('.cs')) files.push(join(directory, entry.name))
  }
  return files
}

const projectPaths = Object.fromEntries(await Promise.all(Object.entries(projects).map(async ([name, path]) => [name, resolve(root, path)])))

assert.deepEqual(await projectReferences(projects.domain), [], 'Domain must have no project dependencies.')
assert.deepEqual(
  await projectReferences(projects.application),
  [projectPaths.contracts, projectPaths.domain].sort(),
  'Application may depend only on Domain and wire contracts.',
)
assert.deepEqual(
  await projectReferences(projects.infrastructure),
  [projectPaths.application, projectPaths.contracts, projectPaths.domain].sort(),
  'Infrastructure may implement application ports and use domain/contracts.',
)
assert.deepEqual(
  await projectReferences(projects.host),
  [projectPaths.application, projectPaths.contracts, projectPaths.infrastructure].sort(),
  'The HTTP host composes application and infrastructure without owning persistence.',
)

for (const layer of ['domain', 'application']) {
  assert.doesNotMatch(await projectXml(projects[layer]), /<PackageReference\b|<FrameworkReference\b/i, `${layer} must not declare framework or provider packages.`)
}
assert.match(await projectXml(projects.infrastructure), /Microsoft\.EntityFrameworkCore\.Sqlite/i, 'SQLite provider belongs to infrastructure.')
assert.doesNotMatch(await projectXml(projects.host), /Microsoft\.EntityFrameworkCore|Microsoft\.Data\.Sqlite/i, 'The HTTP host must not own persistence packages.')

for (const layer of ['domain', 'application']) {
  const files = await sourceFiles(dirname(projectPaths[layer]))
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /Microsoft\.EntityFrameworkCore|Microsoft\.AspNetCore|Microsoft\.Data\.Sqlite|SelfServiceCheckout\.Data/, `${file} must remain free of framework and storage dependencies.`)
  }
}

const hostFiles = await sourceFiles(dirname(projectPaths.host))
for (const file of hostFiles) {
  const source = await readFile(file, 'utf8')
  assert.doesNotMatch(source, /Microsoft\.EntityFrameworkCore|Microsoft\.Data\.Sqlite|SelfServiceCheckout\.Data|IDbContextFactory|CheckoutDbContext|CatalogItemEntity/, `${file} must use application ports instead of persistence details.`)
}

console.log('Architecture boundaries passed: Domain, Application, Infrastructure, and HTTP host dependencies are directed correctly.')
