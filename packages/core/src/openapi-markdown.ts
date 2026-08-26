import type { OpenApiDocument } from './openapi.js'
import { objectValue, stringValue } from './openapi-values.js'

const httpMethods = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])

export function renderOpenApiMarkdown(document: OpenApiDocument): string {
  const info = objectValue(document.info) ?? {}
  const title = stringValue(info.title) ?? 'OpenAPI'
  const lines: string[] = [`# ${title}`, '']
  addMetadata(lines, document, info)
  addText(lines, info.description)
  addServers(lines, document)
  addSecuritySchemes(lines, document)
  addOperations(lines, document)
  addSchemas(lines, document)
  return lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function addMetadata(
  lines: string[],
  document: OpenApiDocument,
  info: Record<string, unknown>
): void {
  const specification = stringValue(document.openapi) ?? stringValue(document.swagger)
  const version = stringValue(info.version)
  const summary = stringValue(info.summary)
  if (specification) lines.push(`- 规范版本：${inline(specification)}`)
  if (version) lines.push(`- API 版本：${inline(version)}`)
  if (summary) lines.push(`- 摘要：${inline(summary)}`)
  if (specification || version || summary) lines.push('')
}

function addServers(lines: string[], document: OpenApiDocument): void {
  const servers = arrayValue(document.servers)
  if (servers.length) {
    lines.push('## 服务地址', '')
    for (const item of servers) {
      const server = objectValue(item)
      const url = stringValue(server?.url)
      if (url) lines.push(`- ${inline(url)}${descriptionSuffix(server?.description)}`)
    }
    lines.push('')
    return
  }
  const host = stringValue(document.host)
  const basePath = stringValue(document.basePath) ?? ''
  if (host) lines.push('## 服务地址', '', `- ${inline(`${host}${basePath}`)}`, '')
}

function addSecuritySchemes(lines: string[], document: OpenApiDocument): void {
  const components = objectValue(document.components)
  const schemes =
    objectValue(components?.securitySchemes) ?? objectValue(document.securityDefinitions) ?? {}
  const entries = Object.entries(schemes)
  if (!entries.length) return
  lines.push('## 认证方式', '')
  for (const [name, input] of entries) {
    const scheme = objectValue(input)
    lines.push(`### ${name}`, '')
    if (!scheme) continue
    const facts = [
      pair('类型', scheme.type),
      pair('位置', scheme.in),
      pair('参数名', scheme.name),
      pair('方案', scheme.scheme),
      pair('Bearer 格式', scheme.bearerFormat)
    ].filter((value): value is string => Boolean(value))
    lines.push(...facts.map((fact) => `- ${fact}`))
    if (facts.length) lines.push('')
    addText(lines, scheme.description)
  }
}

function addOperations(lines: string[], document: OpenApiDocument): void {
  const paths = objectValue(document.paths) ?? {}
  const operations = Object.entries(paths).flatMap(([path, input]) => {
    const pathItem = objectValue(input)
    if (!pathItem) return []
    const commonParameters = arrayValue(pathItem.parameters)
    return Object.entries(pathItem).flatMap(([method, operationInput]) => {
      if (!httpMethods.has(method.toLowerCase())) return []
      const operation = objectValue(operationInput)
      return operation ? [{ path, method: method.toUpperCase(), operation, commonParameters }] : []
    })
  })
  if (!operations.length) return

  lines.push('## 接口', '')
  for (const item of operations) {
    const summary = stringValue(item.operation.summary)
    lines.push(`### ${item.method} \`${item.path}\`${summary ? ` — ${heading(summary)}` : ''}`, '')
    addText(lines, item.operation.description)
    addOperationFacts(lines, item.operation)
    addParameters(lines, [...item.commonParameters, ...arrayValue(item.operation.parameters)])
    addRequestBody(lines, item.operation)
    addResponses(lines, item.operation)
  }
}

function addOperationFacts(lines: string[], operation: Record<string, unknown>): void {
  const facts: string[] = []
  const operationId = stringValue(operation.operationId)
  const tags = arrayValue(operation.tags).filter((tag): tag is string => typeof tag === 'string')
  if (operationId) facts.push(`- Operation ID：${inline(operationId)}`)
  if (tags.length) facts.push(`- 标签：${tags.map(inline).join('、')}`)
  if (operation.deprecated === true) facts.push('- 状态：已弃用')
  const security = securityNames(operation.security)
  if (security.length) facts.push(`- 认证：${security.map(inline).join('、')}`)
  if (facts.length) lines.push(...facts, '')
}

function addParameters(lines: string[], inputs: readonly unknown[]): void {
  if (!inputs.length) return
  lines.push(
    '#### 参数',
    '',
    '| 名称 | 位置 | 必填 | 类型 | 说明 |',
    '| --- | --- | --- | --- | --- |'
  )
  for (const input of inputs) {
    const parameter = objectValue(input)
    if (!parameter) continue
    const reference = referenceName(parameter)
    const schema = objectValue(parameter.schema)
    const type = reference ?? schemaSummary(schema ?? parameter)
    lines.push(
      `| ${cell(stringValue(parameter.name) ?? reference ?? '-')} | ${cell(stringValue(parameter.in) ?? '-')} | ${parameter.required === true ? '是' : '否'} | ${cell(type)} | ${cell(stringValue(parameter.description) ?? '')} |`
    )
  }
  lines.push('')
}

function addRequestBody(lines: string[], operation: Record<string, unknown>): void {
  const requestBody = objectValue(operation.requestBody)
  if (requestBody) {
    lines.push('#### 请求体', '')
    if (requestBody.required === true) lines.push('- 必填：是', '')
    addText(lines, requestBody.description)
    addMediaContent(lines, requestBody.content)
    return
  }
  const body = arrayValue(operation.parameters)
    .map(objectValue)
    .find((parameter) => parameter?.in === 'body')
  if (!body) return
  lines.push('#### 请求体', '')
  addText(lines, body.description)
  addSchemaBlock(lines, body.schema)
}

function addResponses(lines: string[], operation: Record<string, unknown>): void {
  const responses = objectValue(operation.responses)
  if (!responses || !Object.keys(responses).length) return
  lines.push('#### 响应', '')
  for (const [status, input] of Object.entries(responses)) {
    const response = objectValue(input)
    lines.push(`##### ${status}${descriptionSuffix(response?.description)}`, '')
    if (!response) continue
    if (response.content) addMediaContent(lines, response.content)
    else addSchemaBlock(lines, response.schema)
  }
}

function addMediaContent(lines: string[], input: unknown): void {
  const content = objectValue(input)
  if (!content) return
  for (const [mediaType, mediaInput] of Object.entries(content)) {
    const media = objectValue(mediaInput)
    lines.push(`- Content-Type：${inline(mediaType)}`, '')
    if (media) {
      addSchemaBlock(lines, media.schema)
      addExampleBlock(lines, media.example ?? media.examples)
    }
  }
}

function addSchemas(lines: string[], document: OpenApiDocument): void {
  const components = objectValue(document.components)
  const schemas = objectValue(components?.schemas) ?? objectValue(document.definitions) ?? {}
  const entries = Object.entries(schemas)
  if (!entries.length) return
  lines.push('## 数据模型', '')
  for (const [name, input] of entries) {
    const schema = objectValue(input)
    lines.push(`### ${name}`, '')
    addText(lines, schema?.description)
    addSchemaBlock(lines, input)
  }
}

function addSchemaBlock(lines: string[], input: unknown): void {
  const schema = objectValue(input)
  if (!schema) return
  const reference = referenceName(schema)
  if (reference) {
    lines.push(`数据模型：${inline(reference)}`, '')
    return
  }
  lines.push('```json', JSON.stringify(schema, null, 2), '```', '')
}

function addExampleBlock(lines: string[], input: unknown): void {
  if (input === undefined) return
  lines.push('示例：', '', '```json', JSON.stringify(input, null, 2), '```', '')
}

function addText(lines: string[], input: unknown): void {
  const text = stringValue(input)
  if (text) lines.push(text, '')
}

function securityNames(input: unknown): string[] {
  return arrayValue(input).flatMap((requirement) => Object.keys(objectValue(requirement) ?? {}))
}

function schemaSummary(schema: Record<string, unknown>): string {
  const reference = referenceName(schema)
  if (reference) return reference
  const type = stringValue(schema.type) ?? (schema.properties ? 'object' : 'unknown')
  const format = stringValue(schema.format)
  if (type === 'array') {
    const items = objectValue(schema.items)
    return `array<${items ? schemaSummary(items) : 'unknown'}>`
  }
  return format ? `${type}(${format})` : type
}

function referenceName(input: Record<string, unknown>): string | undefined {
  const reference = stringValue(input.$ref)
  return reference?.split('/').at(-1)
}

function pair(label: string, input: unknown): string | undefined {
  const value = stringValue(input)
  return value ? `${label}：${inline(value)}` : undefined
}

function descriptionSuffix(input: unknown): string {
  const description = stringValue(input)
  return description ? ` — ${inline(description)}` : ''
}

function inline(input: string): string {
  return `\`${input.replace(/`/gu, '\\`')}\``
}

function heading(input: string): string {
  return input.replace(/[\r\n]+/gu, ' ').trim()
}

function cell(input: string): string {
  return input.replace(/\|/gu, '\\|').replace(/[\r\n]+/gu, '<br>')
}

function arrayValue(input: unknown): unknown[] {
  return Array.isArray(input) ? input : []
}
