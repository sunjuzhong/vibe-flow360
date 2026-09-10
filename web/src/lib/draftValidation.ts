import type { DraftParameterValidationResponse, DynamicFormSchema } from '../api/client'

export type DraftIssueSeverity = 'error' | 'warning'
export type DraftIssueSource = 'local' | 'flow360'
export type DraftIssueMapping = 'exact' | 'ancestor' | 'global'

export type DraftValidationIssue = {
  id: string
  severity: DraftIssueSeverity
  source: DraftIssueSource
  code: string
  message: string
  rawPath?: string
  path?: string
  group?: string
  mapping: DraftIssueMapping
  stages?: string[]
}

export type DraftValidationSummary = {
  issues: DraftValidationIssue[]
  errors: number
  warnings: number
  blocking: boolean
}

export function candidateFingerprint(value: Record<string, unknown>): string {
  return JSON.stringify(stableValue(value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

export function normalizeDraftValidation(
  response: DraftParameterValidationResponse | null,
  schema: DynamicFormSchema | null,
): DraftValidationSummary {
  const issues = (response?.issues ?? []).map((issue, index) => {
    const severity: DraftIssueSeverity = issue.level === 'warning' ? 'warning' : 'error'
    const resolution = resolveDraftIssuePath(schema, issue.path)
    return {
      id: `${severity}:${issue.code}:${issue.path ?? ''}:${index}`,
      severity,
      source: 'flow360' as const,
      code: issue.code,
      message: issue.message,
      rawPath: issue.path,
      path: resolution.path,
      group: resolution.group,
      mapping: resolution.mapping,
      stages: issue.stages,
    }
  })
  return summarizeDraftIssues(issues)
}

export function localDraftValidation(
  schema: DynamicFormSchema | null,
  candidate: Record<string, unknown> | null,
  syntaxMessage = '',
): DraftValidationSummary {
  if (syntaxMessage) {
    return summarizeDraftIssues([{
      id: 'local:json_syntax',
      severity: 'error',
      source: 'local',
      code: 'json_syntax',
      message: syntaxMessage,
      mapping: 'global',
    }])
  }
  if (!schema || !candidate) return summarizeDraftIssues([])
  return summarizeDraftIssues(validateLocalNode(schema, candidate, ''))
}

function validateLocalNode(schema: DynamicFormSchema, value: unknown, path: string): DraftValidationIssue[] {
  const issue = (code: string, message: string): DraftValidationIssue => ({
    id: `local:${code}:${path}`,
    severity: 'error',
    source: 'local',
    code,
    message,
    rawPath: path || undefined,
    path: path || undefined,
    group: path.split('.')[0] || undefined,
    mapping: path ? 'exact' : 'global',
  })
  if (value === null && schema.nullable) return []
  if (value === undefined || value === '') {
    return schema.required === true ? [issue('required', 'This field is required.')] : []
  }
  if (schema.type === 'object') {
    if (!isRecord(value)) return [issue('type', 'Enter an object value.')]
    const required = Array.isArray(schema.required) ? schema.required : []
    const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => validateLocalNode({ ...(schema.properties?.[key] ?? { type: 'json' }), required: true }, undefined, joinPath(path, key)))
      .flat()
    const children = Object.entries(schema.properties ?? {}).flatMap(([key, child]) => (
      Object.prototype.hasOwnProperty.call(value, key) ? validateLocalNode(child, value[key], joinPath(path, key)) : []
    ))
    return [...missing, ...children]
  }
  if (schema.type === 'array' || schema.type === 'tuple') {
    if (!Array.isArray(value)) return [issue('type', 'Enter a list value.')]
    const issues: DraftValidationIssue[] = []
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(issue('min_items', `Add at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`))
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(issue('max_items', `Keep at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}.`))
    return [...issues, ...value.flatMap((item, index) => validateLocalNode(schema.items ?? { type: 'json' }, item, joinPath(path, String(index))))]
  }
  if (schema.type === 'union') {
    const variants = schema.variants ?? []
    if (!variants.length) return []
    const attempts = variants.map((variant) => validateLocalNode(variant, value, path))
    return attempts.some((attempt) => attempt.length === 0) ? [] : attempts.sort((a, b) => a.length - b.length)[0]
  }
  if (schema.type === 'quantity' && isRecord(value)) {
    return validateLocalNode(schema.value_schema ?? { type: 'number' }, value.value, path)
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    const numericValue = typeof value === 'string' ? Number(value) : value
    if (typeof numericValue !== 'number' || !Number.isFinite(numericValue) || schema.type === 'integer' && !Number.isInteger(numericValue)) {
      return [issue('number_format', schema.type === 'integer' ? 'Enter a whole number.' : 'Enter a number.')]
    }
    if (schema.minimum !== undefined && numericValue < schema.minimum) return [issue('minimum', `Enter ${schema.minimum} or greater.`)]
    if (schema.maximum !== undefined && numericValue > schema.maximum) return [issue('maximum', `Enter ${schema.maximum} or less.`)]
    if (schema.exclusiveMinimum !== undefined && numericValue <= schema.exclusiveMinimum) return [issue('exclusive_minimum', `Enter a value greater than ${schema.exclusiveMinimum}.`)]
    if (schema.exclusiveMaximum !== undefined && numericValue >= schema.exclusiveMaximum) return [issue('exclusive_maximum', `Enter a value less than ${schema.exclusiveMaximum}.`)]
  }
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return [issue('min_length', `Enter at least ${schema.minLength} characters.`)]
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return [issue('max_length', `Enter no more than ${schema.maxLength} characters.`)]
  }
  return []
}

export function resolveDraftIssuePath(
  schema: DynamicFormSchema | null,
  issuePath: string | undefined,
): { path?: string; group?: string; mapping: DraftIssueMapping } {
  const normalized = normalizePath(issuePath)
  if (!schema || !normalized) return { mapping: 'global' }
  const segments = normalized.split('.').filter(Boolean)
  const group = schema.type === 'object' && schema.properties?.[segments[0]] ? segments[0] : undefined
  if (!group) return { mapping: 'global' }
  let node: DynamicFormSchema | undefined = schema
  let matched: string[] = []
  for (const segment of segments) {
    const next = schemaChild(node, segment)
    if (!next) break
    node = next
    matched.push(segment)
  }
  if (!matched.length) return { mapping: 'global' }
  return {
    path: matched.join('.'),
    group,
    mapping: matched.length === segments.length ? 'exact' : 'ancestor',
  }
}

function schemaChild(schema: DynamicFormSchema | undefined, segment: string): DynamicFormSchema | undefined {
  if (!schema) return undefined
  if (schema.type === 'object') return schema.properties?.[segment]
  if (schema.type === 'array' && /^\d+$/.test(segment)) return schema.items
  if (schema.type === 'union') {
    for (const variant of schema.variants ?? []) {
      const child = schemaChild(variant, segment)
      if (child) return child
    }
  }
  return undefined
}

function summarizeDraftIssues(issues: DraftValidationIssue[]): DraftValidationSummary {
  const errors = issues.filter((issue) => issue.severity === 'error').length
  return {
    issues,
    errors,
    warnings: issues.length - errors,
    blocking: errors > 0,
  }
}

function normalizePath(path: string | undefined): string {
  return (path ?? '')
    .trim()
    .replace(/^\/?simulation_params(?:\.|\/)?/, '')
    .replace(/^__root__(?:\.|\/)?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\//g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
}

function joinPath(parent: string, child: string) {
  return parent ? `${parent}.${child}` : child
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
