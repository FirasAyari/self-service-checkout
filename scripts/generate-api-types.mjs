import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const contractPath = join(root, 'backend', 'tests', 'SelfServiceCheckout.Api.Tests', 'Contracts', 'openapi.v1.json')
const outputPath = join(root, 'frontend', 'src', 'api.generated.ts')
const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const schemas = contract.components?.schemas

if (!schemas || typeof schemas !== 'object') {
  throw new Error('OpenAPI contract does not contain components.schemas.')
}

function schemaName(reference) {
  const prefix = '#/components/schemas/'
  if (!reference.startsWith(prefix)) throw new Error(`Unsupported OpenAPI reference: ${reference}`)
  return reference.slice(prefix.length)
}

function typeOf(schema) {
  if (schema.$ref) return schemaName(schema.$ref)
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  if (schema.oneOf) return [...new Set(schema.oneOf.map(typeOf))].join(' | ')
  if (schema.anyOf) return [...new Set(schema.anyOf.map(typeOf))].join(' | ')
  if (schema.allOf) return schema.allOf.map(typeOf).join(' & ')
  if (schema.format === 'int32' || schema.format === 'int64') {
    return (Array.isArray(schema.type) && schema.type.includes('null')) ? 'number | null' : 'number'
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const mapped = types.filter(Boolean).map((type) => {
    if (type === 'null') return 'null'
    if (type === 'string') return 'string'
    if (type === 'integer' || type === 'number') return 'number'
    if (type === 'boolean') return 'boolean'
    if (type === 'array') return `(${typeOf(schema.items ?? {})})[]`
    if (type === 'object') return objectType(schema)
    throw new Error(`Unsupported OpenAPI schema type: ${type}`)
  })
  return mapped.length ? [...new Set(mapped)].join(' | ') : 'unknown'
}

function objectType(schema) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const lines = Object.entries(properties).map(([name, property]) =>
    `  ${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${typeOf(property)}`)
  return lines.length ? `{\n${lines.join('\n')}\n}` : 'Record<string, never>'
}

const generated = [
  '/* Generated from backend/tests/SelfServiceCheckout.Api.Tests/Contracts/openapi.v1.json. Do not edit. */',
  ...Object.entries(schemas).map(([name, schema]) => `export type ${name} = ${typeOf(schema)}`),
  '',
].join('\n')

if (process.argv.includes('--check')) {
  const current = (await readFile(outputPath, 'utf8').catch(() => '')).replace(/\r\n/g, '\n')
  if (current !== generated) {
    console.error('frontend/src/api.generated.ts is stale. Run npm --prefix frontend run api:types and review the change.')
    process.exitCode = 1
  }
} else {
  await writeFile(outputPath, generated, 'utf8')
  console.log(`Generated ${outputPath}`)
}
